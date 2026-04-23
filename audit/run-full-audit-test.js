/**
 * Full Workflow Audit Test: Complete all steps from current state → P5.4
 * Uses real API calls through localhost:3000
 */
const jwt = require('jsonwebtoken');
const pg = require('pg');

const JWT_SECRET = 'ibshi-erp-secret-key-2026';
const API_BASE = 'http://localhost:3000/api';
const DB_URL = 'postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi';

// ── Users for each role ──
const ROLE_USERS = {
  R01: { userId: 'cmn0htesd00127s1zpnn0dh7s', username: 'vinhnq', roleCode: 'R01', userLevel: 1, fullName: 'Nguyễn Quang Vinh' },
  R02: { userId: 'cmn0htexh001b7s1zv1q329ge', username: 'giangdd', roleCode: 'R02', userLevel: 1, fullName: 'Đinh Đức Giang' },
  R03: { userId: 'cmn0htegw000i7s1zqzn7cuju', username: 'samld', roleCode: 'R03', userLevel: 1, fullName: 'Lê Đình Sâm' },
  R04: { userId: 'cmn0htf09001g7s1zzgws3a39', username: 'luudt', roleCode: 'R04', userLevel: 1, fullName: 'Đỗ Trọng Lưu' },
  R05: { userId: 'cmn0hteti00147s1z0bg71g3t', username: 'luongnth', roleCode: 'R05', userLevel: 1, fullName: 'Nguyễn Thị Hiền Lương' },
  R06: { userId: 'cmn0htecf000a7s1zztpbuh8a', username: 'toanpd', roleCode: 'R06', userLevel: 1, fullName: 'Phạm Đăng Toàn' },
  R06b: { userId: 'cmn0htegc000h7s1zlpe6h0wg', username: 'trungdv', roleCode: 'R06b', userLevel: 1, fullName: 'Đặng Văn Trung' },
  R07: { userId: 'cmn0hteup00167s1zfomkwkhw', username: 'hungth', roleCode: 'R07', userLevel: 1, fullName: 'Trịnh Hữu Hưng' },
  R08: { userId: 'cmn0hteq1000y7s1znbelf7gr', username: 'doannd', roleCode: 'R08', userLevel: 1, fullName: 'Nguyễn Đình Đoan' },
  R09: { userId: 'cmn0htej3000m7s1z5yff92cx', username: 'haitq', roleCode: 'R09', userLevel: 1, fullName: 'Trần Quang Hải' },
};

function makeToken(role) {
  return jwt.sign(ROLE_USERS[role], JWT_SECRET, { expiresIn: 3600 });
}

async function apiCall(method, path, body, role) {
  const token = makeToken(role);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!data.ok) {
    console.error(`  ❌ ${method} ${path} failed:`, data.error || data);
  }
  return data;
}

async function getTaskId(client, projectId, stepCode, status) {
  const q = status
    ? `SELECT id, status FROM workflow_tasks WHERE project_id = $1 AND step_code = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1`
    : `SELECT id, status FROM workflow_tasks WHERE project_id = $1 AND step_code = $2 ORDER BY created_at DESC LIMIT 1`;
  const params = status ? [projectId, stepCode, status] : [projectId, stepCode];
  const { rows } = await client.query(q, params);
  return rows[0] || null;
}

async function completeStep(client, projectId, stepCode, resultData, role, notes) {
  const task = await getTaskId(client, projectId, stepCode, 'IN_PROGRESS');
  if (!task) {
    console.log(`  ⚠️  ${stepCode} not IN_PROGRESS, checking PENDING...`);
    const pending = await getTaskId(client, projectId, stepCode, 'PENDING');
    if (pending) {
      console.log(`  ⚠️  ${stepCode} is PENDING (id: ${pending.id}), skipping`);
    } else {
      console.log(`  ⚠️  ${stepCode} not found at all`);
    }
    return null;
  }

  console.log(`  → Completing ${stepCode} (task: ${task.id.substring(0, 12)}...)`);

  // First save the resultData
  const saveRes = await apiCall('PUT', `/tasks/${task.id}`, {
    action: 'save',
    resultData,
  }, role);
  if (!saveRes.ok) return null;

  // Then complete
  const completeRes = await apiCall('PUT', `/tasks/${task.id}`, {
    action: 'complete',
    resultData,
    notes: notes || `Audit test: ${stepCode}`,
  }, role);

  if (completeRes.ok) {
    console.log(`  ✅ ${stepCode} completed`);
  }
  return completeRes;
}

// Wait for a step to become IN_PROGRESS (workflow engine activates it async)
async function waitForStep(client, projectId, stepCode, maxWait = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const task = await getTaskId(client, projectId, stepCode, 'IN_PROGRESS');
    if (task) return task;
    await new Promise(r => setTimeout(r, 500));
  }
  // Check if it's DONE already
  const done = await getTaskId(client, projectId, stepCode, 'DONE');
  if (done) return done;
  console.log(`  ⏳ ${stepCode} did not activate within ${maxWait}ms`);
  return null;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  const { rows: [project] } = await client.query("SELECT id FROM projects WHERE project_code = 'DA-26-Test'");
  const projectId = project.id;
  console.log('Project ID:', projectId);

  // ═══════════════════════════════════════════════
  // STEP 1: Complete P3.3 (PM - Subcontractor LSX)
  // ═══════════════════════════════════════════════
  console.log('\n── P3.3: PM lập lệnh SX cho thầu phụ ──');
  const p33Task = await getTaskId(client, projectId, 'P3.3', 'IN_PROGRESS');
  if (p33Task) {
    // P3.3 already has cellAssignments, just need to complete it
    const p33Get = await apiCall('GET', `/tasks/${p33Task.id}`, null, 'R02');
    const existingData = p33Get.task?.resultData || {};
    await completeStep(client, projectId, 'P3.3', existingData, 'R02', 'Audit: Complete P3.3 subcontractor LSX');
  }

  // ═══════════════════════════════════════════════
  // STEP 2: Complete P3.4 (Production - Internal WO)
  // ═══════════════════════════════════════════════
  console.log('\n── P3.4: QLSX lập lệnh SX nội bộ ──');
  const p34Task = await getTaskId(client, projectId, 'P3.4', 'IN_PROGRESS');
  if (p34Task) {
    const p34Get = await apiCall('GET', `/tasks/${p34Task.id}`, null, 'R06');
    const existingData = p34Get.task?.resultData || {};
    await completeStep(client, projectId, 'P3.4', existingData, 'R06', 'Audit: Complete P3.4 internal WO');
  }

  // ═══════════════════════════════════════════════
  // STEP 3: Complete P3.5 (Commercial - Find Suppliers)
  // ═══════════════════════════════════════════════
  console.log('\n── P3.5: Thương mại tìm NCC ──');
  await waitForStep(client, projectId, 'P3.5');
  await completeStep(client, projectId, 'P3.5', {
    suppliers: JSON.stringify([
      {
        name: 'NCC Thép Hòa Phát',
        quotes: [
          { material: 'Thép tấm SS400 10mm', price: '18500000' },
          { material: 'Thép tấm SS400 16mm', price: '22800000' },
          { material: 'Thép hình H200', price: '15600000' },
        ]
      },
      {
        name: 'NCC Thép Posco',
        quotes: [
          { material: 'Thép tấm SS400 10mm', price: '19200000' },
          { material: 'Thép tấm SS400 16mm', price: '23500000' },
          { material: 'Thép hình H200', price: '16100000' },
        ]
      },
      {
        name: 'NCC Sơn Jotun',
        quotes: [
          { material: 'Sơn lót Epoxy', price: '4500000' },
          { material: 'Sơn phủ PU', price: '6800000' },
        ]
      }
    ]),
    checklist: { supplier_verified: true, quote_compared: true },
    paymentType: 'full',
    deliveryType: 'full',
  }, 'R07', 'Audit: P3.5 supplier quotes submitted');

  // ═══════════════════════════════════════════════
  // STEP 4: P3.6 (BGĐ approve supplier quotes)
  // ═══════════════════════════════════════════════
  console.log('\n── P3.6: BGĐ phê duyệt báo giá NCC ──');
  await waitForStep(client, projectId, 'P3.6');
  await completeStep(client, projectId, 'P3.6', {
    checklist: { quote_reviewed: true, budget_compared: true },
    supplierApproved: true,
    approvedSupplier: 'NCC Thép Hòa Phát',
    paymentType: 'full',
    deliveryType: 'full',
  }, 'R01', 'Audit: P3.6 supplier quotes approved');

  // ═══════════════════════════════════════════════
  // STEP 5: P3.7 (Commercial finalize PO)
  // ═══════════════════════════════════════════════
  console.log('\n── P3.7: Thương mại chốt hàng ──');
  await waitForStep(client, projectId, 'P3.7');
  await completeStep(client, projectId, 'P3.7', {
    poNumber: 'PO-DA26-001',
    totalAmount: '890000000',
    paymentType: 'partial',
    paymentMilestones: JSON.stringify([
      { label: 'Tạm ứng 30%', percent: '30', date: '2026-04-20' },
      { label: 'Giao hàng đợt 1 - 40%', percent: '40', date: '2026-05-10' },
      { label: 'Nghiệm thu cuối - 30%', percent: '30', date: '2026-05-25' },
    ]),
    deliveryDate: '2026-05-15',
    deliveryType: 'full',
    checklist: { po_confirmed: true, payment_terms_agreed: true },
  }, 'R07', 'Audit: P3.7 PO finalized');

  // ═══════════════════════════════════════════════
  // STEP 6: P4.1 (Finance process payment)
  // ═══════════════════════════════════════════════
  console.log('\n── P4.1: Kế toán thanh toán ──');
  await waitForStep(client, projectId, 'P4.1');
  await completeStep(client, projectId, 'P4.1', {
    paymentRef: 'CK-DA26-001',
    paymentAmount: '267000000',
    paymentDate: '2026-04-20',
    paymentMethod: 'bank_transfer',
    bankName: 'Vietcombank',
    milestone: 'Tạm ứng 30%',
    checklist: { payment_verified: true, receipt_attached: true },
    paymentType: 'full',
    deliveryType: 'full',
  }, 'R08', 'Audit: P4.1 advance payment 30%');

  // ═══════════════════════════════════════════════
  // STEP 7: P4.2 (Commercial track delivery)
  // ═══════════════════════════════════════════════
  console.log('\n── P4.2: Thương mại theo dõi hàng về ──');
  await waitForStep(client, projectId, 'P4.2');
  await completeStep(client, projectId, 'P4.2', {
    deliveryCode: 'DLV-DA26-001',
    receivedDate: '2026-05-10',
    deliveryNote: 'Nhận đủ VT theo PO',
    itemsReceived: JSON.stringify([
      { material: 'Thép tấm SS400 10mm', qty: 5000, unit: 'kg', status: 'OK' },
      { material: 'Thép tấm SS400 16mm', qty: 3200, unit: 'kg', status: 'OK' },
      { material: 'Thép hình H200', qty: 2800, unit: 'kg', status: 'OK' },
    ]),
    checklist: { delivery_confirmed: true, packing_list_matched: true },
    paymentType: 'full',
    deliveryType: 'full',
  }, 'R07', 'Audit: P4.2 delivery received');

  // ═══════════════════════════════════════════════
  // STEP 8: P4.3 (QC incoming inspection)
  // ═══════════════════════════════════════════════
  console.log('\n── P4.3: QC nghiệm thu chất lượng ──');
  await waitForStep(client, projectId, 'P4.3');
  await completeStep(client, projectId, 'P4.3', {
    inspectionResult: 'PASS',
    qcItems: JSON.stringify([
      { task: 'Kiểm tra kích thước thép tấm 10mm', result: 'Đạt - sai lệch < 0.5mm' },
      { task: 'Kiểm tra kích thước thép tấm 16mm', result: 'Đạt - sai lệch < 0.3mm' },
      { task: 'Kiểm tra Mill Cert thép hình H200', result: 'Đạt - phù hợp ASTM A36' },
      { task: 'Kiểm tra bề mặt vật tư', result: 'Đạt - không rỗ, không nứt' },
    ]),
    checklist: { visual_ok: true, dimension_ok: true, cert_ok: true },
    paymentType: 'full',
    deliveryType: 'full',
  }, 'R09', 'Audit: P4.3 QC passed');

  // ═══════════════════════════════════════════════
  // STEP 9: P4.4 (Warehouse stock-in)
  // ═══════════════════════════════════════════════
  console.log('\n── P4.4: Kho nhập kho ──');
  await waitForStep(client, projectId, 'P4.4');
  await completeStep(client, projectId, 'P4.4', {
    grnNumber: 'GRN-DA26-001',
    stockInDate: '2026-05-11',
    stockInItems: JSON.stringify([
      { material: 'Thép tấm SS400 10mm', code: 'VT-001', qty: 5000, unit: 'kg', location: 'Kho A1' },
      { material: 'Thép tấm SS400 16mm', code: 'VT-002', qty: 3200, unit: 'kg', location: 'Kho A1' },
      { material: 'Thép hình H200', code: 'VT-003', qty: 2800, unit: 'kg', location: 'Kho B2' },
    ]),
    checklist: { quantity_matched: true, storage_allocated: true, system_updated: true },
    paymentType: 'full',
    deliveryType: 'full',
  }, 'R05', 'Audit: P4.4 stock-in completed');

  // ═══════════════════════════════════════════════
  // STEP 10: P4.5 (Warehouse issue material) - multiple may exist
  // ═══════════════════════════════════════════════
  console.log('\n── P4.5: Kho cấp vật tư ──');
  // Complete any remaining IN_PROGRESS P4.5 tasks
  const { rows: p45Tasks } = await client.query(
    `SELECT id, step_name, result_data FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P4.5' AND status = 'IN_PROGRESS' ORDER BY created_at`,
    [projectId]
  );
  for (const t of p45Tasks) {
    console.log(`  → Completing P4.5: ${t.step_name} (${t.id.substring(0, 12)}...)`);
    const existingData = t.result_data || {};
    const res = await apiCall('PUT', `/tasks/${t.id}`, {
      action: 'complete',
      resultData: {
        ...existingData,
        issuedDate: '2026-05-12',
        checklist: { material_verified: true, issued_to_team: true },
      },
      notes: 'Audit: P4.5 material issued',
    }, 'R05');
    if (res.ok) console.log(`  ✅ P4.5 completed: ${t.step_name}`);
  }
  // Also complete PENDING P4.5 tasks
  const { rows: p45Pending } = await client.query(
    `SELECT id, step_name FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P4.5' AND status = 'PENDING' ORDER BY created_at`,
    [projectId]
  );
  for (const t of p45Pending) {
    console.log(`  → P4.5 PENDING: ${t.step_name} — skipping (needs activation first)`);
  }

  // ═══════════════════════════════════════════════
  // STEP 11: P5.1 (Internal daily production report)
  // ═══════════════════════════════════════════════
  console.log('\n── P5.1: Báo cáo khối lượng nội bộ ──');
  // P5.1 tasks are created by P4.5 completion
  await new Promise(r => setTimeout(r, 2000)); // Wait for P4.5 hooks
  const { rows: p51Tasks } = await client.query(
    `SELECT id, step_name, result_data, status FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P5.1' ORDER BY created_at`,
    [projectId]
  );
  console.log(`  Found ${p51Tasks.length} P5.1 tasks`);
  for (const t of p51Tasks) {
    if (t.status !== 'IN_PROGRESS') {
      console.log(`  → P5.1 ${t.id.substring(0, 12)}... is ${t.status}, skipping`);
      continue;
    }
    console.log(`  → Completing P5.1: ${t.step_name} (${t.id.substring(0, 12)}...)`);
    const existingData = t.result_data || {};
    const res = await apiCall('PUT', `/tasks/${t.id}`, {
      action: 'complete',
      resultData: {
        ...existingData,
        dailyReport: JSON.stringify([
          { date: '2026-05-12', stage: 'cutting', volume: 500, unit: 'kg', team: 'Tổ Cắt 1' },
          { date: '2026-05-13', stage: 'cutting', volume: 650, unit: 'kg', team: 'Tổ Cắt 1' },
          { date: '2026-05-14', stage: 'fitup', volume: 300, unit: 'kg', team: 'Tổ Gá 1' },
          { date: '2026-05-15', stage: 'welding', volume: 250, unit: 'kg', team: 'Tổ Hàn 1' },
        ]),
        totalVolume: 1700,
        reportPeriod: '2026-05-12 to 2026-05-15',
      },
      notes: 'Audit: P5.1 daily report submitted',
    }, 'R06b');
    if (res.ok) console.log(`  ✅ P5.1 completed`);
    else console.log(`  Result:`, JSON.stringify(res).substring(0, 200));
  }

  // ═══════════════════════════════════════════════
  // STEP 12: P5.1A (Subcontractor daily production report)
  // ═══════════════════════════════════════════════
  console.log('\n── P5.1A: Báo cáo khối lượng thầu phụ ──');
  const { rows: p51aTasks } = await client.query(
    `SELECT id, step_name, result_data, status FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P5.1A' ORDER BY created_at`,
    [projectId]
  );
  console.log(`  Found ${p51aTasks.length} P5.1A tasks`);
  for (const t of p51aTasks) {
    if (t.status !== 'IN_PROGRESS') {
      console.log(`  → P5.1A ${t.id.substring(0, 12)}... is ${t.status}, skipping`);
      continue;
    }
    console.log(`  → Completing P5.1A: ${t.step_name} (${t.id.substring(0, 12)}...)`);
    const existingData = t.result_data || {};
    const res = await apiCall('PUT', `/tasks/${t.id}`, {
      action: 'complete',
      resultData: {
        ...existingData,
        dailyReport: JSON.stringify([
          { date: '2026-05-12', stage: 'fitup', volume: 400, unit: 'kg', team: 'TP Huyền Trang' },
          { date: '2026-05-13', stage: 'welding', volume: 350, unit: 'kg', team: 'TP Huyền Trang' },
          { date: '2026-05-14', stage: 'fitup', volume: 380, unit: 'kg', team: 'TP Huyền Trang' },
        ]),
        totalVolume: 1130,
        reportPeriod: '2026-05-12 to 2026-05-14',
      },
      notes: 'Audit: P5.1A subcontractor report submitted',
    }, 'R02');
    if (res.ok) console.log(`  ✅ P5.1A completed`);
    else console.log(`  Result:`, JSON.stringify(res).substring(0, 200));
  }

  // ═══════════════════════════════════════════════
  // STEP 13: P5.2 (Weekly production volume report)
  // ═══════════════════════════════════════════════
  console.log('\n── P5.2: Báo cáo khối lượng tuần ──');
  await new Promise(r => setTimeout(r, 2000));
  const { rows: p52Tasks } = await client.query(
    `SELECT id, step_name, result_data, status FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P5.2' ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );
  if (p52Tasks.length > 0 && p52Tasks[0].status === 'IN_PROGRESS') {
    const t = p52Tasks[0];
    console.log(`  → Completing P5.2: ${t.step_name}`);
    const res = await apiCall('PUT', `/tasks/${t.id}`, {
      action: 'complete',
      resultData: {
        ...t.result_data,
        weekNumber: 20,
        year: 2026,
        weekStartDate: '2026-05-11',
        weekEndDate: '2026-05-17',
        weeklyVolume: JSON.stringify([
          { hangMuc: 'MLI1645', stage: 'cutting', volume: 1150, unit: 'kg' },
          { hangMuc: 'MLI1645', stage: 'fitup', volume: 700, unit: 'kg' },
          { hangMuc: 'MLI1645', stage: 'welding', volume: 600, unit: 'kg' },
          { hangMuc: 'MLI1652', stage: 'cutting', volume: 800, unit: 'kg' },
        ]),
        totalWeeklyVolume: 3250,
      },
      notes: 'Audit: P5.2 weekly report W20/2026',
    }, 'R06b');
    if (res.ok) console.log(`  ✅ P5.2 completed`);
    else console.log(`  Result:`, JSON.stringify(res).substring(0, 200));
  } else {
    console.log(`  ⚠️  P5.2 not IN_PROGRESS (status: ${p52Tasks[0]?.status || 'not found'})`);
  }

  // ═══════════════════════════════════════════════
  // STEP 14: P5.3 (QC weekly volume acceptance)
  // ═══════════════════════════════════════════════
  console.log('\n── P5.3: QC nghiệm thu khối lượng tuần ──');
  await new Promise(r => setTimeout(r, 2000));
  const { rows: p53Tasks } = await client.query(
    `SELECT id, step_name, result_data, status FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P5.3' ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );
  if (p53Tasks.length > 0 && p53Tasks[0].status === 'IN_PROGRESS') {
    const t = p53Tasks[0];
    console.log(`  → Completing P5.3: ${t.step_name}`);
    const res = await apiCall('PUT', `/tasks/${t.id}`, {
      action: 'complete',
      resultData: {
        ...t.result_data,
        weekNumber: 20,
        year: 2026,
        acceptedVolume: JSON.stringify([
          { hangMuc: 'MLI1645', stage: 'cutting', reported: 1150, accepted: 1120, unit: 'kg', note: 'OK - sai lệch 30kg do scrap' },
          { hangMuc: 'MLI1645', stage: 'fitup', reported: 700, accepted: 700, unit: 'kg', note: 'OK' },
          { hangMuc: 'MLI1645', stage: 'welding', reported: 600, accepted: 580, unit: 'kg', note: 'Trừ 20kg rework' },
          { hangMuc: 'MLI1652', stage: 'cutting', reported: 800, accepted: 800, unit: 'kg', note: 'OK' },
        ]),
        totalAccepted: 3200,
        totalReported: 3250,
        qcResult: 'PASS',
        checklist: { volume_verified: true, quality_ok: true },
      },
      notes: 'Audit: P5.3 QC accepted W20/2026',
    }, 'R09');
    if (res.ok) console.log(`  ✅ P5.3 completed`);
    else console.log(`  Result:`, JSON.stringify(res).substring(0, 200));
  } else {
    console.log(`  ⚠️  P5.3 not IN_PROGRESS (status: ${p53Tasks[0]?.status || 'not found'})`);
  }

  // ═══════════════════════════════════════════════
  // STEP 15: P5.4 (PM weekly volume acceptance)
  // ═══════════════════════════════════════════════
  console.log('\n── P5.4: PM nghiệm thu khối lượng tuần ──');
  await new Promise(r => setTimeout(r, 2000));
  const { rows: p54Tasks } = await client.query(
    `SELECT id, step_name, result_data, status FROM workflow_tasks WHERE project_id = $1 AND step_code = 'P5.4' ORDER BY created_at DESC LIMIT 1`,
    [projectId]
  );
  if (p54Tasks.length > 0 && p54Tasks[0].status === 'IN_PROGRESS') {
    const t = p54Tasks[0];
    console.log(`  → Completing P5.4: ${t.step_name}`);
    const res = await apiCall('PUT', `/tasks/${t.id}`, {
      action: 'complete',
      resultData: {
        ...t.result_data,
        weekNumber: 20,
        year: 2026,
        pmAcceptedVolume: JSON.stringify([
          { hangMuc: 'MLI1645', stage: 'cutting', qcAccepted: 1120, pmAccepted: 1120, unit: 'kg' },
          { hangMuc: 'MLI1645', stage: 'fitup', qcAccepted: 700, pmAccepted: 700, unit: 'kg' },
          { hangMuc: 'MLI1645', stage: 'welding', qcAccepted: 580, pmAccepted: 580, unit: 'kg' },
          { hangMuc: 'MLI1652', stage: 'cutting', qcAccepted: 800, pmAccepted: 800, unit: 'kg' },
        ]),
        totalPmAccepted: 3200,
        pmResult: 'APPROVED',
        checklist: { qc_report_reviewed: true, volume_confirmed: true },
      },
      notes: 'Audit: P5.4 PM accepted W20/2026',
    }, 'R02');
    if (res.ok) console.log(`  ✅ P5.4 completed`);
    else console.log(`  Result:`, JSON.stringify(res).substring(0, 200));
  } else {
    console.log(`  ⚠️  P5.4 not IN_PROGRESS (status: ${p54Tasks[0]?.status || 'not found'})`);
  }

  // ═══════════════════════════════════════════════
  // FINAL: Print summary
  // ═══════════════════════════════════════════════
  console.log('\n══════════════════════════════════════');
  console.log('AUDIT TEST SUMMARY');
  console.log('══════════════════════════════════════');
  const { rows: finalTasks } = await client.query(
    `SELECT step_code, status, step_name FROM workflow_tasks WHERE project_id = $1 ORDER BY step_code, created_at DESC`,
    [projectId]
  );
  const seen = new Set();
  for (const t of finalTasks) {
    const key = t.step_code;
    if (seen.has(key)) continue;
    seen.add(key);
    const icon = t.status === 'DONE' ? '✅' : t.status === 'IN_PROGRESS' ? '🔄' : '⏳';
    console.log(`${icon} ${t.step_code.padEnd(8)} ${t.status.padEnd(14)} ${t.step_name}`);
  }

  client.release();
  await pool.end();
  console.log('\n🏁 Audit test complete. Run generate-audit.js to regenerate Excel.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
