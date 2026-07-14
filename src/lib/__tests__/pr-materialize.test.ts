import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { maybeMaterializePr, materializePrSafe, isPrMaterializeEnabled } from '@/lib/pr-materialize'

// Fixture thật (prod): task "PR dây hàn" — FREE, không có bước
const DAY_HAN = JSON.stringify([
  { stt: '1', description: 'Vật liệu hàn E71T-1C, size 1.2mm', spec: '', unit: 'kg', quantity: 1500, weight: 1500, category: 'weld' },
  { stt: '2', description: 'Vật liệu hàn ER70S6, size 0.8mm', spec: '', unit: 'kg', quantity: 50, weight: 50, category: 'weld' },
])
const THEP = JSON.stringify([
  { stt: 'I109-VTC01-001', description: 'Tôn tấm', profile: 'PL1x1200x1250', grade: 'SS400',
    unit: 'm2', quantity: 1.5, needToBuyQty: 1.5, availableQty: 0 },
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockTask(taskType: string, resultData: any, projectId: string | null = 'proj-1') {
  prismaMock.task.findUnique.mockResolvedValue({
    id: 't1', taskType, projectId, resultData, createdBy: 'u-creator',
  } as never)
}

describe('pr-materialize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.FF_PR_MATERIALIZE = 'true' // bật trong test
    prismaMock.purchaseRequest.findUnique.mockResolvedValue(null as never)
    prismaMock.purchaseRequest.findFirst.mockResolvedValue(null as never)
    prismaMock.purchaseRequest.create.mockResolvedValue({ id: 'pr-1', prCode: 'PR-26-001' } as never)
    prismaMock.$transaction.mockResolvedValue([] as never)
  })
  afterEach(() => { delete process.env.FF_PR_MATERIALIZE })

  describe('FEATURE FLAG — mặc định TẮT', () => {
    it('không set env → TẮT, không đọc DB, không sinh gì', async () => {
      delete process.env.FF_PR_MATERIALIZE
      expect(isPrMaterializeEnabled()).toBe(false)
      const r = await maybeMaterializePr('t1', 'u1')
      expect(r).toEqual({ materialized: false, reason: 'flag-off' })
      expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
    })
    it('FF_PR_MATERIALIZE="false" → vẫn TẮT', async () => {
      process.env.FF_PR_MATERIALIZE = 'false'
      expect((await maybeMaterializePr('t1', 'u1')).materialized).toBe(false)
      expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
    })
  })

  describe('ALLOWLIST theo bước', () => {
    it.each(['P2.1', 'P2.2', 'P2.3'])('bước %s (nguồn nhu cầu) → SINH PR', async (step) => {
      mockTask(step, { bomPrItems: THEP })
      const r = await maybeMaterializePr('t1', 'u1')
      expect(r.materialized).toBe(true)
      expect(prismaMock.purchaseRequest.create).toHaveBeenCalled()
    })

    it('task FREE ("PR dây hàn") → SINH PR (không có bước vẫn phải chạy)', async () => {
      mockTask('FREE', { weldData: DAY_HAN, templateType: 'x' })
      const r = await maybeMaterializePr('t1', 'u-hung')
      expect(r.materialized).toBe(true)
      if (r.materialized) expect(r.lineCount).toBe(2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arg = prismaMock.purchaseRequest.create.mock.calls[0][0] as any
      expect(arg.data.requestedBy).toBe('u-hung')
      expect(arg.data.status).toBe('DRAFT') // KHÔNG tự duyệt
      expect(arg.data.sourceTaskId).toBe('t1')
      expect(arg.data.items.create).toHaveLength(2)
      expect(arg.data.items.create[0].materialId).toBeNull() // dây hàn chưa có Material
      expect(arg.data.items.create[0].quantity).toBe(1500)
    })

    it.each(['P3.5', 'P3.6'])('bước %s (đi mua/duyệt giá) → TUYỆT ĐỐI KHÔNG sinh PR dù CÓ dòng', async (step) => {
      mockTask(step, { bomPr: THEP })
      const r = await maybeMaterializePr('t1', 'u1')
      expect(r).toEqual({ materialized: false, reason: 'excluded-step' })
      expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
    })

    it('bước lạ (P3.3) có dòng PR → BỎ QUA nhưng GHI LOG cảnh báo', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockTask('P3.3', { bomPrItems: THEP })
      const r = await maybeMaterializePr('t1', 'u1')
      expect(r).toEqual({ materialized: false, reason: 'step-not-in-allowlist' })
      expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('P3.3'))
      warn.mockRestore()
    })

    it('task không có dòng PR → bỏ qua, không cảnh báo ồn', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockTask('P3.3', { briefing: 'giao ban' })
      expect((await maybeMaterializePr('t1', 'u1')).materialized).toBe(false)
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })

    it('task không thuộc dự án nào → bỏ qua', async () => {
      mockTask('FREE', { weldData: DAY_HAN }, null)
      expect(await maybeMaterializePr('t1', 'u1')).toEqual({ materialized: false, reason: 'no-project' })
    })
  })

  describe('IDEMPOTENT — chạy lại không nhân bản', () => {
    it('đã có PR (DRAFT) → UPDATE, không tạo PR thứ 2', async () => {
      mockTask('P2.1', { bomPrItems: THEP })
      prismaMock.purchaseRequest.findUnique.mockResolvedValue({ id: 'pr-1', prCode: 'PR-26-001', status: 'DRAFT' } as never)

      const r = await maybeMaterializePr('t1', 'u1')
      expect(r.materialized).toBe(true)
      if (r.materialized) expect(r.created).toBe(false) // cập nhật, không tạo mới
      expect(prismaMock.purchaseRequest.create).not.toHaveBeenCalled()
      expect(prismaMock.$transaction).toHaveBeenCalled() // xoá dòng cũ + ghi dòng mới
    })

    it('chạy 2 lần liên tiếp → chỉ 1 PR được tạo', async () => {
      mockTask('P2.1', { bomPrItems: THEP })
      await maybeMaterializePr('t1', 'u1') // lần 1: tạo
      expect(prismaMock.purchaseRequest.create).toHaveBeenCalledTimes(1)

      // lần 2: PR đã tồn tại (sourceTaskId unique)
      prismaMock.purchaseRequest.findUnique.mockResolvedValue({ id: 'pr-1', prCode: 'PR-26-001', status: 'DRAFT' } as never)
      await maybeMaterializePr('t1', 'u1')
      expect(prismaMock.purchaseRequest.create).toHaveBeenCalledTimes(1) // vẫn 1
    })

    it('PR đã DUYỆT (APPROVED) → KHÔNG ghi đè', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockTask('P2.1', { bomPrItems: THEP })
      prismaMock.purchaseRequest.findUnique.mockResolvedValue({ id: 'pr-1', prCode: 'PR-26-001', status: 'APPROVED' } as never)

      expect(await maybeMaterializePr('t1', 'u1')).toEqual({ materialized: false, reason: 'pr-not-draft' })
      expect(prismaMock.$transaction).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('materializePrSafe — không bao giờ làm hỏng việc lưu task', () => {
    it('DB lỗi → nuốt lỗi, log, KHÔNG throw', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      prismaMock.task.findUnique.mockRejectedValue(new Error('DB sập') as never)
      await expect(materializePrSafe('t1', 'u1')).resolves.toBeUndefined()
      expect(err).toHaveBeenCalled()
      err.mockRestore()
    })
  })
})
