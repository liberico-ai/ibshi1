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
  prismaMock.purchaseOrder.findFirst.mockResolvedValue(null as never)
  prismaMock.purchaseOrder.create.mockResolvedValue({ id: 'po-1', poCode: 'PO-00001' } as never)
  prismaMock.$executeRaw.mockResolvedValue(1 as never)
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
    expect(items).toHaveLength(2) // dòng qty 0 bị loại
    expect(items[0]).toMatchObject({
      itemCode: 'VTC-001', description: 'Thép chữ C', profile: 'C200', grade: 'SS400',
      unit: 'cây', materialId: 'mat-1', quantity: 5, unitPrice: 200000,
    })
    expect(items[1]).toMatchObject({
      itemCode: 'VTC-002', materialId: null, quantity: 3, unitPrice: 0,
    })
    // totalValue = 5*200000 + 3*0
    expect(createArg.data.totalValue).toBe(1000000)
    expect(createArg.data.paymentTerms).toBe('30 ngày')
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
