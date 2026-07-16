import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'
import { nextPoCode } from '@/lib/po-code'

describe('nextPoCode — sinh mã PO-NNNNN an toàn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // mặc định: mã tính ra chưa tồn tại (không va chạm)
    prismaMock.purchaseOrder.findUnique.mockResolvedValue(null as never)
  })

  it('CHỈ tính mã canonical ^PO-\\d+$, BỎ QUA mã lẫn lộn (bug gốc)', async () => {
    // Tập mã thật gây bug: PR-115-40 sort cao nhất, PO-PR-…, PO-<năm>-… đều KHÔNG được tính
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { poCode: 'PO-00001' },
      { poCode: 'PO-00007' },       // max canonical
      { poCode: 'PR-115-40' },      // không phải PO- → đã bị lọc where, phòng hờ
      { poCode: 'PO-PR-853-23-858' }, // startsWith PO- nhưng không match ^PO-\d+$
      { poCode: 'PO-2026-11-05-000002' }, // format năm → không match
    ] as never)
    expect(await nextPoCode()).toBe('PO-00008') // 7 + 1, KHÔNG phải PO-00001
  })

  it('chưa có PO canonical nào → PO-00001', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([
      { poCode: 'PR-115-40' }, { poCode: 'PO-PR-1' },
    ] as never)
    expect(await nextPoCode()).toBe('PO-00001')
  })

  it('guard va chạm: mã tính ra đã tồn tại → tăng tiếp', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([{ poCode: 'PO-00005' }] as never)
    // PO-00006 và PO-00007 đã tồn tại (lệch dữ liệu) → phải nhảy tới PO-00008
    prismaMock.purchaseOrder.findUnique
      .mockResolvedValueOnce({ id: 'x', poCode: 'PO-00006' } as never)
      .mockResolvedValueOnce({ id: 'y', poCode: 'PO-00007' } as never)
      .mockResolvedValueOnce(null as never)
    expect(await nextPoCode()).toBe('PO-00008')
  })

  it('rỗng hoàn toàn → PO-00001', async () => {
    prismaMock.purchaseOrder.findMany.mockResolvedValue([] as never)
    expect(await nextPoCode()).toBe('PO-00001')
  })
})
