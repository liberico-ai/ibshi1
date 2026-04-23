/**
 * Audit Script: Generate Excel mapping all data flow from P1.1 → P5.4
 * Uses real data from DA-26-Test project in PostgreSQL
 */
const pg = require('pg');
const XLSX = require('xlsx');
const path = require('path');

const DB_URL = 'postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi';

async function main() {
  const pool = new pg.Pool({
    connectionString: DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const client = await pool.connect();

  // ── Fetch project ──
  const { rows: [project] } = await client.query(
    "SELECT * FROM projects WHERE project_code = 'DA-26-Test'"
  );
  console.log('Project:', project.project_code, '-', project.project_name);

  // ── Fetch ALL tasks (including duplicates) ──
  const { rows: allTasks } = await client.query(
    `SELECT id, step_code, step_name, status, assigned_role, assigned_to,
            result_data, completed_at, completed_by, notes, created_at
     FROM workflow_tasks
     WHERE project_id = $1
     ORDER BY step_code, created_at DESC`,
    [project.id]
  );

  // Deduplicate: keep latest per step_code (but keep all P4.5 and P1.3)
  const taskMap = new Map();
  for (const t of allTasks) {
    if (!taskMap.has(t.step_code)) taskMap.set(t.step_code, []);
    taskMap.get(t.step_code).push(t);
  }

  // ── Fetch file attachments ──
  const taskIds = allTasks.map(t => t.id);
  const { rows: fileAttachments } = await client.query(
    `SELECT entity_id, file_name, file_url, file_size, mime_type, created_at
     FROM file_attachments
     WHERE entity_type = 'Project' AND entity_id LIKE $1
     UNION ALL
     SELECT entity_id, file_name, file_url, file_size, mime_type, created_at
     FROM file_attachments
     WHERE entity_type = 'Task'
     ORDER BY created_at`,
    [project.id + '%']
  );

  // ── Fetch users for role mapping ──
  const { rows: users } = await client.query('SELECT id, full_name, role_code FROM users');
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));

  // ── Fetch materials ──
  const { rows: materials } = await client.query(
    'SELECT material_code, name, specification, current_stock, unit, category FROM materials ORDER BY category'
  );

  client.release();
  await pool.end();

  // ════════════════════════════════════════════════
  // BUILD EXCEL WORKBOOK
  // ════════════════════════════════════════════════
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Workflow Overview ──
  const overviewData = [];
  const stepOrder = [
    'P1.1','P1.1B','P1.2A','P1.2','P1.3',
    'P2.1','P2.2','P2.3','P2.1A','P2.4','P2.5',
    'P3.1','P3.2','P3.3','P3.4','P3.5','P3.6','P3.7',
    'P4.1','P4.2','P4.3','P4.4','P4.5',
    'P5.1','P5.1A','P5.1.1','P5.2','P5.3','P5.3A','P5.4',
  ];

  const roleNames = {
    R01:'BGĐ', R02:'PM', R03:'KTKH', R04:'Design', R05:'Warehouse',
    R06:'Production', R06b:'Tổ SX', R07:'Commercial', R08:'Finance', R09:'QC', R10:'Admin'
  };

  for (const sc of stepOrder) {
    const tasks = taskMap.get(sc) || [];
    const t = tasks[0]; // latest
    overviewData.push({
      'Step Code': sc,
      'Step Name': t?.step_name || '(not created)',
      'Phase': sc.startsWith('P1') ? 1 : sc.startsWith('P2') ? 2 : sc.startsWith('P3') ? 3 : sc.startsWith('P4') ? 4 : 5,
      'Assigned Role': t?.assigned_role || '',
      'Role Name': roleNames[t?.assigned_role] || '',
      'Status': t?.status || 'NOT_CREATED',
      'Completed At': t?.completed_at ? new Date(t.completed_at).toLocaleString('vi-VN') : '',
      'Task Count': tasks.length,
      'ResultData Keys': t?.result_data ? Object.keys(t.result_data).join(', ') : '',
      'Notes': t?.notes || '',
    });
  }
  const ws1 = XLSX.utils.json_to_sheet(overviewData);
  ws1['!cols'] = [
    {wch:10},{wch:50},{wch:6},{wch:12},{wch:14},{wch:14},{wch:20},{wch:10},{wch:60},{wch:40}
  ];
  XLSX.utils.book_append_sheet(wb, ws1, '1. Workflow Overview');

  // ── Sheet 2: Data Mapping — Grouped by flow chain, Vietnamese ──
  const F = (luong, stt, nguon, nguonTen, fieldGoc, nhan, nhanTen, fieldNhan, chuoiDay, moTa) =>
    ({ 'Luồng dữ liệu': luong, STT: stt, 'Bước nguồn': nguon, 'Tên bước nguồn': nguonTen, 'Field xuất': fieldGoc,
       'Bước nhận': nhan, 'Tên bước nhận': nhanTen, 'Field nhận (key)': fieldNhan,
       'Chuỗi truyền đầy đủ': chuoiDay, 'Mô tả mục đích': moTa });

  const mappingData = [
    // ════════════ LUỒNG 1: DỰ TOÁN (Estimate) ════════════
    F('1. DỰ TOÁN', 1, 'P1.2', 'KTKH lập dự toán thi công', 'totalMaterial, totalLabor, totalService, totalOverhead, totalEstimate, dt02Detail (25 hạng mục CP)', 'P1.3', 'BGĐ phê duyệt KH & DT', 'estimate', 'P1.2 → P1.3 → P2.4 → P2.5 → P3.6 → P6.2', 'KTKH lập dự toán thi công (3,99 tỷ). BGĐ xem để phê duyệt tổng chi phí 4 nhóm: VT, nhân công, dịch vụ, chi phí chung.'),
    F('1. DỰ TOÁN', 2, 'P1.2', 'KTKH lập dự toán thi công', 'totalMaterial, totalEstimate', 'P2.3', 'Kho đề xuất VT tiêu hao', 'estimate', 'P1.2 → P2.3', 'Kho xem tổng ngân sách VT để cân đối đề xuất vật tư tiêu hao.'),
    F('1. DỰ TOÁN', 3, 'P1.2 + P2.1A', 'DT thi công + Dòng tiền', 'P1.2(DT02-06) gộp P2.1A(DT07)', 'P2.4', 'KTKH điều chỉnh dự toán', 'estimate', 'P1.2 + P2.1A → P2.4', 'KTKH gộp dự toán gốc với kế hoạch dòng tiền từ Tài chính để điều chỉnh ngân sách chính thức.'),
    F('1. DỰ TOÁN', 4, 'P1.2 + P2.1A', 'DT thi công + Dòng tiền', 'Dữ liệu DT gộp', 'P2.5', 'BGĐ duyệt DT chính thức', 'estimate', 'P1.2 + P2.1A → P2.5', 'BGĐ xem dự toán gốc và dòng tiền để phê duyệt ngân sách chính thức trước khi mua hàng.'),
    F('1. DỰ TOÁN', 5, 'P1.2', 'KTKH lập dự toán thi công', 'totalEstimate', 'P3.6', 'BGĐ duyệt báo giá NCC', 'estimate', 'P1.2 → P3.6', 'BGĐ so sánh báo giá NCC với tổng dự toán để kiểm tra ngân sách trước khi duyệt mua.'),
    F('1. DỰ TOÁN', 6, 'P1.2', 'KTKH lập dự toán thi công', 'totalEstimate', 'P6.2', 'Quyết toán chi phí', 'budgetTotal', 'P1.2 → P6.2', 'Kế toán lấy tổng dự toán làm baseline để so sánh chi phí thực tế khi quyết toán.'),

    // ════════════ LUỒNG 2: KẾ HOẠCH & WBS ════════════
    F('2. KẾ HOẠCH & WBS', 7, 'P1.2A', 'PM lập KH kickoff, WBS', 'wbsItems (4 hạng mục), momSections (4 phần), momAttendants (10 người)', 'P1.3', 'BGĐ phê duyệt KH & DT', 'plan', 'P1.2A → P1.3 → P3.1 → P3.3/P3.4 → P5.1/P5.1A', 'PM lập WBS với 4 hạng mục (MLI1645, MLI1652, MLI1634, MLI1617) và biên bản họp kickoff. BGĐ review để phê duyệt.'),
    F('2. KẾ HOẠCH & WBS', 8, 'P1.2A', 'PM lập KH kickoff, WBS', 'wbsItems', 'P3.1', 'PM đẩy tiến độ cấp hàng', 'plan', 'P1.2A → P3.1', 'PM xem WBS để xác định hạng mục cần VT sớm (long-lead items) và điều chỉnh tiến độ cấp hàng.'),
    F('2. KẾ HOẠCH & WBS', 9, 'P1.2A', 'PM lập KH kickoff, WBS', 'wbsItems (có stage: cutting, fitup, welding...)', 'P3.3', 'PM lập LSX thầu phụ', 'plan', 'P1.2A → P3.3', 'PM dùng bảng WBS (hạng mục + stage assignments) để phân giao công việc cho thầu phụ, tạo Lệnh SX (LSX).'),
    F('2. KẾ HOẠCH & WBS', 10, 'P1.2A', 'PM lập KH kickoff, WBS', 'wbsItems', 'P3.4', 'QLSX lập LSX nội bộ', 'plan', 'P1.2A → P3.4', 'QLSX dùng WBS để tạo LSX cho tổ sản xuất nội bộ (cutting, machining, blasting...).'),
    F('2. KẾ HOẠCH & WBS', 11, 'P1.2A', 'PM lập KH kickoff, WBS', 'wbsItems[row].hangMuc', 'P5.1/P5.1A', 'Báo cáo KL hàng ngày', 'lsxTeamData.hangMuc', 'P1.2A → P5.1/P5.1A', 'Tổ SX báo cáo khối lượng theo từng hạng mục WBS. Tên hạng mục lấy từ WBS gốc.'),

    // ════════════ LUỒNG 3: VẬT TƯ (BOM) ════════════
    F('3. VẬT TƯ (BOM)', 12, 'P2.1', 'Thiết kế - BOM VT chính', 'bomPrItems (160 mục VT chính)', 'P2.4', 'KTKH điều chỉnh DT', 'bomMain', 'P2.1 → P2.4 → P2.5', 'Thiết kế xuất danh sách 160 mục VT chính (thép hình, tấm, ống...). KTKH xem để điều chỉnh dự toán VT.'),
    F('3. VẬT TƯ (BOM)', 13, 'P2.2', 'PM - BOM VT hàn & sơn', 'weldPrItems (2 mục), paintPrItems (4 mục)', 'P2.4', 'KTKH điều chỉnh DT', 'bomWeldPaint', 'P2.2 → P2.3 → P2.4 → P2.5', 'PM đề xuất dây hàn và sơn. KTKH xem để tính vào dự toán điều chỉnh.'),
    F('3. VẬT TƯ (BOM)', 14, 'P2.2', 'PM - BOM VT hàn & sơn', 'weldPrItems, paintPrItems', 'P2.3', 'Kho đề xuất VT tiêu hao', 'bom', 'P2.2 → P2.3', 'Kho xem VT hàn/sơn từ PM để tránh đề xuất trùng và cân đối VT tiêu hao.'),
    F('3. VẬT TƯ (BOM)', 15, 'P2.3', 'Kho - BOM VT tiêu hao', 'bomItems (găng tay, đá cắt...)', 'P2.4', 'KTKH điều chỉnh DT', 'bomSupply', 'P2.3 → P2.4 → P2.5', 'Kho đề xuất VT tiêu hao. KTKH tổng hợp vào dự toán.'),
    F('3. VẬT TƯ (BOM)', 16, 'P2.1+P2.2+P2.3', 'Tổng hợp 3 nguồn BOM', 'aggregateBomItems() → 167 mục gộp', 'P3.2', 'Kho kiểm tra tồn kho', 'prItems', 'P2.1+P2.2+P2.3 → P3.2', 'Hệ thống tự động gộp BOM từ 3 nguồn. Kho so khớp với tồn kho để tách: "có sẵn" vs "cần mua".'),
    F('3. VẬT TƯ (BOM)', 17, 'Bảng Materials', 'Tồn kho hiện tại (15 mục)', 'materialCode, currentStock', 'P3.2', 'Kho kiểm tra tồn kho', 'fromStock / toPurchase', 'Materials DB → P3.2', 'So khớp từng BOM item với kho: đủ tồn → fromStock, thiếu → toPurchase (tính shortfall).'),
    F('3. VẬT TƯ (BOM)', 18, 'P2.1+P2.2+P2.3', 'Tổng hợp 3 nguồn BOM', 'aggregateBomItems()', 'P3.3', 'PM lập LSX thầu phụ', 'bomItems', 'P2.1+P2.2+P2.3 → P3.3', 'PM xem danh sách VT để biết VT nào cần cấp cho thầu phụ khi lập LSX.'),
    F('3. VẬT TƯ (BOM)', 19, 'P2.1+P2.2+P2.3', 'Tổng hợp 3 nguồn BOM', 'aggregateBomItems()', 'P3.4', 'QLSX lập LSX nội bộ', 'bomItems', 'P2.1+P2.2+P2.3 → P3.4', 'QLSX xem danh sách VT để biết VT nào cần cho tổ SX nội bộ.'),
    F('3. VẬT TƯ (BOM)', 20, 'P2.1+P2.2+P2.3', 'Tổng hợp 3 nguồn BOM', 'aggregateBomItems()', 'P3.5', 'Thương mại tìm NCC', 'prItems', 'P2.1+P2.2+P2.3 → P3.5', 'Thương mại nhận danh sách VT cần mua để tìm nhà cung cấp và lấy báo giá.'),
    F('3. VẬT TƯ (BOM)', 21, 'P2.1+P2.2+P2.3', 'Tổng hợp 3 nguồn BOM', 'aggregateBomItems()', 'P4.4', 'Kho nhập kho', 'prItems', 'P2.1+P2.2+P2.3 → P4.4', 'Kho đối chiếu số lượng nhập kho với số lượng yêu cầu gốc từ BOM.'),

    // ════════════ LUỒNG 4: NHÀ CUNG CẤP & MUA HÀNG ════════════
    F('4. NCC & MUA HÀNG', 22, 'P3.5', 'Thương mại tìm NCC', 'suppliers[] (3 NCC, mỗi NCC có quotes[])', 'P3.6', 'BGĐ duyệt báo giá', 'supplierData', 'P3.5 → P3.6 → P3.7', 'Thương mại gửi bảng báo giá 3 NCC. BGĐ xem so sánh giá để duyệt.'),
    F('4. NCC & MUA HÀNG', 23, 'P3.5', 'Thương mại tìm NCC', 'suppliers[]', 'P3.7', 'Thương mại chốt hàng', 'supplierData', 'P3.5 → P3.7', 'Thương mại xem lại báo giá đã duyệt để chốt PO với NCC tốt nhất.'),
    F('4. NCC & MUA HÀNG', 24, 'P3.7', 'Thương mại chốt PO', 'poNumber, totalAmount, paymentMilestones[], deliveryDate', 'P4.1', 'Kế toán thanh toán', 'poData', 'P3.7 → P4.1', 'Kế toán nhận PO (890 triệu) với 3 đợt thanh toán (30%/40%/30%) để thực hiện chi trả.'),
    F('4. NCC & MUA HÀNG', 25, 'P3.7', 'Thương mại chốt PO', 'PO + kế hoạch giao hàng', 'P4.2', 'Thương mại theo dõi hàng về', 'poData', 'P3.7 → P4.2', 'Thương mại theo dõi tiến độ giao hàng theo PO, đối chiếu packing list.'),
    F('4. NCC & MUA HÀNG', 26, 'P3.5', 'Thương mại tìm NCC', 'Thông tin NCC & VT', 'P4.2', 'Thương mại theo dõi hàng về', 'supplierData', 'P3.5 → P4.2', 'Thương mại liên hệ NCC để track delivery.'),
    F('4. NCC & MUA HÀNG', 27, 'P3.7', 'Thương mại chốt PO', 'Spec VT theo PO', 'P4.3', 'QC nghiệm thu CL nhập kho', 'poData', 'P3.7 → P4.3', 'QC kiểm tra VT nhập kho theo spec trong PO (kích thước, Mill Cert, bề mặt).'),
    F('4. NCC & MUA HÀNG', 28, 'P3.5', 'Thương mại tìm NCC', 'Thông tin NCC', 'P4.3', 'QC nghiệm thu CL nhập kho', 'supplierData', 'P3.5 → P4.3', 'QC tham chiếu thông tin NCC khi kiểm tra chất lượng VT.'),

    // ════════════ LUỒNG 5: QC & NHẬP KHO ════════════
    F('5. QC & NHẬP KHO', 29, 'P4.3', 'QC nghiệm thu CL nhập kho', 'inspectionResult (PASS), qcItems[] (4 hạng mục kiểm tra)', 'P4.4', 'Kho nhập kho', 'qcData', 'P4.3 → P4.4', 'Kho chỉ nhập kho khi QC đã PASS. Xem chi tiết kết quả kiểm tra từng hạng mục.'),
    F('5. QC & NHẬP KHO', 30, 'P3.5', 'Thương mại tìm NCC', 'Thông tin NCC', 'P4.4', 'Kho nhập kho', 'supplierData', 'P3.5 → P4.4', 'Kho tham chiếu NCC khi lập phiếu nhập kho (GRN).'),

    // ════════════ LUỒNG 6: LSX & CẤP VẬT TƯ ════════════
    F('6. LSX & CẤP VT', 31, 'P3.3', 'PM lập LSX thầu phụ', 'cellAssignments (3 phân giao), materialRequests, lsxIssuedDetails', 'P4.5', 'Kho cấp VT', 'lsxData', 'P3.3 → P4.5 → P5.1A', 'Kho nhận yêu cầu cấp VT theo từng LSX thầu phụ. Mỗi LSX chỉ rõ: hạng mục nào, công đoạn nào, tổ nào, VT cần gì.'),
    F('6. LSX & CẤP VT', 32, 'P3.4', 'QLSX lập LSX nội bộ', 'cellAssignments (1 phân giao), woNumber, materialRequests', 'P4.5', 'Kho cấp VT', 'woData', 'P3.4 → P4.5 → P5.1', 'Kho nhận yêu cầu cấp VT theo LSX nội bộ. Gắn với WO number.'),
    F('6. LSX & CẤP VT', 33, 'Bảng Materials', 'Tồn kho khả dụng (stock>0)', 'code, name, spec, stock, unit, category', 'P4.5', 'Kho cấp VT', 'inventory', 'Materials DB → P4.5', 'Kho chọn VT từ tồn kho khả dụng để xuất cho từng LSX.'),

    // ════════════ LUỒNG 7: SẢN XUẤT & NGHIỆM THU ════════════
    F('7. SẢN XUẤT & NT', 34, 'P3.4 → P4.5', 'LSX nội bộ → Cấp VT', 'cellAssignments[hạng_mục][công_đoạn][tổ] → teamName, volume, dates', 'P5.1', 'Báo cáo KL nội bộ/ngày', 'lsxTeamData', 'P3.4 → P4.5 → P5.1', 'Tổ SX nội bộ nhận thông tin phân giao (tổ nào, KL bao nhiêu, công đoạn gì) để báo cáo hàng ngày.'),
    F('7. SẢN XUẤT & NT', 35, 'P3.3 → P4.5', 'LSX thầu phụ → Cấp VT', 'cellAssignments[hạng_mục][công_đoạn][tổ] → teamName, volume, dates', 'P5.1A', 'Báo cáo KL thầu phụ/ngày', 'lsxTeamData', 'P3.3 → P4.5 → P5.1A', 'Thầu phụ nhận thông tin phân giao (tổ, KL, công đoạn) để báo cáo hàng ngày.'),
    F('7. SẢN XUẤT & NT', 36, 'P5.1', 'Báo cáo KL nội bộ/ngày', 'dailyReport[] (4 entries), totalVolume (1700 kg)', 'P5.2', 'Báo cáo KL tuần', 'jobCardData', 'P5.1 → P5.2', 'Tổng hợp báo cáo ngày thành báo cáo tuần.'),
    F('7. SẢN XUẤT & NT', 37, 'P5.1', 'Báo cáo KL nội bộ/ngày', 'dailyReport[], totalVolume', 'P5.3', 'QC nghiệm thu KL tuần', 'jobCardData', 'P5.1 → P5.3', 'QC xem báo cáo KL để nghiệm thu: so sánh reported vs accepted, ghi chú sai lệch.'),
    F('7. SẢN XUẤT & NT', 38, 'P3.4 → P4.5', 'LSX → Cấp VT', 'Thông tin tổ/công đoạn', 'P5.3', 'QC nghiệm thu KL tuần', 'lsxTeamData', 'P3.4 → P4.5 → P5.3', 'QC biết đang nghiệm thu tổ nào, công đoạn gì để kiểm tra đúng.'),
    F('7. SẢN XUẤT & NT', 39, 'P5.1 (cụ thể)', 'Báo cáo KL nội bộ/ngày', 'sourceP51TaskId → resultData', 'P5.4', 'PM nghiệm thu KL tuần', 'jobCardData', 'P5.1 → P5.4', 'PM xem KL đã báo cáo từ task P5.1 cụ thể để nghiệm thu.'),
    F('7. SẢN XUẤT & NT', 40, 'P5.2', 'Báo cáo KL tuần', 'weeklyVolume[] (tổng 3250 kg)', 'P5.4', 'PM nghiệm thu KL tuần', 'volumeData', 'P5.2 → P5.4', 'PM xem báo cáo KL tuần tổng hợp để đối chiếu và duyệt.'),
    F('7. SẢN XUẤT & NT', 41, 'P3.x → P4.5', 'LSX → Cấp VT', 'Thông tin tổ/công đoạn', 'P5.4', 'PM nghiệm thu KL tuần', 'lsxTeamData', 'P3.x → P4.5 → P5.4', 'PM biết đang nghiệm thu tổ nào, hạng mục gì để xác nhận đúng.'),

    // ════════════ LUỒNG 8: DỮ LIỆU PHÊ DUYỆT (P2.4 → P2.5) ════════════
    F('8. PHÊ DUYỆT P2', 42, 'P2.4', 'KTKH điều chỉnh DT', 'dt02-dt07Items, bomSummary, budgetComparison', 'P2.5', 'BGĐ duyệt DT chính thức', 'plan', 'P2.4 → P2.5', 'BGĐ xem toàn bộ dự toán điều chỉnh (DT02-DT07), so sánh ngân sách, tổng hợp BOM để phê duyệt.'),
    F('8. PHÊ DUYỆT P2', 43, 'P2.1', 'Thiết kế - BOM VT chính', 'bomPrItems', 'P2.5', 'BGĐ duyệt DT chính thức', 'bomMain', 'P2.1 → P2.5', 'BGĐ review BOM VT chính từ Thiết kế.'),
    F('8. PHÊ DUYỆT P2', 44, 'P2.2', 'PM - BOM hàn & sơn', 'weldPrItems, paintPrItems', 'P2.5', 'BGĐ duyệt DT chính thức', 'bomWeldPaint', 'P2.2 → P2.5', 'BGĐ review BOM VT hàn/sơn từ PM.'),
    F('8. PHÊ DUYỆT P2', 45, 'P2.3', 'Kho - BOM VT tiêu hao', 'bomItems', 'P2.5', 'BGĐ duyệt DT chính thức', 'bomSupply', 'P2.3 → P2.5', 'BGĐ review BOM VT tiêu hao từ Kho.'),
  ];

  const ws2 = XLSX.utils.json_to_sheet(mappingData);
  ws2['!cols'] = [{wch:20},{wch:4},{wch:14},{wch:30},{wch:50},{wch:10},{wch:28},{wch:22},{wch:35},{wch:80}];
  XLSX.utils.book_append_sheet(wb, ws2, '2. Data Mapping');

  // ── Sheet 3: ResultData Detail (per step, actual data) ──
  const resultDataRows = [];
  for (const sc of stepOrder) {
    const tasks = taskMap.get(sc) || [];
    const t = tasks[0];
    if (!t || !t.result_data) continue;

    const rd = t.result_data;
    for (const [key, val] of Object.entries(rd)) {
      let type = typeof val;
      let sampleValue = '';
      let itemCount = '';

      if (val === null || val === undefined) {
        type = 'null';
        sampleValue = 'null';
      } else if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            type = 'JSON Array';
            itemCount = String(parsed.length);
            sampleValue = parsed.length > 0 ? JSON.stringify(parsed[0]).substring(0, 200) : '[]';
          } else if (typeof parsed === 'object') {
            type = 'JSON Object';
            const keys = Object.keys(parsed);
            itemCount = keys.length + ' keys';
            sampleValue = JSON.stringify(parsed).substring(0, 200);
          }
        } catch {
          type = 'string';
          sampleValue = val.substring(0, 200);
        }
      } else if (typeof val === 'object') {
        if (Array.isArray(val)) {
          type = 'Array';
          itemCount = String(val.length);
          sampleValue = val.length > 0 ? JSON.stringify(val[0]).substring(0, 200) : '[]';
        } else {
          type = 'Object';
          const keys = Object.keys(val);
          itemCount = keys.length + ' keys';
          sampleValue = JSON.stringify(val).substring(0, 200);
        }
      } else if (typeof val === 'boolean') {
        type = 'boolean';
        sampleValue = String(val);
      } else if (typeof val === 'number') {
        type = 'number';
        sampleValue = String(val);
      }

      resultDataRows.push({
        'Step Code': sc,
        'Step Name': t.step_name,
        'Status': t.status,
        'Field Key': key,
        'Data Type': type,
        'Item Count': itemCount,
        'Sample Value': sampleValue,
      });
    }
  }
  const ws3 = XLSX.utils.json_to_sheet(resultDataRows);
  ws3['!cols'] = [{wch:10},{wch:45},{wch:14},{wch:22},{wch:12},{wch:12},{wch:100}];
  XLSX.utils.book_append_sheet(wb, ws3, '3. ResultData Detail');

  // ── Sheet 4: BOM Flow (P2.1 → P2.2 → P2.3 → P3.2 → P3.5 → P4.4) ──
  const bomFlowRows = [];
  // Extract BOM from each source
  const p21 = (taskMap.get('P2.1') || [])[0];
  const p22 = (taskMap.get('P2.2') || [])[0];
  const p23 = (taskMap.get('P2.3') || [])[0];

  function parseBomArray(raw) {
    if (!raw) return [];
    if (typeof raw === 'string') try { return JSON.parse(raw); } catch { return []; }
    return Array.isArray(raw) ? raw : [];
  }

  if (p21?.result_data) {
    const items = parseBomArray(p21.result_data.bomPrItems);
    items.forEach((item, i) => {
      bomFlowRows.push({
        'Source Step': 'P2.1 (VT chính)',
        'Idx': i + 1,
        'Name': item.name || item.description || '',
        'Code': item.code || item.materialCode || '',
        'Spec': item.spec || item.specification || '',
        'Quantity': item.quantity || item.qty || '',
        'Unit': item.unit || '',
        'Consumed By': 'P2.4, P2.5, P3.2, P3.3, P3.4, P3.5, P4.4',
      });
    });
  }

  if (p22?.result_data) {
    for (const [arrKey, label] of [['weldPrItems', 'Hàn'], ['paintPrItems', 'Sơn']]) {
      const items = parseBomArray(p22.result_data[arrKey]);
      items.forEach((item, i) => {
        bomFlowRows.push({
          'Source Step': `P2.2 (${label})`,
          'Idx': i + 1,
          'Name': item.name || item.description || '',
          'Code': item.code || item.materialCode || '',
          'Spec': item.spec || item.specification || '',
          'Quantity': item.quantity || item.qty || '',
          'Unit': item.unit || '',
          'Consumed By': 'P2.3, P2.4, P2.5, P3.2, P3.3, P3.4, P3.5, P4.4',
        });
      });
    }
  }

  if (p23?.result_data) {
    const items = parseBomArray(p23.result_data.bomItems);
    items.forEach((item, i) => {
      bomFlowRows.push({
        'Source Step': 'P2.3 (VT tiêu hao)',
        'Idx': i + 1,
        'Name': item.name || '',
        'Code': item.code || '',
        'Spec': item.spec || '',
        'Quantity': item.quantity || '',
        'Unit': item.unit || '',
        'Consumed By': 'P2.4, P2.5, P3.2, P3.3, P3.4, P3.5, P4.4',
      });
    });
  }

  const ws4 = XLSX.utils.json_to_sheet(bomFlowRows);
  ws4['!cols'] = [{wch:20},{wch:5},{wch:40},{wch:20},{wch:30},{wch:12},{wch:8},{wch:45}];
  XLSX.utils.book_append_sheet(wb, ws4, '4. BOM Flow');

  // ── Sheet 5: WBS Flow (P1.2A → P3.1 → P3.3/P3.4 → P5.1) ──
  const wbsFlowRows = [];
  const p12a = (taskMap.get('P1.2A') || [])[0];
  if (p12a?.result_data?.wbsItems) {
    const wbs = parseBomArray(p12a.result_data.wbsItems);
    wbs.forEach((item, i) => {
      wbsFlowRows.push({
        'WBS Idx': i,
        'Hạng mục': item.hangMuc || '',
        'ĐVT': item.dvt || '',
        'Khối lượng': item.khoiLuong || '',
        'Phạm vi': item.phamVi || '',
        'Thầu phụ': item.thauPhu || '',
        'Bắt đầu': item.batDau || '',
        'Kết thúc': item.ketThuc || '',
        'Cutting': item.cutting || '',
        'Machining': item.machining || '',
        'Fitup': item.fitup || '',
        'Welding': item.welding || '',
        'TryAssembly': item.tryAssembly || '',
        'Blasting': item.blasting || '',
        'Painting': item.painting || '',
        'Galvanize': item.galvanize || '',
        'Insulation': item.insulation || '',
        'KhungKien': item.khungKien || '',
        'Packing': item.packing || '',
        'Delivery': item.delivery || '',
        'Consumed By': 'P1.3(review), P3.1(adjust), P3.3(sub LSX), P3.4(internal LSX), P5.1/P5.1A(daily report)',
      });
    });
  }
  const ws5 = XLSX.utils.json_to_sheet(wbsFlowRows);
  ws5['!cols'] = [{wch:8},{wch:12},{wch:5},{wch:10},{wch:8},{wch:16},{wch:12},{wch:12},
    {wch:8},{wch:10},{wch:16},{wch:16},{wch:16},{wch:8},{wch:8},{wch:12},{wch:12},{wch:8},{wch:8},{wch:8},{wch:60}];
  XLSX.utils.book_append_sheet(wb, ws5, '5. WBS Flow');

  // ── Sheet 6: Estimate Flow (P1.2 → P2.1A → P2.4 → P2.5 → P3.6 → P6.2) ──
  const estFlowRows = [];
  const p12 = (taskMap.get('P1.2') || [])[0];
  if (p12?.result_data) {
    const rd = p12.result_data;
    estFlowRows.push({
      'Source': 'P1.2 (Dự toán thi công)',
      'Field': 'totalMaterial',
      'Value': rd.totalMaterial,
      'Consumed By': 'P1.3, P2.3, P2.4, P2.5, P3.6, P6.2',
    });
    estFlowRows.push({ Source: '', Field: 'totalLabor', Value: rd.totalLabor, 'Consumed By': '' });
    estFlowRows.push({ Source: '', Field: 'totalService', Value: rd.totalService, 'Consumed By': '' });
    estFlowRows.push({ Source: '', Field: 'totalOverhead', Value: rd.totalOverhead, 'Consumed By': '' });
    estFlowRows.push({ Source: '', Field: 'totalEstimate', Value: rd.totalEstimate, 'Consumed By': '' });
    estFlowRows.push({ Source: '', Field: 'estimateFileName', Value: rd.estimateFileName, 'Consumed By': '' });
    estFlowRows.push({ Source: '', Field: 'dt02Detail', Value: '25 cost items (JSON)', 'Consumed By': '' });
  }
  const p21a = (taskMap.get('P2.1A') || [])[0];
  if (p21a?.result_data) {
    const rd = p21a.result_data;
    estFlowRows.push({
      Source: 'P2.1A (Dòng tiền)',
      Field: 'dt02Items',
      Value: JSON.stringify(parseBomArray(rd.dt02Items)).substring(0, 200),
      'Consumed By': 'P2.4, P2.5 (merged with P1.2)',
    });
    estFlowRows.push({
      Source: '', Field: 'dt07Items',
      Value: JSON.stringify(parseBomArray(rd.dt07Items)).substring(0, 200),
      'Consumed By': '',
    });
  }
  const p24 = (taskMap.get('P2.4') || [])[0];
  if (p24?.result_data) {
    const rd = p24.result_data;
    estFlowRows.push({
      Source: 'P2.4 (Điều chỉnh DT)',
      Field: 'budgetComparison',
      Value: rd.budgetComparison || '',
      'Consumed By': 'P2.5 (BGĐ review)',
    });
    for (const key of ['dt02Items','dt03Items','dt04Items','dt05Items','dt06Items','dt07Items']) {
      const items = parseBomArray(rd[key]);
      estFlowRows.push({ Source: '', Field: key, Value: items.length + ' items', 'Consumed By': '' });
    }
  }
  const ws6 = XLSX.utils.json_to_sheet(estFlowRows);
  ws6['!cols'] = [{wch:25},{wch:20},{wch:80},{wch:40}];
  XLSX.utils.book_append_sheet(wb, ws6, '6. Estimate Flow');

  // ── Sheet 7: LSX & Material Issue Flow (P3.3/P3.4 → P4.5 → P5.1/P5.1A) ──
  const lsxRows = [];
  const p33 = (taskMap.get('P3.3') || [])[0];
  const p34 = (taskMap.get('P3.4') || [])[0];

  function parseCellAssignments(rd) {
    if (!rd?.cellAssignments) return {};
    try {
      return typeof rd.cellAssignments === 'string' ? JSON.parse(rd.cellAssignments) : rd.cellAssignments;
    } catch { return {}; }
  }

  function parseLsxIssued(rd) {
    if (!rd?.lsxIssuedDetails) return {};
    try {
      return typeof rd.lsxIssuedDetails === 'string' ? JSON.parse(rd.lsxIssuedDetails) : rd.lsxIssuedDetails;
    } catch { return {}; }
  }

  function parseMaterialRequests(rd) {
    if (!rd?.materialRequests) return {};
    try {
      return typeof rd.materialRequests === 'string' ? JSON.parse(rd.materialRequests) : rd.materialRequests;
    } catch { return {}; }
  }

  // P3.3 cellAssignments
  if (p33?.result_data) {
    const cells = parseCellAssignments(p33.result_data);
    const issued = parseLsxIssued(p33.result_data);
    const matReqs = parseMaterialRequests(p33.result_data);
    for (const [rowIdx, stages] of Object.entries(cells)) {
      for (const [stage, teams] of Object.entries(stages)) {
        if (!Array.isArray(teams)) continue;
        teams.forEach((team, tIdx) => {
          const isIssued = issued[rowIdx]?.[stage]?.[tIdx] || false;
          const mats = matReqs[rowIdx]?.[stage]?.[tIdx] || [];
          lsxRows.push({
            'Source Step': 'P3.3 (Thầu phụ)',
            'WBS Row': rowIdx,
            'Stage': stage,
            'Team Idx': tIdx,
            'Team Name': team.teamName || '',
            'Volume': team.volume || '',
            'Start Date': team.startDate || '',
            'End Date': team.endDate || '',
            'LSX Issued': isIssued ? 'YES' : 'NO',
            'Material Count': Array.isArray(mats) ? mats.length : 0,
            'Material Items': Array.isArray(mats) ? mats.map(m => m.name).join(', ') : '',
            'Flows To': 'P4.5(material issue) → P5.1A(daily report) → P5.3(QC) → P5.4(PM)',
          });
        });
      }
    }
  }

  // P3.4 cellAssignments
  if (p34?.result_data) {
    const cells = parseCellAssignments(p34.result_data);
    const issued = parseLsxIssued(p34.result_data);
    const matReqs = parseMaterialRequests(p34.result_data);
    for (const [rowIdx, stages] of Object.entries(cells)) {
      for (const [stage, teams] of Object.entries(stages)) {
        if (!Array.isArray(teams)) continue;
        teams.forEach((team, tIdx) => {
          const isIssued = issued[rowIdx]?.[stage]?.[tIdx] || false;
          const mats = matReqs[rowIdx]?.[stage]?.[tIdx] || [];
          lsxRows.push({
            'Source Step': 'P3.4 (Nội bộ)',
            'WBS Row': rowIdx,
            'Stage': stage,
            'Team Idx': tIdx,
            'Team Name': team.teamName || '',
            'Volume': team.volume || '',
            'Start Date': team.startDate || '',
            'End Date': team.endDate || '',
            'LSX Issued': isIssued ? 'YES' : 'NO',
            'Material Count': Array.isArray(mats) ? mats.length : 0,
            'Material Items': Array.isArray(mats) ? mats.map(m => m.name).join(', ') : '',
            'Flows To': 'P4.5(material issue) → P5.1(daily report) → P5.3(QC) → P5.4(PM)',
          });
        });
      }
    }
  }

  // P4.5 tasks
  const p45Tasks = taskMap.get('P4.5') || [];
  for (const t of p45Tasks) {
    if (!t.result_data) continue;
    const rd = t.result_data;
    const matIssues = Array.isArray(rd.materialIssueRequests) ? rd.materialIssueRequests : [];
    lsxRows.push({
      'Source Step': `P4.5 [${t.status}] (${t.step_name})`,
      'WBS Row': '',
      'Stage': '',
      'Team Idx': '',
      'Team Name': rd.sourceStep || '',
      'Volume': '',
      'Start Date': '',
      'End Date': '',
      'LSX Issued': '',
      'Material Count': matIssues.length,
      'Material Items': matIssues.map(m => `${m.name}(${m.quantity}${m.unit})`).join(', '),
      'Flows To': 'P5.1/P5.1A (creates production task)',
    });
  }

  const ws7 = XLSX.utils.json_to_sheet(lsxRows);
  ws7['!cols'] = [{wch:25},{wch:8},{wch:12},{wch:8},{wch:20},{wch:10},{wch:12},{wch:12},{wch:10},{wch:12},{wch:40},{wch:50}];
  XLSX.utils.book_append_sheet(wb, ws7, '7. LSX & Material Flow');

  // ── Sheet 8: File Attachments ──
  const fileRows = fileAttachments.map(f => ({
    'Entity ID': f.entity_id,
    'Step/Key': f.entity_id.includes('_') ? f.entity_id.split('_').slice(1).join('_') : '',
    'File Name': f.file_name,
    'File URL': f.file_url,
    'File Size': f.file_size,
    'MIME Type': f.mime_type,
    'Created At': f.created_at ? new Date(f.created_at).toLocaleString('vi-VN') : '',
  }));
  const ws8 = XLSX.utils.json_to_sheet(fileRows);
  ws8['!cols'] = [{wch:35},{wch:12},{wch:50},{wch:60},{wch:10},{wch:20},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws8, '8. File Attachments');

  // ── Sheet 9: Material Inventory ──
  const matRows = materials.map(m => ({
    'Code': m.material_code,
    'Name': m.name,
    'Spec': m.specification || '',
    'Current Stock': Number(m.current_stock),
    'Unit': m.unit,
    'Category': m.category,
  }));
  const ws9 = XLSX.utils.json_to_sheet(matRows);
  ws9['!cols'] = [{wch:15},{wch:40},{wch:30},{wch:14},{wch:8},{wch:15}];
  XLSX.utils.book_append_sheet(wb, ws9, '9. Material Inventory');

  // ── Sheet 10: Duplicate Tasks Audit ──
  const dupeRows = [];
  for (const [sc, tasks] of taskMap.entries()) {
    if (tasks.length > 1) {
      for (const t of tasks) {
        dupeRows.push({
          'Step Code': sc,
          'Task ID': t.id,
          'Status': t.status,
          'Step Name': t.step_name,
          'Created At': t.created_at ? new Date(t.created_at).toLocaleString('vi-VN') : '',
          'Completed At': t.completed_at ? new Date(t.completed_at).toLocaleString('vi-VN') : '',
          'Has Data': t.result_data ? 'YES' : 'NO',
          'Notes': t.notes || '',
        });
      }
    }
  }
  if (dupeRows.length > 0) {
    const ws10 = XLSX.utils.json_to_sheet(dupeRows);
    ws10['!cols'] = [{wch:10},{wch:30},{wch:14},{wch:50},{wch:20},{wch:20},{wch:8},{wch:40}];
    XLSX.utils.book_append_sheet(wb, ws10, '10. Duplicate Tasks');
  }

  // ── Write file ──
  const outPath = path.join(__dirname, 'DA-26-Test_Data-Mapping-Audit-v2.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log('\n✅ Excel generated:', outPath);
  console.log('Sheets: 10');
  console.log('Total tasks:', allTasks.length);
  console.log('BOM items:', bomFlowRows.length);
  console.log('WBS items:', wbsFlowRows.length);
  console.log('LSX assignments:', lsxRows.length);
  console.log('File attachments:', fileAttachments.length);
  console.log('Materials:', materials.length);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
