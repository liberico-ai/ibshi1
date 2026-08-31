import { describe, it, expect } from 'vitest'
import { parseAplSheets, guessRevision, scoreAplSheet, type SheetMap } from '../apl-parser'

// Bộ test chứng minh parser KHÔNG bám vào một file APL cụ thể: đọc được cả bảng đầy đủ
// kiểu I095-VOGT lẫn bảng rút gọn đổi nhãn, và không bỏ sót khối lượng.

/** Giống file thật: nhiều cột tổng lệch phạm vi (1 unit vs 2 unit), nhãn "PHÂN LOẠI" 2 lần. */
const SHEET_DAY_DU = [
  ['ASSEMBLY PART LIST I095-VOGT'],
  [],
  [],
  ['NO', 'EBOM', 'DWGNUMBER', 'ASSEMBLY', 'POS', 'PART', 'MARK CUTTING', "Q'ty (in dwg)",
    'SL CHO 1 UNIT', 'SL UNITS', "T.Q'TY-2UNIT", 'Description', 'Profile', 'TYPE CUTTING', 'Material',
    'Thick(mm)', 'Width (mm)', 'Length (mm)', 'UNIT WEIGHT(KG)', 'T. WEIGHT 1 units (KG)',
    'T. WEIGHT (KG) 2 UNIT', 'PHÂN LOẠI', 'T.Area 1UNIT (m2)', 'REMARK 1 (K,S,V,M,G,..)', 'PHÂN LOẠI', 'HOLD'],
  // dòng tiêu đề cụm — chưa có PART, chưa có khối lượng
  [1, '', 'V17565-SKND-0020', 'V17565-SKND-0020', '', '', '', '', 5, 2, '', 'STACK TEMPLATE'],
  [2, '', 'V17565-SKND-0020', 'V17565-SKND-0020', '1A', '1A', 'I95-SKND-0020-1A', 2, 10, 2, 20,
    'FLANGE', 'PL10', 'PL10', 'SS400', 10, 450, 2209, 41.58, 415.78, 831.56, 'SẮT HÀN', 10.59, 'K', 'SẮT', 'OK'],
  [3, '', 'V17565-SKND-0020', 'V17565-SKND-0020', '2', '2', 'I95-SKND-0020-2', 2, 10, 2, 20,
    'PLATE', 'PL10', 'PL10', 'SS400', 10, 102, 152, 1.22, 12.17, 24.34, 'SẮT HÀN', 0.31, '', 'SẮT', ''],
  // cụm mua nguyên khối: KHÔNG có PART nhưng CÓ khối lượng → vẫn phải cộng vào tổng
  [4, '', 'V17565-BPND-0009', 'V17565-BP109', '', '', '', '', 1, 2, 2,
    'GASKET SET', '', '', 'GARLOCK', 2, 500, 600, 50, 50, 100, 'GASKET', 0, '', '', ''],
]

/** Bảng rút gọn: nhãn tiếng Việt, ít cột, không có dòng cụm, không có cột tổng đa unit. */
const SHEET_RUT_GON = [
  ['DANH SÁCH CHI TIẾT - DỰ ÁN NỘI BỘ'],
  ['ASSEMBLY', 'PART', 'Description', 'Profile', 'Vật liệu', 'Số lượng', 'UNIT WEIGHT(KG)', 'T.WEIGHT', 'Tổ thi công'],
  ['KC-01', 'P1', 'Bản mã', 'PL10', 'SS400', 4, 5, 20, 'Tổ 1'],
  ['KC-01', 'P2', 'Sườn', 'PL8', 'SS400', 2, 3, 6, 'Tổ 2'],
]

describe('apl-parser — bảng APL đầy đủ', () => {
  const r = parseAplSheets({ 'ASSEMBLY PL-I95': SHEET_DAY_DU })

  it('chọn đúng sheet và đúng dòng tiêu đề', () => {
    expect(r.ok).toBe(true)
    expect(r.sheetName).toBe('ASSEMBLY PL-I95')
    expect(r.headerRow).toBe(3)
    expect(r.title).toBe('ASSEMBLY PART LIST I095-VOGT')
  })

  it('số lượng và khối lượng lấy CÙNG phạm vi unit, không trộn 1 unit với 2 unit', () => {
    const qty = r.columns.find(c => c.field === 'qty')
    const w = r.columns.find(c => c.field === 'totalWeightKg')
    expect(qty?.label).toBe("T.Q'TY-2UNIT")
    expect(w?.label).toBe('T. WEIGHT (KG) 2 UNIT')
    expect(r.summary.scopeUnits).toBe(2)
    expect(r.warnings.some(x => x.includes('2 UNIT'))).toBe(true)
  })

  it('nhãn trùng nhau: cột thứ hai không đè cột đầu mà rơi về extra', () => {
    const cats = r.columns.filter(c => c.field === 'category')
    expect(cats).toHaveLength(1)
    expect(cats[0].index).toBe(21)
    const extraKeys = r.columns.filter(c => !c.field).map(c => c.key)
    expect(extraKeys.filter(k => k.startsWith('phan_loai'))).toHaveLength(1)
  })

  it('phân biệt dòng cụm với dòng part', () => {
    const asm = r.lines.filter(l => l.isAssembly)
    expect(asm.map(l => l.description)).toEqual(['STACK TEMPLATE', 'GASKET SET'])
    expect(r.summary.partRows).toBe(2)
    expect(r.summary.distinctAssemblies).toBe(2)
  })

  it('cộng cả cụm mua nguyên khối — bỏ ra là hụt khối lượng', () => {
    // 831.56 + 24.34 (part) + 100 (cụm GASKET không có mã PART)
    expect(r.summary.totalWeightKg).toBeCloseTo(955.9, 1)
    expect(r.summary.byCategory).toEqual({ 'SẮT HÀN': 2, GASKET: 1 })
  })

  it('giữ nguyên cột riêng của dự án vào extra', () => {
    const line = r.lines.find(l => l.part === '1A')!
    expect(line.extra['ebom']).toBeUndefined()             // ô trống thì không lưu
    expect(line.extra["q_ty_in_dwg"]).toBe(2)
    expect(line.extra['hold']).toBe('OK')
    expect(line.extra['t_weight_1_units_kg']).toBe(415.78)  // cột 1-unit vẫn còn, chỉ không dùng làm tổng
  })

  it('đọc đúng các ô kích thước và mã', () => {
    const line = r.lines.find(l => l.part === '1A')!
    expect(line.markCutting).toBe('I95-SKND-0020-1A')
    expect(line.drawingNo).toBe('V17565-SKND-0020')
    expect(line.profile).toBe('PL10')
    expect(line.grade).toBe('SS400')
    expect(line.thicknessMm).toBe(10)
    expect(line.lengthMm).toBe(2209)
    expect(line.qty).toBe(20)
    expect(line.unitWeightKg).toBe(41.58)
  })
})

describe('apl-parser — bảng rút gọn, nhãn khác', () => {
  const r = parseAplSheets({ APL: SHEET_RUT_GON })

  it('vẫn đọc được khi thiếu nhiều cột', () => {
    expect(r.ok).toBe(true)
    expect(r.headerRow).toBe(1)
    expect(r.lines).toHaveLength(2)
    expect(r.summary.scopeUnits).toBe(1)
  })

  it('khớp được nhãn tiếng Việt và cột tổng không ghi phạm vi', () => {
    expect(r.lines[0].grade).toBe('SS400')
    expect(r.lines[0].qty).toBe(4)
    expect(r.lines[0].totalWeightKg).toBe(20)
    expect(r.summary.totalWeightKg).toBe(26)
  })

  it('cột lạ được giữ và có cảnh báo', () => {
    const extra = r.columns.filter(c => !c.field)
    expect(extra.map(c => c.label)).toContain('Tổ thi công')
    expect(r.lines[0].extra['to_thi_cong']).toBe('Tổ 1')
    expect(r.warnings.some(w => w.includes('Tổ thi công'))).toBe(true)
  })

  it('không có cột PART rỗng nào → không dòng cụm nào', () => {
    expect(r.summary.assemblyRows).toBe(0)
  })
})

describe('apl-parser — biên', () => {
  it('sheet không phải APL thì báo NO_SHEET, không đoán bừa', () => {
    const r = parseAplSheets({ 'Bảng lương': [['Họ tên', 'Chức vụ', 'Lương'], ['Nguyễn A', 'Thợ hàn', 10]] })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('NO_SHEET')
  })

  it('cho phép ép đọc theo sheet người dùng chọn', () => {
    const sheets: SheetMap = { Trong: [['x']], 'PL-1': SHEET_DAY_DU }
    const r = parseAplSheets(sheets, { sheetName: 'PL-1' })
    expect(r.ok).toBe(true)
    expect(r.sheetName).toBe('PL-1')
  })

  it('chấm điểm ưu tiên sheet APL thật hơn sheet phụ', () => {
    const main = scoreAplSheet('ASSEMBLY PL-I95', SHEET_DAY_DU)
    const phu = scoreAplSheet('NOI L LOC', [['ASSEMBLY', 'PART', 'GHI CHÚ']])
    expect(main).toBeGreaterThan(phu)
  })

  it('đoán số revision từ tên file', () => {
    expect(guessRevision('I95-VOGT-BOM-REV0-2026.07.23.xlsx')).toBe('REV0')
    expect(guessRevision('apl.xlsx', 'Assembly Part List Rev. 2')).toBe('REV2')
    expect(guessRevision('khong-co-gi.xlsx')).toBeNull()
  })
})

// ── Gộp theo KHỐI: dòng vàng + các dòng trắng bên trong ──
// Quy tắc nghiệp vụ: mỗi dòng vàng = 1 lệnh sản xuất; khối lượng = CỘNG các dòng trắng bên
// trong; vật tư chỉ lấy TÊN, không kèm khối lượng.
const SHEET_KHOI = [
  ['ASSEMBLY PART LIST'],
  ['NO', 'DWGNUMBER', 'ASSEMBLY', 'POS', 'PART', 'MARK CUTTING', 'ITEM', 'Description',
    'Profile', 'Material', 'Thick(mm)', "T.Q'TY", 'UNIT WEIGHT(KG)', 'T. WEIGHT (KG) 2 UNIT'],
  // Khối 1 — có 3 dòng trắng, dòng vàng KHÔNG có khối lượng riêng
  [1, 'DWG-1', 'ASM-A', '', '', '', 'TOP BEAM', 'Beam assembly', '', '', '', '', '', ''],
  [2, 'DWG-1', 'ASM-A', 'P1', 'P1', 'MK-1', 'TOP BEAM', 'Web', 'PL25', 'A572GR50', 25, 2, 100, 200],
  [3, 'DWG-1', 'ASM-A', 'P2', 'P2', 'MK-2', 'TOP BEAM', 'Flange', 'PL38', 'A572GR50', 38, 4, 50, 200],
  [4, 'DWG-1', 'ASM-A', 'P3', 'P3', 'MK-3', 'TOP BEAM', 'Stiffener', 'T170', 'SS400', 9, 8, 12.5, 100],
  // Khối 2 — dòng vàng có sẵn số ở ô khối lượng NHƯNG vẫn phải lấy tổng dòng trắng
  [5, 'DWG-2', 'ASM-B', '', '', '', 'TOP BEAM', 'Insulation', '', '', '', '', '', 999],
  [6, 'DWG-2', 'ASM-B', 'P4', 'P4', 'MK-4', 'TOP BEAM', 'Panel', 'PL2', 'GARLOCK', 2, 1, 30, 30],
  // Khối 3 — dòng cụm thật (trống cả PART lẫn POS)
  [7, 'DWG-3', 'ASM-C', '', '', '', 'PIPE RACK', 'Stud pack', '', '', '', '', '', ''],
  // Hàng mua: mã ghi ở POS, PART để trống → vẫn là DÒNG TRẮNG, không phải dòng cụm
  [8, 'DWG-3', 'ASM-C', 'S3M17', '', '', 'PIPE RACK', 'STUD', 'RB10X137', 'SUS304', '', 1, 130.44, 130.44],
]

describe('apl-parser — gộp khối (dòng vàng = 1 lệnh sản xuất)', () => {
  const r = parseAplSheets({ 'ASSEMBLY PL': SHEET_KHOI })
  const heads = r.lines.filter(l => l.isAssembly)

  it('nhận ITEM thành cột riêng, không để lẫn vào extra', () => {
    expect(r.columns.find(c => c.field === 'item')?.label).toBe('ITEM')
    expect(r.lines[0].item).toBe('TOP BEAM')
    expect(r.lines[0].extra['item']).toBeUndefined()
  })

  it('chia đúng số khối và số dòng trắng mỗi khối', () => {
    expect(heads.map(h => h.assembly)).toEqual(['ASM-A', 'ASM-B', 'ASM-C'])
    expect(heads.map(h => h.childCount)).toEqual([3, 1, 1])
    // dòng vàng và các dòng trắng của nó dùng chung blockNo
    expect(r.lines.filter(l => l.blockNo === 1)).toHaveLength(4)
  })

  it('khối lượng dòng vàng = CỘNG các dòng trắng bên trong', () => {
    expect(heads[0].rollupWeightKg).toBe(500)          // 200 + 200 + 100
  })

  it('ô khối lượng sẵn có trên dòng vàng KHÔNG được dùng khi đã có dòng trắng', () => {
    expect(heads[1].rollupWeightKg).toBe(30)           // lấy dòng trắng, không lấy 999
  })

  it('hàng mua ghi mã ở POS mà trống PART vẫn là DÒNG TRẮNG, không phải dòng cụm', () => {
    // Trước đây luật chỉ xét PART nên dòng này bị nhận nhầm thành dòng cụm riêng.
    const white = r.lines.filter(l => !l.isAssembly)
    expect(white.some(l => l.pos === 'S3M17')).toBe(true)
    expect(heads[2].childCount).toBe(1)
    expect(heads[2].rollupWeightKg).toBe(130.44)
    expect(heads[2].rollupMaterials).toEqual(['RB10X137 SUS304'])
  })

  it('vật tư gồm QUY CÁCH + MÁC, gom từ dòng trắng, không trùng lặp', () => {
    // Chỉ ghi mác thì không đặt hàng được — phải kèm quy cách mới ra được mã kho.
    expect(heads[0].rollupMaterials).toEqual(['PL25 A572GR50', 'PL38 A572GR50', 'T170 SS400'])
    expect(heads[1].rollupMaterials).toEqual(['PL2 GARLOCK'])
  })

  it('dòng trắng không mang số liệu gộp — chỉ dòng vàng mới có', () => {
    const white = r.lines.filter(l => !l.isAssembly)
    expect(white.every(l => l.rollupWeightKg === null)).toBe(true)
    expect(white.every(l => l.rollupMaterials === null)).toBe(true)
  })
})
