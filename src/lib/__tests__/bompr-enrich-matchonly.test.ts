import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db')
// generateMaterialCode chạm DB → mock cố định để test nhánh tạo material tạm
vi.mock('../material-code', () => ({
  generateMaterialCode: vi.fn().mockResolvedValue('VLP-SON-0001'),
}))

import { prismaMock } from '@/lib/__mocks__/db'
import { enrichBomPrItems } from '../bompr-enrich'

// item chắc chắn KHÔNG khớp kho (kho rỗng) → nhánh cần mã tạm
const unmatchedItem = () => ({
  stt: 'I-001', description: 'SƠN CHỐNG GỈ', profile: '', grade: '', unit: 'lít',
  quantity: 5, weight: 0, unitWeight: 0, thickness: 0, length: 0, width: 0,
})

describe('enrichBomPrItems — option matchOnly', () => {
  beforeEach(() => {
    // loadInventory + loadCodeResolved → rỗng ⇒ không match
    prismaMock.material.findMany.mockResolvedValue([] as never)
    prismaMock.materialCodeAlias.findMany.mockResolvedValue([] as never)
  })

  it('matchOnly=true: item không khớp → materialId để trống, KHÔNG tạo material tạm', async () => {
    const result = await enrichBomPrItems([unmatchedItem()] as never, undefined, { matchOnly: true })

    expect(result[0].materialId).toBeUndefined()
    expect(result[0].provisionalCode).toBeUndefined()
    // enrich vẫn tính needToBuyQty (không khớp → mua hết)
    expect(result[0].needToBuyQty).toBe(5)
    // KHÔNG gọi $transaction — autoCreateProvisionalCodes bị bỏ qua
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('matchOnly=false (mặc định): item không khớp → tạo material tạm (giữ hành vi cũ)', async () => {
    const tx = {
      material: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'mat-prov-1', materialCode: 'VLP-SON-0001' }),
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))

    const result = await enrichBomPrItems([unmatchedItem()] as never, undefined)

    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect(tx.material.create).toHaveBeenCalled()
    expect(result[0].materialId).toBe('mat-prov-1')
    expect(result[0].canonicalCode).toBe('VLP-SON-0001')
    expect(result[0].provisionalCode).toBe(true)
  })
})
