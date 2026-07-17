import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { nextPoCode } from '@/lib/po-code'

// Format chuẩn: PO-<2 số năm>-<3 số>, reset theo năm. Tính năm động → test không vỡ khi sang năm mới.
const YY = new Date().getFullYear().toString().slice(-2)

describe('nextPoCode — sinh mã PO-<năm>-NNN an toàn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.purchaseOrder.findUnique.mockResolvedValue(null as never) // mặc định không va chạm
  })

  it('CHỈ tính mã canonical PO-<năm-hiện-tại>-NNN, BỎ QUA format cũ/lẫn/năm khác', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { poCode: `PO-${YY}-001` },
      { poCode: `PO-${YY}-007` },          // max canonical năm hiện tại
      { poCode: 'PO-00001' },              // format cũ PO-NNNNN → bỏ
      { poCode: 'PR-115-40' },             // không phải PO- → bỏ
      { poCode: 'PO-PR-853-23-858' },      // PO- nhưng không match → bỏ
      { poCode: 'PO-2026-11-05-000002' },  // format ngày → bỏ
      { poCode: `PO-${YY}-11-05` },        // cùng prefix năm nhưng có thêm nhóm → không match ^PO-YY-\d+$
    ] as never)
    expect(await nextPoCode()).toBe(`PO-${YY}-008`) // 7 + 1
  })

  it('chưa có PO canonical năm này → PO-<năm>-001', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { poCode: 'PO-00099' }, { poCode: 'PO-PR-1' },
    ] as never)
    expect(await nextPoCode()).toBe(`PO-${YY}-001`)
  })

  it('guard va chạm: mã tính ra đã tồn tại → tăng tiếp', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ poCode: `PO-${YY}-005` }] as never)
    // PO-YY-006, PO-YY-007 đã tồn tại (lệch dữ liệu) → nhảy tới PO-YY-008
    prismaMock.purchaseOrder.findUnique
      .mockResolvedValueOnce({ id: 'x', poCode: `PO-${YY}-006` } as never)
      .mockResolvedValueOnce({ id: 'y', poCode: `PO-${YY}-007` } as never)
      .mockResolvedValueOnce(null as never)
    expect(await nextPoCode()).toBe(`PO-${YY}-008`)
  })

  it('rỗng hoàn toàn → PO-<năm>-001', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([] as never)
    expect(await nextPoCode()).toBe(`PO-${YY}-001`)
  })

  it('findMany lọc theo prefix PO-<năm>- (không quét toàn bảng)', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([] as never)
    await nextPoCode()
    const arg = prismaMock.purchaseOrder.findMany.mock.calls[0][0] as { where: { poCode: { startsWith: string } } }
    expect(arg.where.poCode.startsWith).toBe(`PO-${YY}-`)
  })
})
