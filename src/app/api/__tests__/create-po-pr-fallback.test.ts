/**
 * create-po — FIX #1: gỡ deadlock P3.5→PO.
 * Ở P3.5 (Thương mại) task KHÔNG có `bomPr` → đường chính rỗng.
 * Route phải LÙI về PurchaseRequest/PurchaseRequestItem của DỰ ÁN để dựng PO item.
 *
 * Bao phủ:
 *  - nguồn PR → PO item đúng (snapshot + quantity + đơn giá từ báo giá/0)
 *  - PR đã CONVERTED/REJECTED (đã mua hết) → 0 item → 400
 *  - idempotent (rd.poId đã tồn tại)
 *  - đường CŨ (bomPr) vẫn chạy, KHÔNG chạm PurchaseRequestItem
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { prismaMock } from '@/lib/__mocks__/db'

type CreateArg = {
  data: {
    totalValue: number
    paymentTerms: string | null
    items: { create: Array<Record<string, unknown>> }
  }
}
type FindArg = {
  where: { purchaseRequest: { projectId: string; status: { notIn: string[] } } }
}

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    userId: 'user-1', roleCode: 'R07', username: 'commercial',
    userLevel: 2, fullName: 'Commercial User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, authenticateRequest: vi.fn().mockResolvedValue(mockUser) }
})

import { POST } from '@/app/api/work/tasks/[id]/create-po/route'

const jsonReq = () =>
  new Request('http://localhost/api/work/tasks/task-1/create-po', { method: 'POST' })
const ctx = { params: Promise.resolve({ id: 'task-1' }) }

const baseTask = {
  id: 'task-1', projectId: 'proj-1', createdBy: 'user-1',
  assignees: [{ userId: 'user-1' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.vendor.findUnique.mockResolvedValue({ id: 'ven-1', name: 'NCC A' } as never)
  prismaMock.purchaseOrder.create.mockResolvedValue({ id: 'po-1', poCode: 'PO-00001' } as never)
  prismaMock.$executeRaw.mockResolvedValue(1 as never)
  // nextPoCode() đọc purchaseOrder.findMany (mã canonical) + findUnique (guard va chạm).
  prismaMock.purchaseOrder.findMany.mockResolvedValue([] as never)
  // findUnique = null: idempotent check không thấy PO cũ + nextPoCode guard không va chạm.
  prismaMock.purchaseOrder.findUnique.mockResolvedValue(null as never)
  // fetchPoCoverageMap() đọc purchaseOrderItem.findMany — mặc định chưa có PO nào phủ.
  prismaMock.purchaseOrderItem.findMany.mockResolvedValue([] as never)
})

describe('create-po — fallback nguồn PurchaseRequest (P3.5)', () => {
  it('dựng PO item từ PR khi task không có bomPr; đơn giá tra từ báo giá, không khớp → 0', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: {
        chosenVendorId: 'ven-1',
        // báo giá NCC — dùng để tra đơn giá theo code/description
        supplierQuotes: [{
          vendorId: 'ven-1',
          paymentTerms: '30 ngày',
          lines: [{ code: 'VTC-001', description: 'Thép chữ C', unitPrice: 200000 }],
        }],
      },
    } as never)

    prismaMock.purchaseRequestItem.findMany.mockResolvedValue([
      { itemCode: 'VTC-001', description: 'Thép chữ C', profile: 'C200', grade: 'SS400', unit: 'cây', materialId: 'mat-1', quantity: 5 },
      // số dạng CHUỖI (dữ liệu thật) + không khớp báo giá → đơn giá 0
      { itemCode: 'VTC-002', description: 'Tôn tấm', profile: '', grade: '', unit: 'tấm', materialId: null, quantity: '3' },
      // quantity 0 → bỏ
      { itemCode: 'VTC-003', description: 'Bu lông', profile: '', grade: '', unit: 'bộ', materialId: null, quantity: 0 },
      // quantity là Prisma Decimal (object) — shape THẬT Prisma trả về. Regression: toQty(Decimal) trực tiếp = 0 → mất dòng.
      { itemCode: 'VTC-004', description: 'Thép hộp', profile: '', grade: '', unit: 'cây', materialId: null, quantity: new Prisma.Decimal('7') },
    ] as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.poId).toBe('po-1')

    expect(prismaMock.purchaseRequestItem.findMany).toHaveBeenCalledTimes(1)
    // loại PR đã CONVERTED/REJECTED/CANCELLED khỏi nguồn mua
    const findArg = prismaMock.purchaseRequestItem.findMany.mock.calls[0][0] as FindArg
    expect(findArg.where.purchaseRequest.projectId).toBe('proj-1')
    expect(findArg.where.purchaseRequest.status.notIn).toEqual(
      expect.arrayContaining(['CONVERTED', 'REJECTED', 'CANCELLED']),
    )

    const createArg = prismaMock.purchaseOrder.create.mock.calls[0][0] as CreateArg
    const items = createArg.data.items.create
    expect(items).toHaveLength(3) // dòng qty 0 bị loại; Decimal(7) được giữ
    expect(items[0]).toMatchObject({
      itemCode: 'VTC-001', description: 'Thép chữ C', profile: 'C200', grade: 'SS400',
      unit: 'cây', materialId: 'mat-1', quantity: 5, unitPrice: 200000,
    })
    expect(items[1]).toMatchObject({
      itemCode: 'VTC-002', materialId: null, quantity: 3, unitPrice: 0,
    })
    // Prisma Decimal → quantity number đúng (regression guard)
    expect(items[2]).toMatchObject({ itemCode: 'VTC-004', quantity: 7, unitPrice: 0 })
    // totalValue = 5*200000 + 3*0 + 7*0
    expect(createArg.data.totalValue).toBe(1000000)
    expect(createArg.data.paymentTerms).toBe('30 ngày')
  })

  it('coverage per-item: PR item đã được PO khác phủ MỘT PHẦN → PO chỉ lấy phần còn lại; phủ HẾT → bỏ dòng', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: {
        chosenVendorId: 'ven-1',
        supplierQuotes: [{
          vendorId: 'ven-1', paymentTerms: '30 ngày',
          lines: [
            { code: 'VTC-001', description: 'Thép chữ C', unitPrice: 200000 },
            { code: 'VTC-005', description: 'Thép tấm', unitPrice: 100000 },
          ],
        }],
      },
    } as never)

    prismaMock.purchaseRequestItem.findMany.mockResolvedValue([
      // cần 10, đã phủ 4 → còn 6
      { itemCode: 'VTC-001', description: 'Thép chữ C', profile: 'C200', grade: 'SS400', unit: 'cây', materialId: 'mat-1', quantity: 10 },
      // cần 5, đã phủ 5 → phủ hết → bỏ
      { itemCode: 'VTC-005', description: 'Thép tấm', profile: '', grade: '', unit: 'tấm', materialId: 'mat-2', quantity: 5 },
      // materialId null → không tra coverage → giữ full (3)
      { itemCode: 'VTC-002', description: 'Tôn tấm', profile: '', grade: '', unit: 'tấm', materialId: null, quantity: '3' },
    ] as never)

    // fetchPoCoverageMap gom PO item theo materialId (loại DRAFT/CANCELLED/REJECTED)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { materialId: 'mat-1', quantity: 4, purchaseOrder: { projectId: 'proj-1' } },
      { materialId: 'mat-2', quantity: 5, purchaseOrder: { projectId: 'proj-1' } },
    ] as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(200)

    // coverage query đúng project + materialIds (chỉ item có materialId)
    expect(prismaMock.purchaseOrderItem.findMany).toHaveBeenCalledTimes(1)

    const createArg = prismaMock.purchaseOrder.create.mock.calls[0][0] as CreateArg
    const items = createArg.data.items.create
    expect(items).toHaveLength(2) // mat-2 phủ hết bị loại
    expect(items[0]).toMatchObject({ itemCode: 'VTC-001', materialId: 'mat-1', quantity: 6, unitPrice: 200000 })
    expect(items[1]).toMatchObject({ itemCode: 'VTC-002', materialId: null, quantity: 3, unitPrice: 0 })
    // totalValue = 6*200000 + 3*0
    expect(createArg.data.totalValue).toBe(1200000)
  })

  it('coverage: nhiều dòng PR CÙNG materialId → coverage tiêu hao dần, không trừ trùng', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: {
        chosenVendorId: 'ven-1',
        supplierQuotes: [{ vendorId: 'ven-1', lines: [{ code: 'VTC-001', unitPrice: 100 }] }],
      },
    } as never)

    prismaMock.purchaseRequestItem.findMany.mockResolvedValue([
      // 2 dòng cùng mat-1: cần 4 + 4 = 8, đã phủ 5 → dòng1 phủ hết (còn 0, bỏ), dòng2 còn 3
      { itemCode: 'VTC-001', description: 'A', profile: '', grade: '', unit: 'cây', materialId: 'mat-1', quantity: 4 },
      { itemCode: 'VTC-001', description: 'A', profile: '', grade: '', unit: 'cây', materialId: 'mat-1', quantity: 4 },
    ] as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { materialId: 'mat-1', quantity: 5, purchaseOrder: { projectId: 'proj-1' } },
    ] as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(200)
    const createArg = prismaMock.purchaseOrder.create.mock.calls[0][0] as CreateArg
    const items = createArg.data.items.create
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ materialId: 'mat-1', quantity: 3 })
  })

  it('coverage: PR item phủ HẾT toàn bộ → 0 item → 400, không tạo PO', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: { chosenVendorId: 'ven-1' },
    } as never)
    prismaMock.purchaseRequestItem.findMany.mockResolvedValue([
      { itemCode: 'VTC-001', description: 'A', profile: '', grade: '', unit: 'cây', materialId: 'mat-1', quantity: 5 },
    ] as never)
    prismaMock.purchaseOrderItem.findMany.mockResolvedValue([
      { materialId: 'mat-1', quantity: 5, purchaseOrder: { projectId: 'proj-1' } },
    ] as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(400)
    expect(prismaMock.purchaseOrder.create).not.toHaveBeenCalled()
  })

  it('PR đã mua hết (CONVERTED) → findMany rỗng → 400, không tạo PO', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: { chosenVendorId: 'ven-1' },
    } as never)
    prismaMock.purchaseRequestItem.findMany.mockResolvedValue([] as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(prismaMock.purchaseOrder.create).not.toHaveBeenCalled()
  })

  it('idempotent: rd.poId đã tồn tại → trả PO cũ, không tạo mới, không đọc PR', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: { poId: 'po-existing', chosenVendorId: 'ven-1' },
    } as never)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue({ id: 'po-existing', poCode: 'PO-00009' } as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.existing).toBe(true)
    expect(json.poId).toBe('po-existing')
    expect(prismaMock.purchaseRequestItem.findMany).not.toHaveBeenCalled()
    expect(prismaMock.purchaseOrder.create).not.toHaveBeenCalled()
  })

  it('đường CŨ: có bomPr khớp báo giá → dùng bomPr, KHÔNG đọc PurchaseRequestItem', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      resultData: {
        chosenVendorId: 'ven-1',
        bomPr: JSON.stringify([
          { stt: 'S-001', description: 'Thép H', unit: 'cây', materialId: 'mat-9', needToBuyQty: 4 },
        ]),
        supplierQuotes: [{
          vendorId: 'ven-1',
          lines: [{ matchedPrIndex: 0, unitPrice: 150000 }],
        }],
      },
    } as never)

    const res = await POST(jsonReq() as never, ctx)
    expect(res.status).toBe(200)
    expect(prismaMock.purchaseRequestItem.findMany).not.toHaveBeenCalled()
    const createArg = prismaMock.purchaseOrder.create.mock.calls[0][0] as CreateArg
    const items = createArg.data.items.create
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ itemCode: 'S-001', quantity: 4, unitPrice: 150000, materialId: 'mat-9' })
  })
})
