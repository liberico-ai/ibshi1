/**
 * #V2-wiring: approveRevision (revision-flow) — gate 2C
 * - Chỉ DRAFT mới duyệt được (SUPERSEDED/ACTIVE → throw)
 * - ECO liên kết phải APPROVED trước khi duyệt
 * - Happy path: supersede ACTIVE cũ → activate → flag needsReQc cho WO
 *   có piece-mark bị ảnh hưởng → tạo task RE_QC (R09) + runCascade
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

const mockRunCascade = vi.fn()
vi.mock('@/lib/cascade-tasks', () => ({
  runCascade: (...args: unknown[]) => mockRunCascade(...args),
}))

const mockCreateTask = vi.fn()
const mockOpenRevisionRound = vi.fn()
const mockNextRevisionRound = vi.fn()
vi.mock('@/lib/work-engine', () => ({
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  openRevisionRound: (...args: unknown[]) => mockOpenRevisionRound(...args),
  nextRevisionRound: (...args: unknown[]) => mockNextRevisionRound(...args),
}))

let mockFFEnabled = true       // BOM_REVISION_CASCADE
let mockReviseFF = false       // REVISE_FLOW (Phase 1b)
vi.mock('@/lib/feature-flags', () => ({
  isEnabled: (flag: string) => (flag === 'BOM_REVISION_CASCADE' ? mockFFEnabled : flag === 'REVISE_FLOW' ? mockReviseFF : false),
  FEATURE_FLAGS: { BOM_REVISION_CASCADE: false, REVISE_FLOW: false },
}))

import { approveRevision } from '@/lib/revision-flow'

const draftVersion = {
  id: 'bv-new',
  bomId: 'bom-1',
  versionNo: 3,
  status: 'DRAFT',
  ecoId: 'eco-1',
  bom: { projectId: 'proj-1' }, // Finding B: approveRevision include bom để lấy projectId THẬT (không dùng bomId)
}

const approvedEco = {
  id: 'eco-1',
  ecoCode: 'ECO-26-001',
  projectId: 'proj-1',
  status: 'APPROVED',
}

describe('approveRevision — gate 2C (#V2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFFEnabled = true
    mockReviseFF = false
    prismaMock.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prismaMock)) as never)
    mockRunCascade.mockResolvedValue({ taskIds: [], groups: [], skippedNoChanges: true })
    mockCreateTask.mockResolvedValue({ id: 'task-reqc-1' })
    mockNextRevisionRound.mockResolvedValue(2)
    mockOpenRevisionRound.mockResolvedValue({ ok: true, round: 2, spawned: ['P2.1', 'P2.2', 'P2.3', 'P2.1A'] })
  })

  it('BomVersion không tồn tại → throw', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(null)

    await expect(approveRevision('bv-missing', 'user-1')).rejects.toThrow('BomVersion không tồn tại')
  })

  it('version SUPERSEDED → throw "chỉ DRAFT mới duyệt được"', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue({ ...draftVersion, status: 'SUPERSEDED' } as never)

    await expect(approveRevision('bv-new', 'user-1')).rejects.toThrow('chỉ DRAFT mới duyệt được')
    expect(prismaMock.bomVersion.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.bomVersion.update).not.toHaveBeenCalled()
  })

  it('ECO chưa APPROVED → throw "cần APPROVED"', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue({ ...approvedEco, status: 'DRAFT' } as never)

    await expect(approveRevision('bv-new', 'user-1')).rejects.toThrow('cần APPROVED')
    expect(prismaMock.bomVersion.updateMany).not.toHaveBeenCalled()
  })

  it('happy path: supersede + activate + flag needsReQc + task RE_QC (R09) + cascade', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(approvedEco as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    // Diff piece-mark: PM-1 đổi quantity 10→20 → affected
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([{ pieceMark: 'PM-1', materialId: 'm1', quantity: 10 }] as never) // old
      .mockResolvedValueOnce([{ pieceMark: 'PM-1', materialId: 'm1', quantity: 20 }] as never) // new
    prismaMock.workOrder.updateMany.mockResolvedValue({ count: 2 } as never)

    const result = await approveRevision('bv-new', 'user-1')

    expect(result.status).toBe('ACTIVE')

    // Supersede version ACTIVE cũ
    expect(prismaMock.bomVersion.updateMany).toHaveBeenCalledWith({
      where: { bomId: 'bom-1', status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    })

    // Flag needsReQc cho WO QC_PASSED/COMPLETED có piece-mark bị ảnh hưởng
    expect(prismaMock.workOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'proj-1',
          pieceMark: { in: ['PM-1'] },
          status: { in: ['QC_PASSED', 'COMPLETED'] },
        }),
        data: expect.objectContaining({ needsReQc: true }),
      })
    )

    // Cascade chạy với đúng version cũ/mới
    expect(mockRunCascade).toHaveBeenCalledWith('bv-old', 'bv-new', 'proj-1', 'ECO-26-001', 'user-1', 'bom-1')

    // Task RE_QC giao R09
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    const taskInput = mockCreateTask.mock.calls[0][0] as {
      title: string; taskType: string; assignees: { role: string }[]
    }
    expect(taskInput.taskType).toBe('RE_QC')
    expect(taskInput.title).toContain('[Re-QC]')
    expect(taskInput.title).toContain('ECO-26-001')
    expect(taskInput.assignees).toEqual([{ role: 'R09' }])
  })

  it('piece-mark không đổi → không flag re-QC, không tạo task RE_QC', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(approvedEco as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    const sameItems = [{ pieceMark: 'PM-1', materialId: 'm1', quantity: 10 }]
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce(sameItems as never)
      .mockResolvedValueOnce(sameItems as never)

    await approveRevision('bv-new', 'user-1')

    expect(prismaMock.workOrder.updateMany).not.toHaveBeenCalled()
    expect(mockCreateTask).not.toHaveBeenCalled()
    // Cascade vẫn chạy (FF ON, có version cũ)
    expect(mockRunCascade).toHaveBeenCalled()
  })

  it('cascade lỗi → non-blocking, approve vẫn thành công', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(approvedEco as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    prismaMock.bomItem.findMany.mockResolvedValue([] as never)
    mockRunCascade.mockRejectedValue(new Error('cascade boom'))

    const result = await approveRevision('bv-new', 'user-1')
    expect(result.status).toBe('ACTIVE')
  })

  // ── Finding B (regression lock): revision KHÔNG gắn ECO ──
  // Bug gốc: projectId = eco?.projectId || version.bomId → khi ecoId null, dùng bomId (BillOfMaterial id)
  // làm projectId → createTask FK-fail → try/catch nuốt → cascade + re-QC MẤT ÂM THẦM.
  // Fix: || version.bom.projectId. Test này khoá: runCascade phải nhận projectId THẬT ('proj-1'), KHÔNG phải 'bom-1'.
  it('Finding B: version KHÔNG ECO → runCascade nhận projectId THẬT (proj-1), KHÔNG phải bomId', async () => {
    const noEcoVersion = { ...draftVersion, ecoId: null }
    prismaMock.bomVersion.findUnique.mockResolvedValue(noEcoVersion as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...noEcoVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    prismaMock.bomItem.findMany.mockResolvedValue([] as never)
    mockRunCascade.mockResolvedValue({ taskIds: ['t1'], groups: [{}], skippedNoChanges: false })

    await approveRevision('bv-new', 'user-1')

    expect(mockRunCascade).toHaveBeenCalledTimes(1)
    // args = [oldVersionId, newVersionId, projectId, ecoCode, userId, bomId]
    const args = mockRunCascade.mock.calls[0]
    expect(args[2]).toBe('proj-1')       // projectId THẬT từ bom (regression lock Finding B)
    expect(args[2]).not.toBe('bom-1')    // KHÔNG được là bomId (bug cũ)
    expect(args[3]).toBe('BOM-v3')       // ecoCode fallback khi không ECO
    expect(args[5]).toBe('bom-1')        // bomId vẫn đúng ở vị trí bomId (arg cuối)
    // ECO gate KHÔNG chạy (ecoId null)
    expect(prismaMock.engineeringChangeOrder.findUnique).not.toHaveBeenCalled()
  })

  // ── Finding B (báo lỗi, không im lặng): cascade lẽ ra chạy mà ra 0 task → console.warn ──
  it('Finding B: cascade có thay đổi nhưng 0 task → console.warn (không im lặng)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(approvedEco as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    prismaMock.bomItem.findMany.mockResolvedValue([] as never)
    // runCascade trả 0 task nhưng KHÔNG phải skippedNoChanges → bất thường → phải cảnh báo
    mockRunCascade.mockResolvedValue({ taskIds: [], groups: [], skippedNoChanges: false })

    await approveRevision('bv-new', 'user-1')

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('KHÔNG sinh task rework'))
    warnSpy.mockRestore()
  })

  // ── Finding F (regression lock): re-QC dispatch ĐỘC LẬP feature-flag cascade ──
  // Bug gốc: task re-QC gate trên cascadeParams (null khi FF cascade TẮT) → WO bị cờ needsReQc=true
  // trong DB nhưng R09 KHÔNG được giao việc → QC không biết tái kiểm → mất âm thầm.
  // Fix: gate trên reQcContext (set độc lập FF). Test này khoá: FF TẮT + WO đổi piece-mark →
  // createTask RE_QC (R09) VẪN gọi với projectId THẬT ('proj-1'). Fail trên code pre-fix (cascadeParams null → 0 task).
  it('Finding F: FF cascade TẮT + WO đổi piece-mark → task Re-QC (R09) VẪN dispatch, projectId đúng', async () => {
    mockFFEnabled = false // FF cascade TẮT → cascadeParams=null → runCascade KHÔNG chạy
    const noEcoVersion = { ...draftVersion, ecoId: null }
    prismaMock.bomVersion.findUnique.mockResolvedValue(noEcoVersion as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...noEcoVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    // piece-mark PM-1 đổi quantity 10→20 → affectedMarks > 0
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([{ pieceMark: 'PM-1', materialId: 'm1', quantity: 10 }] as never) // old
      .mockResolvedValueOnce([{ pieceMark: 'PM-1', materialId: 'm1', quantity: 20 }] as never) // new
    prismaMock.workOrder.updateMany.mockResolvedValue({ count: 3 } as never)

    await approveRevision('bv-new', 'user-1')

    // Cascade KHÔNG chạy (FF tắt) — xác nhận đúng điều kiện test
    expect(mockRunCascade).not.toHaveBeenCalled()
    // Re-QC task VẪN dispatch (độc lập FF) — REGRESSION LOCK Finding F
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    const taskInput = mockCreateTask.mock.calls[0][0] as {
      taskType: string; projectId: string; title: string; assignees: { role: string }[]
    }
    expect(taskInput.taskType).toBe('RE_QC')
    expect(taskInput.projectId).toBe('proj-1')     // projectId THẬT từ bom
    expect(taskInput.projectId).not.toBe('bom-1')  // KHÔNG phải bomId
    expect(taskInput.assignees).toEqual([{ role: 'R09' }])
    expect(taskInput.title).toContain('BOM-v3')    // ecoLabel fallback khi không ECO
    // userId truyền đúng (param của approveRevision), không lấy từ cascadeParams
    expect(mockCreateTask.mock.calls[0][1]).toBe('user-1')
  })

  // Re-QC vẫn gắn ECO code khi CÓ ecoLabel (FF tắt, version có ECO đã APPROVED)
  it('Finding F: FF TẮT + version CÓ ECO → task Re-QC mang ecoCode + projectId từ ECO', async () => {
    mockFFEnabled = false
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(approvedEco as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([{ pieceMark: 'PM-9', materialId: 'm1', quantity: 5 }] as never)
      .mockResolvedValueOnce([{ pieceMark: 'PM-9', materialId: 'm1', quantity: 8 }] as never)
    prismaMock.workOrder.updateMany.mockResolvedValue({ count: 1 } as never)

    await approveRevision('bv-new', 'user-1')

    expect(mockRunCascade).not.toHaveBeenCalled()
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    const taskInput = mockCreateTask.mock.calls[0][0] as { title: string; projectId: string }
    expect(taskInput.title).toContain('ECO-26-001')
    expect(taskInput.projectId).toBe('proj-1')
  })
})

describe('approveRevision — Phase 1b (FF REVISE_FLOW ON): mở vòng revise thay cascade, GIỮ re-QC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFFEnabled = true          // BOM_REVISION_CASCADE (để cascadeParams được tính)
    mockReviseFF = true           // REVISE_FLOW ON
    prismaMock.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) => fn(prismaMock)) as never)
    mockRunCascade.mockResolvedValue({ taskIds: [], groups: [], skippedNoChanges: true })
    mockCreateTask.mockResolvedValue({ id: 'task-reqc-1' })
    mockNextRevisionRound.mockResolvedValue(2)
    mockOpenRevisionRound.mockResolvedValue({ ok: true, round: 2, spawned: ['P2.1', 'P2.2', 'P2.3', 'P2.1A'] })
  })

  it('FF ON: openRevisionRound(entry P2.1, revisionId=ecoId) — runCascade KHÔNG chạy — re-QC VẪN sinh', async () => {
    prismaMock.bomVersion.findUnique.mockResolvedValue(draftVersion as never)
    prismaMock.engineeringChangeOrder.findUnique.mockResolvedValue(approvedEco as never)
    prismaMock.bomVersion.updateMany.mockResolvedValue({ count: 1 } as never)
    prismaMock.bomVersion.update.mockResolvedValue({ ...draftVersion, status: 'ACTIVE' } as never)
    prismaMock.bomVersion.findFirst.mockResolvedValue({ id: 'bv-old' } as never)
    prismaMock.bomItem.findMany
      .mockResolvedValueOnce([{ pieceMark: 'PM-1', materialId: 'm1', quantity: 10 }] as never)
      .mockResolvedValueOnce([{ pieceMark: 'PM-1', materialId: 'm1', quantity: 20 }] as never)
    prismaMock.workOrder.updateMany.mockResolvedValue({ count: 2 } as never)

    await approveRevision('bv-new', 'user-1')

    // Mở vòng revise: entry P2.1 (REV_DESIGN), revisionId = ecoId
    expect(mockOpenRevisionRound).toHaveBeenCalledTimes(1)
    expect(mockOpenRevisionRound).toHaveBeenCalledWith('proj-1', 'P2.1', 2, 'user-1', { revisionId: 'eco-1' })
    // Cascade phẳng KHÔNG chạy (round thay thế)
    expect(mockRunCascade).not.toHaveBeenCalled()
    // re-QC VẪN sinh (Finding F độc lập FF) — an toàn chất lượng còn nguyên
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    const taskInput = mockCreateTask.mock.calls[0][0] as { title: string; taskType: string }
    expect(taskInput.taskType).toBe('RE_QC')
    expect(prismaMock.workOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ needsReQc: true }) })
    )
  })
})
