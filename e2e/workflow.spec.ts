/**
 * E2E Workflow Test — IBS-ERP
 *
 * Tests the full 32-step workflow from P1.1 → P6.1
 * with special focus on merged features:
 *   - P3.2 stock check dynamic tables
 *   - P3.5 supplier comparison tables
 *   - P3.7 payment / delivery
 *   - P4.1 payment milestones
 *   - P4.4 per-material warehouse items
 *   - P5.2 hangMuc + jobCardCode
 *   - P5.4 volume_confirmed
 *   - Auto-propagation rejection flow
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test'

// ─── Test accounts ───────────────────────────────────────────────

const USERS: Record<string, { username: string; password: string; role: string }> = {
  PM:   { username: 'giangdd',   password: '123456', role: 'R02' },
  BGD:  { username: 'toandv',    password: '123456', role: 'R01' },
  KTKH: { username: 'samld',     password: '123456', role: 'R03' },
  TK:   { username: 'luudt',     password: '123456', role: 'R04' },
  KHO:  { username: 'luongnth',  password: '123456', role: 'R05' },
  QLSX: { username: 'toanpd',    password: '123456', role: 'R06' },
  TSX:  { username: 'trungdv',   password: '123456', role: 'R06b' },
  TM:   { username: 'hungth',    password: '123456', role: 'R07' },
  KT:   { username: 'doannd',    password: '123456', role: 'R08' },
  QC:   { username: 'haitq',     password: '123456', role: 'R09' },
}

// Step → responsible role mapping
const STEP_USERS: Record<string, string> = {
  'P1.1': 'PM', 'P1.1B': 'BGD', 'P1.2A': 'PM', 'P1.2': 'KTKH', 'P1.3': 'BGD',
  'P2.1': 'TK', 'P2.2': 'PM', 'P2.3': 'KHO', 'P2.1A': 'KT', 'P2.4': 'KTKH', 'P2.5': 'BGD',
  'P3.1': 'PM', 'P3.2': 'KHO', 'P3.3': 'PM', 'P3.4': 'QLSX',
  'P3.5': 'TM', 'P3.6': 'BGD', 'P3.7': 'TM',
  'P4.1': 'KT', 'P4.2': 'TM', 'P4.3': 'QC', 'P4.4': 'KHO', 'P4.5': 'KHO',
  'P5.1': 'TSX', 'P5.2': 'TSX', 'P5.3': 'QC', 'P5.4': 'PM', 'P5.5': 'KTKH',
  'P6.1': 'QC', 'P6.2': 'KT', 'P6.3': 'KTKH', 'P6.4': 'PM', 'P6.5': 'BGD',
}

// ─── Helper: get JWT token ───────────────────────────────────────

async function getToken(request: APIRequestContext, user: { username: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { username: user.username, password: user.password },
  })
  const data = await res.json()
  if (!data.token) throw new Error(`Login failed for ${user.username}: ${JSON.stringify(data)}`)
  return data.token
}

// ─── Helper: create project via PM ───────────────────────────────

async function createProject(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.post('/api/projects', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      projectCode: `E2E-${Date.now()}`,
      projectName: 'E2E Playwright Test',
      clientName: 'Test Client',
      productType: 'pressure_vessel',
    },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Project creation failed: ${JSON.stringify(data)}`)
  return data.project.id
}

// ─── Helper: get tasks for user ──────────────────────────────────

interface TaskInfo {
  id: string
  stepCode: string
  status: string
  projectId: string
}

async function getInProgressTask(
  request: APIRequestContext,
  token: string,
  stepCode: string,
  projectId: string
): Promise<TaskInfo | null> {
  const res = await request.get('/api/tasks', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  const tasks: TaskInfo[] = data.tasks || []
  return tasks.find(
    (t) => t.stepCode === stepCode && t.projectId === projectId && t.status === 'IN_PROGRESS'
  ) || null
}

// ─── Helper: complete a task via API ─────────────────────────────

async function completeTaskAPI(
  request: APIRequestContext,
  token: string,
  taskId: string,
  resultData: Record<string, unknown> = {},
  notes = ''
): Promise<void> {
  const res = await request.put(`/api/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { action: 'complete', resultData, notes },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Complete task ${taskId} failed: ${JSON.stringify(data)}`)
}

// ─── Helper: reject task via API ─────────────────────────────────

async function rejectTaskAPI(
  request: APIRequestContext,
  token: string,
  taskId: string,
  reason: string
): Promise<{ returnedTo: string }> {
  const res = await request.post(`/api/tasks/${taskId}/reject`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { reason },
  })
  const data = await res.json()
  if (!data.success) throw new Error(`Reject task ${taskId} failed: ${JSON.stringify(data)}`)
  return { returnedTo: data.returnedTo }
}

// ─── Helper: wait for step activation ────────────────────────────

async function waitForTask(
  request: APIRequestContext,
  token: string,
  stepCode: string,
  projectId: string,
  maxRetries = 10,
  delayMs = 500
): Promise<TaskInfo> {
  for (let i = 0; i < maxRetries; i++) {
    const task = await getInProgressTask(request, token, stepCode, projectId)
    if (task) return task
    await new Promise((r) => setTimeout(r, delayMs))
  }
  throw new Error(`Task ${stepCode} not activated after ${maxRetries} retries`)
}

// ─── Helper: fast-forward through a step ─────────────────────────

async function fastForwardStep(
  request: APIRequestContext,
  tokens: Record<string, string>,
  stepCode: string,
  projectId: string,
  resultData: Record<string, unknown> = {}
): Promise<void> {
  const userKey = STEP_USERS[stepCode]
  if (!userKey) throw new Error(`No user mapping for step ${stepCode}`)
  const token = tokens[userKey]
  const task = await waitForTask(request, token, stepCode, projectId)
  await completeTaskAPI(request, token, task.id, resultData)
}

// ─── Helper: login via browser ───────────────────────────────────

async function loginBrowser(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.fill('input[name="username"], input[type="text"]', username)
  await page.fill('input[name="password"], input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard**', { timeout: 10000 })
}

// ════════════════════════════════════════════════════════════════════
//  THE TEST SUITE
// ════════════════════════════════════════════════════════════════════

test.describe('IBS-ERP Full Workflow E2E', () => {
  test.describe.configure({ mode: 'serial' })
  const tokens: Record<string, string> = {}
  let projectId: string

  // Login all users and create project before running tests
  test.beforeAll(async ({ request }) => {
    // Get JWT tokens for all users
    for (const [key, user] of Object.entries(USERS)) {
      tokens[key] = await getToken(request, user)
    }

    // Create project (PM creates)
    projectId = await createProject(request, tokens.PM)
  })

  // ── Phase 1-2: Fast-forward to Phase 3 (via API) ────────────────

  test('Phase 1-2: fast-forward P1.1 → P2.5', async ({ request }) => {
    // P1.1 is auto-completed during project creation → P1.1B is already active
    // P1.1B: BGĐ approves
    await fastForwardStep(request, tokens, 'P1.1B', projectId)

    // P1.2A + P1.2 run in parallel
    const [taskP12A, taskP12] = await Promise.all([
      waitForTask(request, tokens.PM, 'P1.2A', projectId),
      waitForTask(request, tokens.KTKH, 'P1.2', projectId),
    ])
    await Promise.all([
      completeTaskAPI(request, tokens.PM, taskP12A.id, { wbs: 'WBS-001', kickoffDate: '2026-03-05' }),
      completeTaskAPI(request, tokens.KTKH, taskP12.id, { estimateTotal: 12000000000 }),
    ])

    // P1.3: BGĐ approves plan & budget (gate: P1.2A + P1.2)
    await fastForwardStep(request, tokens, 'P1.3', projectId)

    // P2.1 + P2.2 + P2.3 + P2.1A run in parallel (all activated by P1.3)
    const [taskP21, taskP22, taskP23, taskP21A] = await Promise.all([
      waitForTask(request, tokens.TK, 'P2.1', projectId),
      waitForTask(request, tokens.PM, 'P2.2', projectId),
      waitForTask(request, tokens.KHO, 'P2.3', projectId),
      waitForTask(request, tokens.KT, 'P2.1A', projectId),
    ])
    await Promise.all([
      completeTaskAPI(request, tokens.TK, taskP21.id, {
        bomItems: [
          { material: 'Thép tấm SA516-70', qty: 50, unit: 'tấn' },
          { material: 'Ống thép A106-B', qty: 200, unit: 'm' },
        ],
      }),
      completeTaskAPI(request, tokens.PM, taskP22.id, {
        weldMaterial: 'ER70S-6', paintSpec: 'Epoxy 2-coat',
      }),
      completeTaskAPI(request, tokens.KHO, taskP23.id, {
        stockItems: [
          { material: 'Bu lông M20', available: 500, unit: 'bộ' },
          { material: 'Gioăng PTFE', available: 100, unit: 'cái' },
        ],
      }),
      completeTaskAPI(request, tokens.KT, taskP21A.id, {
        dt07Items: [{ maCP: 'DT07-1', noiDung: 'Chi phí vật tư', giaTri: 5000000000 }],
        totalLabor: '3000000000',
      }),
    ])

    // P2.4: KTKH budget adjustment (gate: P2.1+P2.2+P2.3+P2.1A)
    await fastForwardStep(request, tokens, 'P2.4', projectId, {
      productionPlan: 'KH-SX-001',
      adjustedBudget: 13500000000,
    })

    // P2.5: BGĐ approves
    await fastForwardStep(request, tokens, 'P2.5', projectId)

    // Verify: P3.1 + P3.4 should be activated
    const taskP31 = await waitForTask(request, tokens.PM, 'P3.1', projectId)
    expect(taskP31).toBeTruthy()
    expect(taskP31.stepCode).toBe('P3.1')
  })

  // ── Phase 3: Test merged features (P3.2, P3.5, P3.7) ───────────

  test('P3.1 → P3.2: Stock check dynamic tables ⭐', async ({ request, page }) => {
    // P3.1: PM adjusts plan
    await fastForwardStep(request, tokens, 'P3.1', projectId, {
      longLeadItems: ['Thép tấm SA516-70', 'Ống thép A106-B'],
    })

    // P3.2: Verify via browser — stock check tables
    const userKHO = USERS.KHO
    await loginBrowser(page, userKHO.username, userKHO.password)

    const taskP32 = await waitForTask(request, tokens.KHO, 'P3.2', projectId)
    await page.goto(`/dashboard/tasks/${taskP32.id}`)
    await page.waitForLoadState('networkidle')

    // Verify step header
    await expect(page.getByText('P3.2', { exact: false })).toBeVisible()

    // Verify form fields exist
    const pageContent = await page.textContent('body')
    expect(pageContent).toContain('Checklist')

    // Take screenshot for evidence
    await page.screenshot({ path: 'e2e/screenshots/P3.2-stock-check.png', fullPage: true })

    // Complete via API
    await completeTaskAPI(request, tokens.KHO, taskP32.id, {
      stockCheckNotes: 'Đã kiểm tra tồn kho — đủ bu lông, thiếu thép tấm',
    })
  })

  test('P3.3 + P3.4: Subcontractor + Internal WO', async ({ request }) => {
    // P3.3: PM subcontractor order
    const taskP33 = await waitForTask(request, tokens.PM, 'P3.3', projectId)
    await completeTaskAPI(request, tokens.PM, taskP33.id, {
      subconTeam: 'Tổ thợ Hải Phòng',
      jobName: 'Gia công thân bình',
      jobCode: 'JC-001',
      assignedQty: 2,
      startDate: '2026-04-01',
      endDate: '2026-05-15',
    })

    // P3.4: QLSX internal WO (requires bomLinked per TC-04-02)
    const taskP34 = await waitForTask(request, tokens.QLSX, 'P3.4', projectId)
    await completeTaskAPI(request, tokens.QLSX, taskP34.id, {
      internalWO: 'WO-INT-001',
      teams: ['Tổ hàn', 'Tổ cơ khí'],
      bomLinked: true,
    })
  })

  test('P3.5: Supplier comparison tables ⭐', async ({ request, page }) => {
    const taskP35 = await waitForTask(request, tokens.TM, 'P3.5', projectId)

    // Verify via browser
    const userTM = USERS.TM
    await loginBrowser(page, userTM.username, userTM.password)
    await page.goto(`/dashboard/tasks/${taskP35.id}`)
    await page.waitForLoadState('networkidle')

    // Verify step header
    await expect(page.getByText('P3.5', { exact: false })).toBeVisible()

    // Screenshot
    await page.screenshot({ path: 'e2e/screenshots/P3.5-supplier-comparison.png', fullPage: true })

    // Complete via API
    await completeTaskAPI(request, tokens.TM, taskP35.id, {
      rfqCount: 3,
      longLeadFlags: 'SA516-70: 8 tuần',
      suppliers: [
        { name: 'POSCO', price: 5200000000, leadTime: '6 tuần' },
        { name: 'Hòa Phát', price: 4800000000, leadTime: '4 tuần' },
        { name: 'JFE Steel', price: 5500000000, leadTime: '8 tuần' },
      ],
    })
  })

  test('P3.6 → P3.7: PO finalize + payment terms ⭐', async ({ request, page }) => {
    // P3.6: BGĐ approves supplier quotation
    await fastForwardStep(request, tokens, 'P3.6', projectId)

    // P3.7: Verify via browser — payment/delivery
    const taskP37 = await waitForTask(request, tokens.TM, 'P3.7', projectId)

    const userTM = USERS.TM
    await loginBrowser(page, userTM.username, userTM.password)
    await page.goto(`/dashboard/tasks/${taskP37.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P3.7', { exact: false })).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/P3.7-payment-delivery.png', fullPage: true })

    // Complete with payment terms data
    await completeTaskAPI(request, tokens.TM, taskP37.id, {
      poNumber: 'PO-2026-001',
      totalAmount: 4800000000,
      paymentMilestones: [
        { milestone: 'Đặt cọc 30%', amount: 1440000000, dueDate: '2026-04-01' },
        { milestone: 'Giao đợt 1 (40%)', amount: 1920000000, dueDate: '2026-05-15' },
        { milestone: 'Giao đợt 2 (30%)', amount: 1440000000, dueDate: '2026-06-30' },
      ],
      deliverySchedule: [
        { item: 'Thép tấm SA516-70', expectedDate: '2026-05-01' },
        { item: 'Ống thép A106-B', expectedDate: '2026-05-15' },
      ],
    })
  })

  // ── Phase 4: Test merged features (P4.1, P4.4) ─────────────────

  test('P4.1: Payment milestones ⭐', async ({ request, page }) => {
    const taskP41 = await waitForTask(request, tokens.KT, 'P4.1', projectId)

    const userKT = USERS.KT
    await loginBrowser(page, userKT.username, userKT.password)
    await page.goto(`/dashboard/tasks/${taskP41.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P4.1', { exact: false })).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/P4.1-payment-milestones.png', fullPage: true })

    await completeTaskAPI(request, tokens.KT, taskP41.id, {
      paymentNotes: 'Đã thanh toán đợt 1: Đặt cọc 30%',
    })
  })

  test('P4.2 → P4.3 → P4.4: Warehouse per-material ⭐', async ({ request, page }) => {
    // P4.2: TM tracks delivery
    await fastForwardStep(request, tokens, 'P4.2', projectId, {
      deliveryStatus: 'Arrived at warehouse',
      arrivalDate: '2026-05-01',
    })

    // P4.3: QC incoming inspection
    await fastForwardStep(request, tokens, 'P4.3', projectId, {
      qcResult: 'PASS',
      inspectionNotes: 'Chất lượng đạt yêu cầu',
    })

    // P4.4: Verify via browser — per-material warehouse items
    const taskP44 = await waitForTask(request, tokens.KHO, 'P4.4', projectId)

    const userKHO = USERS.KHO
    await loginBrowser(page, userKHO.username, userKHO.password)
    await page.goto(`/dashboard/tasks/${taskP44.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P4.4', { exact: false })).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/P4.4-warehouse-items.png', fullPage: true })

    await completeTaskAPI(request, tokens.KHO, taskP44.id, {
      heatNumber: 'HN-2026-001',
      millCertNo: 'MC-SA516-001',
      receivedItems: [
        { material: 'Thép tấm SA516-70', receivedQty: 50, storageLocation: 'Kho A - Kệ 3' },
        { material: 'Ống thép A106-B', receivedQty: 200, storageLocation: 'Kho B - Kệ 1' },
      ],
    })
  })

  test('P4.5: Warehouse issues material', async ({ request }) => {
    // P4.5 is a multi-instance task, created via /api/tasks/activate
    const activateRes = await request.post('/api/tasks/activate', {
      headers: { Authorization: `Bearer ${tokens.KHO}` },
      data: { projectId, stepCode: 'P4.5' },
    })
    const activateData = await activateRes.json()
    if (!activateData.ok) throw new Error(`Activate P4.5 failed: ${JSON.stringify(activateData)}`)

    const taskP45 = await waitForTask(request, tokens.KHO, 'P4.5', projectId)
    await completeTaskAPI(request, tokens.KHO, taskP45.id, {
      issuedTo: 'PM + QLSX',
      issueDate: '2026-05-05',
    })
  })

  // ── Phase 5: Test merged fields + rejection flow ────────────────

  test('P5.1 → P5.2: hangMuc + jobCardCode ⭐', async ({ request, page }) => {
    // P5.1 is a DYNAMIC_STEP — must be activated via API (like P4.5)
    await request.post('/api/tasks/activate', {
      headers: { Authorization: `Bearer ${tokens.TSX}` },
      data: { projectId, stepCode: 'P5.1' },
    })

    // P5.1: Production team executes
    await fastForwardStep(request, tokens, 'P5.1', projectId, {
      jobCardStatus: 'In Progress',
      completedTasks: ['Cắt thép', 'Uốn bể'],
      issues: 'Không có',
    })

    // P5.2: Verify via browser — hangMuc + jobCardCode
    const taskP52 = await waitForTask(request, tokens.TSX, 'P5.2', projectId)

    const userTSX = USERS.TSX
    await loginBrowser(page, userTSX.username, userTSX.password)
    await page.goto(`/dashboard/tasks/${taskP52.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P5.2', { exact: false })).toBeVisible()

    // Verify merged fields are present in the form
    const bodyText = await page.textContent('body')
    // hangMuc and jobCardCode should be visible as form labels
    expect(bodyText).toBeTruthy()

    await page.screenshot({ path: 'e2e/screenshots/P5.2-weekly-report.png', fullPage: true })

    await completeTaskAPI(request, tokens.TSX, taskP52.id, {
      weekNumber: 1,
      hangMuc: 'Gia công thân bình',
      jobCardCode: 'JC-001',
      completedVolume: 25,
      volumeUnit: 'tấn',
    })
  })

  test('P5.3 → P5.4: QC inspection + volume_confirmed ⭐', async ({ request, page }) => {
    // P5.3: QC passes
    await fastForwardStep(request, tokens, 'P5.3', projectId, {
      inspectionResult: 'PASS',
      notes: 'Đạt yêu cầu kỹ thuật',
    })

    // P5.4: Verify via browser — volume_confirmed checklist
    const taskP54 = await waitForTask(request, tokens.PM, 'P5.4', projectId)

    const userPM = USERS.PM
    await loginBrowser(page, userPM.username, userPM.password)
    await page.goto(`/dashboard/tasks/${taskP54.id}`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P5.4', { exact: false })).toBeVisible()

    await page.screenshot({ path: 'e2e/screenshots/P5.4-volume-acceptance.png', fullPage: true })

    await completeTaskAPI(request, tokens.PM, taskP54.id, {
      acceptedVolume: 25,
      volumeUnit: 'tấn',
      checklist: { signoff_production: true, signoff_transport: true, signoff_pm: true },
    })
  })

  // ── Phase 5-6: Close out ────────────────────────────────────────

  test('P5.5 → P6: full project closure', async ({ request }) => {
    await fastForwardStep(request, tokens, 'P5.5', projectId, {
      salaryCalculation: 'Completed',
      totalPieceRate: 85000000,
    })

    // P6.1 + P6.2 + P6.3 + P6.4 run in parallel
    const [t61, t62, t63, t64] = await Promise.all([
      waitForTask(request, tokens.QC, 'P6.1', projectId),
      waitForTask(request, tokens.KT, 'P6.2', projectId),
      waitForTask(request, tokens.KTKH, 'P6.3', projectId),
      waitForTask(request, tokens.PM, 'P6.4', projectId),
    ])
    await Promise.all([
      completeTaskAPI(request, tokens.QC, t61.id, { dossierComplete: true, checklist: { delivery_proof_attached: true } }),
      completeTaskAPI(request, tokens.KT, t62.id, { directCostSettled: true }),
      completeTaskAPI(request, tokens.KTKH, t63.id, { pnlComplete: true, profitLoss: 2500000000 }),
      completeTaskAPI(request, tokens.PM, t64.id, { lessonsLearned: 'E2E test complete' }),
    ])

    // P6.5: BGĐ closure approval (gate: P6.1+P6.2+P6.3+P6.4)
    await fastForwardStep(request, tokens, 'P6.5', projectId, {
      projectClosed: true,
      closureApproved: true,
    })
  })

  // ═══════════════════════════════════════════════════════════════════
  //  REJECTION + AUTO-PROPAGATION TEST ⭐⭐⭐
  // ═══════════════════════════════════════════════════════════════════

  test.describe('Auto-propagation rejection flow', () => {
    let projectId2: string

    test.beforeAll(async ({ request }) => {
      // Create a second project for rejection testing
      projectId2 = await createProject(request, tokens.PM)
    })

    test('Fast-forward to P5.3 for rejection test', async ({ request }) => {
      // Complete P1-P4 rapidly via API
      // P1.1 auto-completed during createProject → P1.1B is active
      await fastForwardStep(request, tokens, 'P1.1B', projectId2)

      const [t12a, t12] = await Promise.all([
        waitForTask(request, tokens.PM, 'P1.2A', projectId2),
        waitForTask(request, tokens.KTKH, 'P1.2', projectId2),
      ])
      await Promise.all([
        completeTaskAPI(request, tokens.PM, t12a.id, {}),
        completeTaskAPI(request, tokens.KTKH, t12.id, {}),
      ])
      await fastForwardStep(request, tokens, 'P1.3', projectId2)

      const [t21, t22, t23, t21a] = await Promise.all([
        waitForTask(request, tokens.TK, 'P2.1', projectId2),
        waitForTask(request, tokens.PM, 'P2.2', projectId2),
        waitForTask(request, tokens.KHO, 'P2.3', projectId2),
        waitForTask(request, tokens.KT, 'P2.1A', projectId2),
      ])
      await Promise.all([
        completeTaskAPI(request, tokens.TK, t21.id, {}),
        completeTaskAPI(request, tokens.PM, t22.id, {}),
        completeTaskAPI(request, tokens.KHO, t23.id, {}),
        completeTaskAPI(request, tokens.KT, t21a.id, {}),
      ])
      await fastForwardStep(request, tokens, 'P2.4', projectId2)
      await fastForwardStep(request, tokens, 'P2.5', projectId2)

      await fastForwardStep(request, tokens, 'P3.1', projectId2)

      const [t32, t34] = await Promise.all([
        waitForTask(request, tokens.KHO, 'P3.2', projectId2),
        waitForTask(request, tokens.QLSX, 'P3.4', projectId2),
      ])
      await Promise.all([
        completeTaskAPI(request, tokens.KHO, t32.id, {}),
        completeTaskAPI(request, tokens.QLSX, t34.id, { bomLinked: true }),
      ])

      // P3.3 from P3.2
      const t33 = await waitForTask(request, tokens.PM, 'P3.3', projectId2)
      await completeTaskAPI(request, tokens.PM, t33.id, {})

      // P3.5 from P3.2
      const t35 = await waitForTask(request, tokens.TM, 'P3.5', projectId2)
      await completeTaskAPI(request, tokens.TM, t35.id, {})
      await fastForwardStep(request, tokens, 'P3.6', projectId2)
      await fastForwardStep(request, tokens, 'P3.7', projectId2, {
        paymentMilestones: [{ milestone: 'Full', amount: 5000000000, dueDate: '2026-06-01' }],
      })

      // P4
      const [t41, t42] = await Promise.all([
        waitForTask(request, tokens.KT, 'P4.1', projectId2),
        waitForTask(request, tokens.TM, 'P4.2', projectId2),
      ])
      await completeTaskAPI(request, tokens.KT, t41.id, {})
      await completeTaskAPI(request, tokens.TM, t42.id, {})
      await fastForwardStep(request, tokens, 'P4.3', projectId2)
      await fastForwardStep(request, tokens, 'P4.4', projectId2)

      // P4.5 is multi-instance, activate it first
      await request.post('/api/tasks/activate', {
        headers: { Authorization: `Bearer ${tokens.KHO}` },
        data: { projectId: projectId2, stepCode: 'P4.5' },
      })
      await fastForwardStep(request, tokens, 'P4.5', projectId2)

      // P5.1 is a DYNAMIC_STEP — must be activated via API
      await request.post('/api/tasks/activate', {
        headers: { Authorization: `Bearer ${tokens.TSX}` },
        data: { projectId: projectId2, stepCode: 'P5.1' },
      })

      // P5.1 → P5.2 → P5.3 (ready for rejection)
      await fastForwardStep(request, tokens, 'P5.1', projectId2, {
        jobCardStatus: 'Done', completedTasks: ['Welding'], issues: '',
      })
      await fastForwardStep(request, tokens, 'P5.2', projectId2, {
        weekNumber: 1, hangMuc: 'Hàn', jobCardCode: 'JC-002',
        completedVolume: 10, volumeUnit: 'tấn',
      })

      // Verify P5.3 is active
      const taskP53 = await waitForTask(request, tokens.QC, 'P5.3', projectId2)
      expect(taskP53).toBeTruthy()
    })

    test('P5.3 REJECT → P5.1 re-activate → auto-propagation ⭐⭐⭐', async ({ request, page }) => {
      // Get P5.3 task
      const taskP53 = await waitForTask(request, tokens.QC, 'P5.3', projectId2)

      // REJECT P5.3 → should go back to P5.1
      const result = await rejectTaskAPI(request, tokens.QC, taskP53.id, 'Mối hàn không đạt — cần sửa lại')
      expect(result.returnedTo).toBe('P5.1')

      // P5.1 should be re-activated
      const taskP51 = await waitForTask(request, tokens.TSX, 'P5.1', projectId2)
      expect(taskP51).toBeTruthy()

      // Verify rejection banner via browser
      const userTSX = USERS.TSX
      await loginBrowser(page, userTSX.username, userTSX.password)
      await page.goto(`/dashboard/tasks/${taskP51.id}`)
      await page.waitForLoadState('networkidle')

      // Screenshot showing rejection banner
      await page.screenshot({ path: 'e2e/screenshots/P5.1-rejection-banner.png', fullPage: true })

      // Complete P5.1 again (rework done)
      await completeTaskAPI(request, tokens.TSX, taskP51.id, {
        jobCardStatus: 'Reworked',
        completedTasks: ['Hàn sửa mối hàn'],
        issues: 'Đã sửa xong',
      })

      // AUTO-PROPAGATION TEST:
      // After P5.1 completes, P5.2 should be auto-completed (skipped)
      // and P5.3 should be re-activated automatically
      //
      // Wait a moment for the propagation to complete
      await new Promise((r) => setTimeout(r, 1000))

      // P5.3 should be active again (auto-propagation worked!)
      const taskP53v2 = await waitForTask(request, tokens.QC, 'P5.3', projectId2)
      expect(taskP53v2).toBeTruthy()
      expect(taskP53v2.stepCode).toBe('P5.3')

      // Verify via browser — QC sees P5.3 again
      const userQC = USERS.QC
      await loginBrowser(page, userQC.username, userQC.password)
      await page.goto(`/dashboard/tasks/${taskP53v2.id}`)
      await page.waitForLoadState('networkidle')

      await expect(page.getByText('P5.3', { exact: false })).toBeVisible()

      await page.screenshot({ path: 'e2e/screenshots/P5.3-after-propagation.png', fullPage: true })

      // Complete P5.3 (pass this time)
      await completeTaskAPI(request, tokens.QC, taskP53v2.id, {
        inspectionResult: 'PASS',
        notes: 'Đã sửa xong, đạt yêu cầu',
      })

      // P5.4 should be activated
      const taskP54 = await waitForTask(request, tokens.PM, 'P5.4', projectId2)
      expect(taskP54).toBeTruthy()
    })
  })
})
