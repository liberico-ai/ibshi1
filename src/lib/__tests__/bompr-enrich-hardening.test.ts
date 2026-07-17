import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')
// generateMaterialCode chạm DB → mock cố định để test nhánh tạo material tạm
vi.mock('../material-code', () => ({
  generateMaterialCode: vi.fn().mockResolvedValue('VLP-SON-0001'),
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { enrichBomPrItems } from '../bompr-enrich'

const baseItem = (o: Record<string, unknown>) => ({
  stt: 'I-001', description: '', profile: '', grade: '', unit: 'lít',
  quantity: 5, weight: 0, unitWeight: 0, thickness: 0, length: 0, width: 0,
  ...o,
})

// tx mock chuẩn cho $transaction (tạo provisional)
function makeTx() {
  return {
    material: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'mat-prov-1', materialCode: 'VLP-SON-0001' }),
    },
  }
}

describe('bompr-enrich hardening (MEDIUM + 2 LOW)', () => {
  beforeEach(() => {
    // kho rỗng → không item nào khớp inventory → mọi item không khớp đi tới nhánh provisional
    prismaMock.material.findMany.mockResolvedValue([] as never)
    prismaMock.materialCodeAlias.findMany.mockResolvedValue([] as never)
  })

  // ── MEDIUM: batch mixed — item ĐÃ có materialId (không khớp kho) KHÔNG bị tạo orphan provisional ──
  it('MEDIUM: item pre-filled materialId (không khớp kho) → KHÔNG tạo provisional; item null-material vẫn tạo', async () => {
    const tx = makeTx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))

    const items = [
      baseItem({ stt: 'A', description: 'THÉP TẤM', profile: 'PL10', unit: 'm2', materialId: 'mat-existing-X' }), // pre-filled, không khớp kho
      baseItem({ stt: 'B', description: 'SƠN CHỐNG GỈ', profile: '', unit: 'lít' }),                              // null-material → provisional
    ]
    const result = await enrichBomPrItems(items as never, undefined)

    // provisional chỉ tạo 1 lần — cho item B, KHÔNG cho item A (trước fix: A sinh orphan)
    expect(tx.material.create).toHaveBeenCalledTimes(1)
    // A giữ nguyên materialId gốc, không bị ghi đè bởi provisional rác
    expect(result[0].materialId).toBe('mat-existing-X')
    expect(result[0].provisionalCode).toBeUndefined()
    // B được cấp provisional
    expect(result[1].materialId).toBe('mat-prov-1')
    expect(result[1].provisionalCode).toBe(true)
  })

  // ── LOW junk: profile toàn khoảng trắng + không description → không tạo 'Vật tư tạm' rác ──
  it('LOW junk: profile toàn space + không description → KHÔNG tạo provisional', async () => {
    const tx = makeTx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))

    const items = [baseItem({ stt: 'A', description: '   ', profile: '   ', unit: 'lít' })]
    const result = await enrichBomPrItems(items as never, undefined)

    expect(tx.material.create).not.toHaveBeenCalled()
    // needsCode rỗng → autoCreateProvisionalCodes return sớm, không mở transaction
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(result[0].materialId).toBeUndefined()
    expect(result[0].provisionalCode).toBeUndefined()
  })

  // ── LOW FK: $transaction throw → result.clear() → caller KHÔNG nhận materialId đã rollback ──
  it('LOW FK: $transaction throw → result rỗng (không trả materialId rollback → tránh FK-500)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockRejectedValue(new Error('tx boom') as never)

    const items = [baseItem({ stt: 'A', description: 'SƠN CHỐNG GỈ', profile: '', unit: 'lít' })] // cần provisional
    const result = await enrichBomPrItems(items as never, undefined)

    // transaction đã chạy (item cần provisional) nhưng throw → rollback
    expect(prismaMock.$transaction).toHaveBeenCalled()
    // result.clear() → item KHÔNG mang materialId của material đã bị rollback
    expect(result[0].materialId).toBeUndefined()
    expect(result[0].provisionalCode).toBeUndefined()
  })
})
