/**
 * Audit v3: Sheet 2 redesigned — Mỗi step = 1 block: ĐẦU VÀO → ĐẦU RA
 * Re-uses all other sheets from generate-audit.js
 */
const pg = require('pg');
const XLSX = require('xlsx');
const path = require('path');

const DB_URL = 'postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi';

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  const client = await pool.connect();

  const { rows: [project] } = await client.query("SELECT * FROM projects WHERE project_code = 'DA-26-Test'");
  const { rows: allTasks } = await client.query(
    `SELECT id, step_code, step_name, status, assigned_role, result_data, completed_at, notes, created_at
     FROM workflow_tasks WHERE project_id = $1 ORDER BY step_code, created_at DESC`, [project.id]);

  const taskMap = new Map();
  for (const t of allTasks) {
    if (!taskMap.has(t.step_code)) taskMap.set(t.step_code, []);
    taskMap.get(t.step_code).push(t);
  }

  // Helper: get sample value from actual data
  function sample(stepCode, key) {
    const t = (taskMap.get(stepCode) || [])[0];
    if (!t?.result_data?.[key]) return '';
    const v = t.result_data[key];
    if (typeof v === 'string' && v.startsWith('[')) {
      try { return JSON.parse(v).length + ' mục'; } catch { return String(v).substring(0, 50); }
    }
    if (typeof v === 'object' && v !== null) return JSON.stringify(v).substring(0, 50);
    return String(v).substring(0, 50);
  }

  // ════════════════════════════════════════════════
  // SHEET 2: DÒNG CHẢY DỮ LIỆU — Step-centric
  // ════════════════════════════════════════════════
  const rows = [];

  function addStep(step, ten, role, mucDich, dauVao, input, dauRa) {
    // dauVao = array of { moTa, fields, tuBuoc, duLieuMau }
    // input  = { formFields, checklist, attachments } — người dùng nhập tay
    // dauRa  = array of { moTa, fields, denBuoc, duLieuMau }
    const maxRows = Math.max(dauVao.length, dauRa.length, 1);
    for (let i = 0; i < maxRows; i++) {
      const dv = dauVao[i] || {};
      const dr = dauRa[i] || {};
      rows.push({
        'Bước': i === 0 ? step : '',
        'Tên bước': i === 0 ? ten : '',
        'Phụ trách': i === 0 ? role : '',
        'Mục đích': i === 0 ? mucDich : '',
        // ĐẦU VÀO
        'Đầu vào: Loại dữ liệu': dv.moTa || '',
        'Đầu vào: Trường dữ liệu': dv.fields || '',
        'Đầu vào: Nhận từ bước': dv.tuBuoc || '',
        'Đầu vào: Dữ liệu mẫu': dv.duLieuMau || '',
        // INPUT
        'Input: Form nhập liệu': i === 0 ? (input.formFields || '') : '',
        'Input: Checklist': i === 0 ? (input.checklist || '') : '',
        'Input: File đính kèm': i === 0 ? (input.attachments || '') : '',
        // ĐẦU RA
        'Đầu ra: Loại dữ liệu': dr.moTa || '',
        'Đầu ra: Trường dữ liệu': dr.fields || '',
        'Đầu ra: Đẩy tới bước': dr.denBuoc || '',
        'Đầu ra: Dữ liệu mẫu': dr.duLieuMau || '',
      });
    }
    // Empty separator row
    rows.push({
      'Bước':'','Tên bước':'','Phụ trách':'','Mục đích':'',
      'Đầu vào: Loại dữ liệu':'','Đầu vào: Trường dữ liệu':'','Đầu vào: Nhận từ bước':'','Đầu vào: Dữ liệu mẫu':'',
      'Input: Form nhập liệu':'','Input: Checklist':'','Input: File đính kèm':'',
      'Đầu ra: Loại dữ liệu':'','Đầu ra: Trường dữ liệu':'','Đầu ra: Đẩy tới bước':'','Đầu ra: Dữ liệu mẫu':'',
    });
  }

  // ═══════════════════════════════════════
  // PHASE 1
  // ═══════════════════════════════════════
  addStep('P1.1', 'Tạo dự án', 'R02 (PM)',
    'PM khởi tạo dự án, đính kèm hồ sơ HĐ/RFQ/Spec.',
    [{ moTa: '(Bước đầu tiên)', fields: 'Không có', tuBuoc: 'Không có' }],
    { formFields: 'Mã DA, Tên DA, Khách hàng, Loại SP (select), Giá trị HĐ, Tiền tệ, Ngày bắt đầu, Ngày kết thúc, Mô tả', checklist: 'Đã nhận RFQ, Đã xác nhận PO, Đã kiểm tra năng lực SX, Đã xác nhận timeline', attachments: 'RFQ, PO, Spec/Bản vẽ, Hợp đồng/Phụ lục' },
    [{ moTa: 'Thông tin dự án + file đính kèm', fields: 'linkedFiles (số file)', denBuoc: 'P1.1B', duLieuMau: sample('P1.1', 'linkedFiles') }]);

  // I = input helper
  const I = (f, c, a) => ({ formFields: f||'', checklist: c||'', attachments: a||'' });

  addStep('P1.1B', 'BGĐ phê duyệt triển khai', 'R01 (BGĐ)',
    'BGĐ xem hồ sơ dự án, phê duyệt hoặc từ chối.',
    [{ moTa: 'Hồ sơ dự án + file HĐ', fields: 'File đính kèm từ P1.1 (contract, rfq, spec, po)', tuBuoc: 'P1.1', duLieuMau: '4 files' }],
    I('(Readonly) Mã DA, Tên DA, Khách hàng, Loại SP, Giá trị HĐ, Tiền tệ, Ngày BĐ, Ngày KT, Mô tả', 'Đã xem RFQ/PO, Đã đánh giá phạm vi, Đã đánh giá giá trị HĐ, Năng lực SX OK', 'RFQ, PO, Spec, Hợp đồng'),
    [{ moTa: 'Thông tin DA đã duyệt', fields: 'projectCode, projectName, clientName, productType, contractValue, startDate, endDate, currency, paymentType, deliveryType', denBuoc: 'P1.2A + P1.2 (song song)', duLieuMau: 'contractValue: ' + sample('P1.1B', 'contractValue') }]);

  addStep('P1.2A', 'PM lập KH kickoff, WBS, milestones', 'R02 (PM)',
    'PM lập WBS (phân chia hạng mục + phân giao thi công) và biên bản họp kickoff.',
    [{ moTa: 'Thông tin DA đã duyệt', fields: 'projectCode, contractValue, startDate, endDate', tuBuoc: 'P1.1B' }],
    I('Địa điểm họp, Ngày họp, Số BB, Người lập, Chủ đề + Bảng WBS (import Excel) + Bảng MOM (nội dung, người phụ trách, hạn) + Danh sách tham dự', 'Đã lên KH kickoff, Đã phân bổ WBS, BB họp đã xác nhận', 'File WBS (Excel/PDF), Tài liệu Kickoff/BB họp gốc'),
    [
      { moTa: 'WBS — Bảng phân chia hạng mục', fields: 'wbsItems[] {stt, hangMuc, dvt, khoiLuong, phamVi, thauPhu, batDau, ketThuc, 14 công đoạn SX}', denBuoc: 'P1.3, P3.1, P3.3, P3.4, P5.1, P5.1A', duLieuMau: sample('P1.2A', 'wbsItems') },
      { moTa: 'MOM — Biên bản họp kickoff', fields: 'momSections[] {key, title, items[]}, momAttendants[] {name, role}, kickoffDate, momNumber, momPlace', denBuoc: 'P1.3 (BGĐ review)', duLieuMau: sample('P1.2A', 'momSections') },
    ]);

  addStep('P1.2', 'Xây dựng dự toán thi công', 'R03 (KTKH)',
    'KTKH lập dự toán chi phí, chia 4 nhóm: VT, nhân công, dịch vụ, chi phí chung.',
    [{ moTa: 'Thông tin DA đã duyệt', fields: 'projectCode, contractValue', tuBuoc: 'P1.1B' }],
    I('KL thi công/Phạm vi, Các đợt thanh toán, ĐK phạt HĐ + Import bảng DT02 từ Excel (auto tính totalEstimate)', 'Đã đối chiếu BOM, Đã tính CP vận chuyển, Đã cộng dự phòng, DT02 khớp chi tiết', 'Bảng dự toán chi tiết (Excel)'),
    [
      { moTa: 'Bảng DT02 — Chi tiết chi phí', fields: 'dt02Detail[] {maCP, noiDung, giaTri} — 25 hạng mục', denBuoc: 'P1.3, P2.4, P2.5', duLieuMau: '25 hạng mục CP' },
      { moTa: 'Tổng dự toán 4 nhóm', fields: 'totalMaterial, totalLabor, totalService, totalOverhead, totalEstimate', denBuoc: 'P1.3, P2.3, P2.4, P2.5, P3.6, P6.2', duLieuMau: 'totalEstimate: ' + sample('P1.2', 'totalEstimate') },
    ]);

  addStep('P1.3', 'Phê duyệt KH và dự toán thi công', 'R01 (BGĐ)',
    'BGĐ xem WBS (P1.2A) + DT (P1.2) đồng thời → phê duyệt. GATE: chờ cả P1.2A và P1.2.',
    [
      { moTa: 'Kế hoạch WBS + MOM', fields: 'plan{wbsItems, momSections, momAttendants}', tuBuoc: 'P1.2A', duLieuMau: '4 hạng mục WBS' },
      { moTa: 'Dự toán thi công', fields: 'estimate{totalMaterial, totalLabor, totalService, totalOverhead, totalEstimate, dt02Detail}', tuBuoc: 'P1.2', duLieuMau: 'totalEstimate: ' + sample('P1.2', 'totalEstimate') },
    ],
    I('(Không có form — chỉ review)', 'Đã review KH kickoff/WBS/milestones, Đã review DT (DT01-DT07)', ''),
    [{ moTa: 'Kết quả phê duyệt', fields: 'planApproved (boolean), estimateApproved (boolean)', denBuoc: 'P2.1 + P2.2 + P2.3 + P2.1A (4 bước song song)', duLieuMau: 'planApproved: true' }]);

  // ═══ PHASE 2 ═══
  addStep('P2.1', 'Thiết kế bản vẽ + BOM VT chính', 'R04 (Design)',
    'Phòng TK phát hành bản vẽ IFC, lập BOM vật tư chính.',
    [{ moTa: '(Kích hoạt từ P1.3)', fields: '', tuBuoc: 'P1.3' }],
    I('Số lượng bản vẽ, Tiêu chuẩn (ASME/AWS/EN), Ghi chú BOM + Bảng BOM VT chính (nhập thủ công hoặc import Tekla)', 'BOM match 100% bản vẽ, Đã bổ sung hao hụt, Bản vẽ đạt IFC', 'File bản vẽ (DWG/PDF), File BOM (Excel)'),
    [{ moTa: 'BOM vật tư chính', fields: 'bomPrItems[] {name, code, spec, quantity, unit} — 160 mục', denBuoc: 'P2.4 (bomMain), P2.5, P3.2, P3.3, P3.4, P3.5, P4.4', duLieuMau: sample('P2.1', 'bomPrItems') }]);

  addStep('P2.2', 'PM đề xuất VT hàn và sơn', 'R02 (PM)',
    'PM lập danh sách dây hàn, que hàn, sơn lót, sơn phủ theo spec.',
    [{ moTa: '(Kích hoạt từ P1.3)', fields: '', tuBuoc: 'P1.3' }],
    I('Bảng VT hàn (tên, mã, spec, SL, ĐVT) + Bảng VT sơn (tên, mã, spec, SL, ĐVT) + Ghi chú đặc biệt', 'Đã kiểm tra spec VT hàn, Đã kiểm tra spec VT sơn', 'File DS VT hàn & sơn'),
    [
      { moTa: 'BOM vật tư hàn', fields: 'weldPrItems[] {name, code, spec, qty, unit}', denBuoc: 'P2.3, P2.4, P2.5, P3.2→P4.4', duLieuMau: sample('P2.2', 'weldPrItems') },
      { moTa: 'BOM vật tư sơn', fields: 'paintPrItems[] {name, code, spec, qty, unit}', denBuoc: 'P2.3, P2.4, P2.5, P3.2→P4.4', duLieuMau: sample('P2.2', 'paintPrItems') },
    ]);

  addStep('P2.3', 'Kho đề xuất VT tiêu hao', 'R05 (Kho)',
    'Kho đề xuất VT tiêu hao, tham chiếu VT hàn/sơn + ngân sách DT.',
    [
      { moTa: 'BOM VT hàn/sơn (tham chiếu)', fields: 'bom{weldPrItems, paintPrItems}', tuBuoc: 'P2.2' },
      { moTa: 'Dự toán (ngân sách VT)', fields: 'estimate{totalMaterial, totalEstimate}', tuBuoc: 'P1.2' },
    ],
    I('Bảng VT tiêu hao (tên, mã, spec, SL, ĐVT) + Ghi chú tồn kho', 'Đã review tồn kho, Đã kiểm tra surplus DA trước', 'File báo cáo tồn kho'),
    [{ moTa: 'BOM VT tiêu hao', fields: 'bomItems[] {name, code, spec, quantity, unit}', denBuoc: 'P2.4 (bomSupply), P2.5, P3.2→P4.4', duLieuMau: sample('P2.3', 'bomItems') }]);

  addStep('P2.1A', 'Lập kế hoạch dòng tiền', 'R08 (Tài chính)',
    'Tài chính lập KH dòng tiền (DT07), bổ sung chi phí tài chính.',
    [{ moTa: '(Kích hoạt từ P1.3)', fields: '', tuBuoc: 'P1.3' }],
    I('Bảng DT02 + Bảng DT07 (chi phí tài chính) + Ghi chú dự toán', 'Đã xác minh hạng mục CP, Đã tính thuế phí', 'Báo cáo CP tài chính'),
    [{ moTa: 'KH dòng tiền DT02+DT07', fields: 'dt02Items[], dt07Items[]', denBuoc: 'P2.4 (gộp estimate cùng P1.2), P2.5', duLieuMau: sample('P2.1A', 'dt07Items') }]);

  addStep('P2.4', 'KTKH điều chỉnh dự toán', 'R03 (KTKH)',
    'KTKH tổng hợp BOM 3 nguồn + DT gốc + dòng tiền → DT chính thức. GATE: chờ P2.1+P2.2+P2.3+P2.1A.',
    [
      { moTa: 'BOM VT chính', fields: 'bomMain{bomPrItems[]} — 160 mục', tuBuoc: 'P2.1' },
      { moTa: 'BOM VT hàn/sơn', fields: 'bomWeldPaint{weldPrItems[], paintPrItems[]}', tuBuoc: 'P2.2' },
      { moTa: 'BOM VT tiêu hao', fields: 'bomSupply{bomItems[]}', tuBuoc: 'P2.3' },
      { moTa: 'DT gốc + Dòng tiền', fields: 'estimate = P1.2(DT02-06) gộp P2.1A(DT07)', tuBuoc: 'P1.2 + P2.1A' },
    ],
    I('Bảng DT02-DT07 (điều chỉnh) + Tổng hợp BOM + So sánh ngân sách', 'Đã đối chiếu BOM vs DT, KH SX hoàn chỉnh, WBS budget đã cập nhật', 'File KH SX, File DT điều chỉnh'),
    [{ moTa: 'DT điều chỉnh DT02-DT07', fields: 'dt02-dt07Items[], bomSummary, budgetComparison', denBuoc: 'P2.5 (BGĐ duyệt)', duLieuMau: 'budgetComparison: ' + sample('P2.4', 'budgetComparison') }]);

  addStep('P2.5', 'BGĐ duyệt KH SX + DT chính thức', 'R01 (BGĐ)',
    'BGĐ review toàn bộ → phê duyệt cuối trước mua hàng.',
    [
      { moTa: 'DT điều chỉnh', fields: 'plan{dt02-dt07Items, bomSummary, budgetComparison}', tuBuoc: 'P2.4' },
      { moTa: 'DT gốc + Dòng tiền', fields: 'estimate (P1.2 gộp P2.1A)', tuBuoc: 'P1.2 + P2.1A' },
      { moTa: 'BOM 3 nguồn', fields: 'bomMain (P2.1), bomWeldPaint (P2.2), bomSupply (P2.3)', tuBuoc: 'P2.1+P2.2+P2.3' },
    ],
    I('(Không có form — chỉ review)', 'Đã review DT chính thức', ''),
    [{ moTa: 'Kết quả phê duyệt', fields: 'checklist{budget_reviewed}', denBuoc: 'P3.1 + P3.3 + P3.4 (Phase 3)', duLieuMau: sample('P2.5', 'checklist') }]);

  // ═══ PHASE 3 ═══
  addStep('P3.1', 'PM đẩy tiến độ cấp hàng', 'R02 (PM)',
    'PM xem WBS, xác định VT cần đặt sớm (long-lead).',
    [{ moTa: 'WBS từ kickoff', fields: 'plan{wbsItems[]}', tuBuoc: 'P1.2A' }],
    I('Ghi chú điều chỉnh timeline + Bảng long-lead items', 'Đã xem WBS, Đã xác định VT long-lead', ''),
    [{ moTa: 'DS long-lead items', fields: 'longLeadItems[]', denBuoc: 'P3.2', duLieuMau: sample('P3.1', 'longLeadItems') }]);

  addStep('P3.2', 'Kho kiểm tra tồn kho + duyệt PR', 'R05 (Kho)',
    'Kho nhận BOM gộp (167 mục), so khớp tồn kho → có sẵn / cần mua.',
    [
      { moTa: 'BOM gộp tự động (3 nguồn)', fields: 'prItems[] — 167 mục, fromStock[], toPurchase[]', tuBuoc: 'P2.1+P2.2+P2.3 + Materials DB' },
    ],
    I('Ghi chú kiểm tra tồn kho (hệ thống tự so khớp, Kho xác nhận)', 'Đã kiểm tra tồn kho, Đã kiểm tra CL tồn kho, Đã tạo PR tổng hợp', 'File PR tổng hợp'),
    [{ moTa: 'PR đã duyệt', fields: 'checklist{stock_checked, pr_consolidated}', denBuoc: 'P3.5', duLieuMau: sample('P3.2', 'checklist') }]);

  addStep('P3.3', 'PM lập LSX thầu phụ + đề nghị cấp VT', 'R02 (PM)',
    'PM dùng WBS phân giao cho thầu phụ, tạo LSX, đề nghị cấp VT.',
    [
      { moTa: 'WBS (phân giao stage)', fields: 'plan{wbsItems[]}', tuBuoc: 'P1.2A' },
      { moTa: 'BOM gộp', fields: 'bomItems[] (167 mục)', tuBuoc: 'P2.1+P2.2+P2.3' },
    ],
    I('Tên tổ thầu phụ, Tên CV, Mã CV, KL giao, Ngày BĐ/KT + Bảng phân giao WBS (chọn tổ cho từng ô hạng mục×công đoạn) + Bảng yêu cầu cấp VT', 'Đã tạo LSX, Đã thông báo thầu phụ', 'File lệnh SX'),
    [
      { moTa: 'Bảng phân giao LSX', fields: 'cellAssignments{[row]{[stage]: [{teamName, volume, dates}]}}', denBuoc: 'P4.5 (lsxData) → P5.1A', duLieuMau: sample('P3.3', 'cellAssignments') },
      { moTa: 'Trạng thái + YC cấp VT', fields: 'lsxIssuedDetails{...}, materialRequests{...}', denBuoc: 'P4.5', duLieuMau: sample('P3.3', 'materialRequests') },
    ]);

  addStep('P3.4', 'QLSX lập LSX nội bộ', 'R06 (Sản xuất)',
    'QLSX dùng WBS phân giao cho tổ nội bộ, tạo WO.',
    [
      { moTa: 'WBS', fields: 'plan{wbsItems[]}', tuBuoc: 'P1.2A' },
      { moTa: 'BOM gộp', fields: 'bomItems[]', tuBuoc: 'P2.1+P2.2+P2.3' },
    ],
    I('Sổ lệnh (auto), Dự toán ref, Ngày lập + Bảng phân giao WBS (chọn tổ nội bộ) + YC cấp VT', 'Đã phát LSX, Đã liên kết BOM, Đã kiểm tra VT', 'File lệnh SX'),
    [
      { moTa: 'Bảng phân giao LSX nội bộ + WO', fields: 'cellAssignments{...}, woNumber, lsxIssuedDetails, materialRequests', denBuoc: 'P4.5 (woData) → P5.1', duLieuMau: 'woNumber: ' + sample('P3.4', 'woNumber') },
    ]);

  addStep('P3.5', 'Thương mại tìm NCC', 'R07 (Thương mại)',
    'Thương mại nhận DS VT cần mua, liên hệ NCC lấy báo giá.',
    [{ moTa: 'DS VT cần mua', fields: 'prItems[] — 167 mục', tuBuoc: 'P2.1+P2.2+P2.3' }],
    I('Số RFQ đã gửi, Cảnh báo long-lead + Bảng NCC (tên NCC, báo giá từng VT)', 'Đã có tối thiểu 3 báo giá, Đã so sánh', ''),
    [{ moTa: 'Bảng báo giá NCC', fields: 'suppliers[] {name, quotes[{material, price}]}', denBuoc: 'P3.6 → P3.7 → P4.2 → P4.3 → P4.4', duLieuMau: sample('P3.5', 'suppliers') }]);

  addStep('P3.6', 'BGĐ duyệt báo giá NCC', 'R01 (BGĐ)',
    'BGĐ so sánh báo giá NCC với ngân sách DT.',
    [
      { moTa: 'Báo giá NCC', fields: 'supplierData{suppliers[]}', tuBuoc: 'P3.5' },
      { moTa: 'DT (so sánh)', fields: 'estimate{totalEstimate}', tuBuoc: 'P1.2' },
    ],
    I('(Không có form — chỉ review)', 'Đã review báo giá, Đã so sánh với DT', ''),
    [{ moTa: 'NCC được duyệt', fields: 'supplierApproved, approvedSupplier', denBuoc: 'P3.7', duLieuMau: 'approvedSupplier: ' + sample('P3.6', 'approvedSupplier') }]);

  addStep('P3.7', 'Thương mại chốt hàng, ĐK thanh toán', 'R07 (Thương mại)',
    'Chốt PO: số PO, tổng tiền, đợt thanh toán, ngày giao hàng.',
    [{ moTa: 'Báo giá NCC đã duyệt', fields: 'supplierData{suppliers[]}', tuBuoc: 'P3.5' }],
    I('Số PO, Tổng giá trị PO + Chọn ĐK thanh toán (full/partial + milestones) + KH giao hàng', 'Đã phát PO, Đã xác nhận ĐK thanh toán', 'File PO'),
    [{ moTa: 'PO', fields: 'poNumber, totalAmount, paymentType, paymentMilestones[], deliveryDate', denBuoc: 'P4.1 + P4.2 + P4.3', duLieuMau: 'poNumber: ' + sample('P3.7', 'poNumber') }]);

  // ═══ PHASE 4 ═══
  addStep('P4.1', 'Kế toán thanh toán', 'R08 (Tài chính)',
    'Kế toán nhận PO, thanh toán theo đợt.',
    [{ moTa: 'PO', fields: 'poData{poNumber, totalAmount, paymentMilestones[]}', tuBuoc: 'P3.7' }],
    I('Ghi chú thanh toán (hệ thống hiển thị milestones từ PO, KT xác nhận từng đợt)', 'Đã thanh toán, Đã ghi nhận A/P', 'Chứng từ thanh toán'),
    [{ moTa: 'Chứng từ TT', fields: 'paymentRef, paymentAmount, paymentDate, paymentMethod, bankName, milestone', denBuoc: '(Lưu hệ thống)', duLieuMau: 'paymentRef: ' + sample('P4.1', 'paymentRef') }]);

  addStep('P4.2', 'Thương mại theo dõi hàng về', 'R07 (Thương mại)',
    'Theo dõi vận chuyển, đối chiếu packing list.',
    [
      { moTa: 'PO (KH giao hàng)', fields: 'poData{deliveryDate}', tuBuoc: 'P3.7' },
      { moTa: 'Thông tin NCC', fields: 'supplierData{suppliers[]}', tuBuoc: 'P3.5' },
    ],
    I('Ngày hàng về, Tình trạng GH (đúng hạn/trễ/từng phần), Thông tin lô hàng', 'Đã xác nhận hàng về, Đã bàn giao QC', 'Phiếu giao hàng'),
    [{ moTa: 'Biên bản nhận hàng', fields: 'deliveryCode, receivedDate, itemsReceived[]', denBuoc: 'P4.3', duLieuMau: 'deliveryCode: ' + sample('P4.2', 'deliveryCode') }]);

  addStep('P4.3', 'QC nghiệm thu CL nhập kho', 'R09 (QC)',
    'QC kiểm tra CL VT: kích thước, Mill Cert, bề mặt. FAIL → trả P3.7.',
    [
      { moTa: 'PO (spec đối chiếu)', fields: 'poData', tuBuoc: 'P3.7' },
      { moTa: 'NCC', fields: 'supplierData', tuBuoc: 'P3.5' },
    ],
    I('Kết quả NT (PASS/FAIL/CONDITIONAL), MTR/Cert đã xác minh + Bảng QC items (hạng mục kiểm tra, kết quả)', 'Đã kiểm tra visual, Đã kiểm tra kích thước, Đã xác minh cert', ''),
    [{ moTa: 'Kết quả QC', fields: 'inspectionResult (PASS/FAIL), qcItems[] {task, result}', denBuoc: 'P4.4 (chỉ khi PASS)', duLieuMau: 'inspectionResult: ' + sample('P4.3', 'inspectionResult') }]);

  addStep('P4.4', 'Kho nhập kho', 'R05 (Kho)',
    'Kho đối chiếu SL + kết quả QC → nhập kho + cập nhật tồn.',
    [
      { moTa: 'Kết quả QC', fields: 'qcData{inspectionResult, qcItems[]}', tuBuoc: 'P4.3' },
      { moTa: 'NCC', fields: 'supplierData', tuBuoc: 'P3.5' },
      { moTa: 'BOM gộp', fields: 'prItems[] — 167 mục', tuBuoc: 'P2.1+P2.2+P2.3' },
    ],
    I('(Hệ thống hiển thị DS VT + kết quả QC, Kho xác nhận SL + vị trí kho)', 'Đã kiểm SL, Đã phân bổ vị trí, Đã cập nhật hệ thống', ''),
    [{ moTa: 'Phiếu nhập kho (GRN)', fields: 'grnNumber, stockInDate, stockInItems[]', denBuoc: '(Cập nhật Materials → P4.5)', duLieuMau: 'grnNumber: ' + sample('P4.4', 'grnNumber') }]);

  addStep('P4.5', 'Kho cấp VT cho PM và QLSX', 'R05 (Kho)',
    'Kho nhận LSX, chọn VT từ tồn kho → xuất cho tổ SX. Hoàn thành → tạo P5.1/P5.1A.',
    [
      { moTa: 'LSX thầu phụ', fields: 'lsxData{cellAssignments, materialRequests}', tuBuoc: 'P3.3' },
      { moTa: 'LSX nội bộ', fields: 'woData{cellAssignments, woNumber}', tuBuoc: 'P3.4' },
      { moTa: 'Tồn kho khả dụng', fields: 'inventory[] (stock>0)', tuBuoc: 'Materials DB' },
    ],
    I('(Hệ thống hiển thị DS YC cấp VT từ LSX + tồn kho. Kho chọn VT xuất, nhập SL thực xuất)', 'Đã kiểm VT, Đã xuất cho tổ SX', ''),
    [{ moTa: 'Phiếu xuất kho + Tạo task SX', fields: 'sourceStep, materialIssueRequests[], issuedAccumulated, _p51Created', denBuoc: 'P5.1 (nếu P3.4) / P5.1A (nếu P3.3)', duLieuMau: 'sourceStep: ' + sample('P4.5', 'sourceStep') }]);

  // ═══ PHASE 5 ═══
  addStep('P5.1', 'Báo cáo KL nội bộ (theo ngày)', 'R06b (Tổ SX)',
    'Tổ SX nội bộ báo cáo KL hoàn thành hàng ngày.',
    [{ moTa: 'Phân giao LSX (qua P4.5)', fields: 'lsxTeamData{teamName, volume, stageKey, hangMuc...}', tuBuoc: 'P3.4 → P4.5' }],
    I('Bảng báo cáo ngày (ngày, công đoạn, KL, ĐVT, tổ SX)', '', ''),
    [{ moTa: 'Báo cáo KL ngày', fields: 'dailyReport[], totalVolume, reportPeriod', denBuoc: 'P5.2, P5.3, P5.4', duLieuMau: 'totalVolume: ' + sample('P5.1', 'totalVolume') }]);

  addStep('P5.1A', 'Báo cáo KL thầu phụ (theo ngày)', 'R02 (PM)',
    'PM/thầu phụ báo cáo KL hàng ngày.',
    [{ moTa: 'Phân giao LSX (qua P4.5)', fields: 'lsxTeamData{teamName, volume, stageKey, hangMuc...}', tuBuoc: 'P3.3 → P4.5' }],
    I('Bảng báo cáo ngày (ngày, công đoạn, KL, ĐVT, tổ thầu phụ)', '', ''),
    [{ moTa: 'Báo cáo KL ngày thầu phụ', fields: 'dailyReport[], totalVolume, reportPeriod', denBuoc: 'P5.3, P5.4', duLieuMau: 'totalVolume: ' + sample('P5.1A', 'totalVolume') }]);

  addStep('P5.3', 'QC nghiệm thu KL tuần', 'R09 (QC)',
    'QC nghiệm thu KL tuần: reported vs accepted. Dữ liệu bất khả xâm phạm.',
    [
      { moTa: 'Báo cáo KL', fields: 'jobCardData (dailyReport[])', tuBuoc: 'P5.1' },
      { moTa: 'Context tổ/stage', fields: 'lsxTeamData', tuBuoc: 'P3.4 → P4.5' },
    ],
    I('Bảng nghiệm thu (hạng mục, stage, KL báo cáo, KL chấp nhận, ghi chú sai lệch)', 'Đã xác minh KL, CL OK', ''),
    [{ moTa: 'BB NT KL tuần (immutable)', fields: 'weekNumber, year, acceptedVolume[], totalAccepted, qcResult', denBuoc: 'P5.4', duLieuMau: 'totalAccepted: ' + sample('P5.3', 'totalAccepted') }]);

  addStep('P5.4', 'PM nghiệm thu KL tuần', 'R02 (PM)',
    'PM nghiệm thu cuối cùng. Dữ liệu bất khả xâm phạm.',
    [
      { moTa: 'Báo cáo KL P5.1', fields: 'jobCardData (sourceP51TaskId)', tuBuoc: 'P5.1' },
      { moTa: 'KL tuần P5.2', fields: 'volumeData', tuBuoc: 'P5.2 (nếu có)' },
      { moTa: 'Context LSX', fields: 'lsxTeamData', tuBuoc: 'P3.x → P4.5' },
    ],
    I('Bảng nghiệm thu PM (hạng mục, stage, KL QC chấp nhận, KL PM chấp nhận)', 'Đã review QC, Đã xác nhận KL', ''),
    [{ moTa: 'BB NT PM (immutable)', fields: 'weekNumber, year, pmAcceptedVolume[], totalPmAccepted, pmResult', denBuoc: 'P5.5 (nếu đủ KL)', duLieuMau: 'totalPmAccepted: ' + sample('P5.4', 'totalPmAccepted') }]);

  // ════════════════════════════════════════════════
  // BUILD WORKBOOK
  // ════════════════════════════════════════════════
  const wb = XLSX.utils.book_new();

  // Sheet 2 (new format)
  const ws2 = XLSX.utils.json_to_sheet(rows);
  ws2['!cols'] = [
    {wch:7},{wch:38},{wch:16},{wch:50},
    {wch:35},{wch:55},{wch:30},{wch:35},
    {wch:55},{wch:35},{wch:12},
    {wch:35},{wch:55},{wch:35},{wch:45},
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '2. Dòng chảy dữ liệu');

  const outPath = path.join(__dirname, 'DA-26-Test_Dong-Chay-Du-Lieu-v3.xlsx');
  XLSX.writeFile(wb, outPath);
  console.log('✅ Sheet "Dòng chảy dữ liệu" generated:', outPath);
  console.log('Rows:', rows.length, '(27 steps with separator rows)');

  client.release();
  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
