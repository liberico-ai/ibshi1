/**
 * Finding C — POST /api/design/bom nạp BOM thô KHÔNG có materialId.
 * BomItem.materialId trong DB là NOT NULL → route enrich server-side (enrichBomPrItems,
 * chế độ tạo provisional) để mỗi item luôn có materialId thật trước khi insert:
 *  - item có profile/grade khớp Material Master → BomItem.materialId = inv.id (resolve)
 *  - item không khớp nhưng có description/profile → tạo material provisional → materialId thật
 *  - item không khớp VÀ thiếu cả profile lẫn description → 400 liệt kê item (không nuốt)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import { prismaMock } from '@/lib/__mocks__/db'

const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    userId: 'user-design',
    roleCode: 'R04', // Design — có quyền tạo BOM
    username: 'design',
    userLevel: 2,
    fullName: 'Design User',
  },
}))

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    authenticateRequest: vi.fn().mockResolvedValue(mockUser),
  }
})

// generateMaterialCode chạm DB → mock cố định để test nhánh tạo provisional
vi.mock('@/lib/material-code', () => ({
  generateMaterialCode: vi.fn().mockResolvedValue('VLP-SON-0001'),
}))

import { POST } from '@/app/api/design/bom/route'
import { authenticateRequest } from '@/lib/auth'

const postReq = (body: unknown) =>
  new Request('http://localhost/api/design/bom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// Material Master khớp Strategy 1 (specification === profile, unit khớp)
const MASTER_MATCH = {
  id: 'mat-match-1',
  materialCode: 'VLC-TAM-0001',
  name: 'Thép tấm 10mm',
  unit: 'kg',
  category: 'VLC',
  groupCode: '1.1',
  specification: 'PL10',
  grade: 'SS400',
  currentStock: 100,
  stocks: [],
}

const CREATED_BOM = {
  id: 'bom-1',
  bomCode: 'BOM-26-001',
  projectId: 'proj-1',
  name: 'BOM I-090',
  items: [
    {
      id: 'bi-1',
      materialId: 'mat-match-1',
      quantity: new Prisma.Decimal(5),
      unit: 'kg',
      material: MASTER_MATCH,
    },
  ],
}

describe('POST /api/design/bom — nạp BOM thô thiếu materialId (Finding C)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue(mockUser as never)
    prismaMock.project.findUnique.mockResolvedValue({ projectCode: '26-BRA-I-090' } as never)
    prismaMock.billOfMaterial.count.mockResolvedValue(0 as never)
    prismaMock.materialCodeAlias.findMany.mockResolvedValue([] as never)
    prismaMock.billOfMaterial.create.mockResolvedValue(CREATED_BOM as never)
  })

  it('item KHÔNG materialId nhưng profile/grade khớp Master → BomItem tạo với materialId resolve', async () => {
    // loadInventory trả về material khớp
    prismaMock.material.findMany.mockResolvedValue([MASTER_MATCH] as never)

    const res = await POST(
      postReq({
        projectId: 'proj-1',
        name: 'BOM I-090',
        items: [
          { quantity: 5, unit: 'kg', profile: 'PL10', grade: 'SS400', description: 'Thép tấm 10mm' },
        ],
      }) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    // BomItem được insert với materialId đã resolve từ Master, KHÔNG tạo provisional
    const createArg = prismaMock.billOfMaterial.create.mock.calls[0][0] as {
      data: { items: { create: { materialId: string }[] } }
    }
    expect(createArg.data.items.create[0].materialId).toBe('mat-match-1')
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('item KHÔNG materialId, không khớp Master (có description) → tạo provisional có materialId', async () => {
    // Kho rỗng → không match → nhánh tạo provisional
    prismaMock.material.findMany.mockResolvedValue([] as never)
    const tx = {
      material: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'mat-prov-1', materialCode: 'VLP-SON-0001' }),
      },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))

    const res = await POST(
      postReq({
        projectId: 'proj-1',
        name: 'BOM sơn',
        items: [{ quantity: 3, unit: 'lít', description: 'SƠN CHỐNG GỈ' }],
      }) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(tx.material.create).toHaveBeenCalled()
    const createArg = prismaMock.billOfMaterial.create.mock.calls[0][0] as {
      data: { items: { create: { materialId: string }[] } }
    }
    expect(createArg.data.items.create[0].materialId).toBe('mat-prov-1')
  })

  it('item không khớp VÀ thiếu cả profile lẫn description → 400 liệt kê item, KHÔNG tạo BOM', async () => {
    prismaMock.material.findMany.mockResolvedValue([] as never)

    const res = await POST(
      postReq({
        projectId: 'proj-1',
        name: 'BOM lỗi',
        items: [{ quantity: 2, unit: 'cái' }], // không profile, không description → không resolve được
      }) as never,
    )
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.ok).toBe(false)
    expect(json.error).toContain('dòng 1')
    expect(prismaMock.billOfMaterial.create).not.toHaveBeenCalled()
  })
})
