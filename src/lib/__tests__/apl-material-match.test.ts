import { describe, it, expect } from 'vitest'
import {
  parseAplProfile, parseCatalogueSpec, dimsCompatible,
  indexCatalogue, matchAplMaterial, aplAliasKey, shapeFamily, buildHistoryIndex,
  type CatalogueItem, type IndexedMaterial,
} from '../apl-material-match'

// Danh mục kho rút gọn, lấy đúng kiểu tên thật trong hệ.
const KHO: CatalogueItem[] = [
  { id: 'm1', materialCode: 'NL.VT08', name: 'Thép tấm 10', grade: null, specification: null },
  { id: 'm2', materialCode: 'NL.VT25', name: 'Thép tấm 20  A572/Gr.50/ Steel plate', grade: 'A572GR50', specification: null },
  { id: 'm3', materialCode: 'VLC.H175.001', name: 'Thép H175x175x7.5x11x12000', grade: null, specification: null },
  { id: 'm4', materialCode: 'VLC-H100-003', name: 'Thép H100x100x6x8x12000 SS400', grade: 'SS400', specification: null },
  { id: 'm5', materialCode: 'BL.BINOX.08.35', name: 'Bu lông inox M8x35', grade: 'INOX', specification: '8x35' },
  { id: 'm6', materialCode: 'VLC-P025-044', name: 'Thép tấm 25 A572/Gr.50', grade: 'A572GR50', specification: null },
]
const IDX = indexCatalogue(KHO)
const noAlias = new Map<string, IndexedMaterial>()

describe('apl-material-match — giải mã ký hiệu bản vẽ', () => {
  it('thép tấm: số đầu là ĐỘ DÀY', () => {
    expect(parseAplProfile('PL25')).toEqual({ shape: 'PL', dims: [25] })
    expect(parseAplProfile('PL10')).toEqual({ shape: 'PL', dims: [10] })
  })

  it('PL38*400 phải ra độ dày 38, KHÔNG dính thành 38400', () => {
    // Lỗi đã gặp: bỏ dấu "*" trước khi tách số → 38400. Cặp này nặng 106 tấn.
    expect(parseAplProfile('PL38*400')).toEqual({ shape: 'PL', dims: [38] })
    expect(parseAplProfile('PL32*400')).toEqual({ shape: 'PL', dims: [32] })
    expect(parseAplProfile('PL20*836')).toEqual({ shape: 'PL', dims: [20] })
  })

  it('thép hình: tách được chữ hình và dãy kích thước', () => {
    expect(parseAplProfile('H-400X400X13X21')).toEqual({ shape: 'H', dims: [400, 400, 13, 21] })
    expect(parseAplProfile('C-200X80X7.5X11')).toEqual({ shape: 'C', dims: [200, 80, 7.5, 11] })
  })

  it('không nhận ra thì trả null, không đoán bừa', () => {
    expect(parseAplProfile('')).toBeNull()
    expect(parseAplProfile('HÀNG MUA')).toBeNull()
  })
})

describe('apl-material-match — đọc tên vật tư kho', () => {
  it('thép tấm lấy độ dày, bỏ qua số trong mác thép', () => {
    expect(parseCatalogueSpec('Thép tấm 10')).toEqual({ shape: 'PL', dims: [10] })
    // "A572/Gr.50" có số 572 và 50 — không được vớ nhầm làm độ dày
    expect(parseCatalogueSpec('Thép tấm 20  A572/Gr.50/ Steel plate')).toEqual({ shape: 'PL', dims: [20] })
  })

  it('thép hình: bỏ chiều dài cây tiêu chuẩn ở cuối', () => {
    // 12000 là chiều dài cây, bản vẽ không ghi → phải bỏ mới khớp được
    expect(parseCatalogueSpec('Thép H175x175x7.5x11x12000')).toEqual({ shape: 'H', dims: [175, 175, 7.5, 11] })
  })
})

describe('apl-material-match — so kích thước', () => {
  it('so theo phần chung, kho ghi dài hơn vẫn khớp', () => {
    expect(dimsCompatible([400, 400, 13, 21], [400, 400, 13, 21])).toBe(true)
    expect(dimsCompatible([175, 175], [175, 175, 7.5, 11])).toBe(true)
    expect(dimsCompatible([400], [300])).toBe(false)
    expect(dimsCompatible([], [10])).toBe(false)
  })
})

describe('apl-material-match — khớp 3 tầng', () => {
  it('TẦNG 1 luật: PL25 → thép tấm đúng độ dày', () => {
    const r = matchAplMaterial('A572GR50', 'PL25', IDX, noAlias)
    expect(r.via).toBe('rule')
    expect(r.materialCode).toBe('VLC-P025-044')
  })

  it('ưu tiên mã có đúng mác thép', () => {
    const r = matchAplMaterial('A572GR50', 'PL20', IDX, noAlias)
    expect(r.materialCode).toBe('NL.VT25')      // "Thép tấm 20 A572/Gr.50"
    expect(r.gradeMismatch).toBe(false)
  })

  it('khớp quy cách nhưng không thấy mác → vẫn trả về NHƯNG đánh dấu lệch mác', () => {
    const r = matchAplMaterial('SS400', 'PL10', IDX, noAlias)
    expect(r.via).toBe('rule')
    expect(r.materialCode).toBe('NL.VT08')       // "Thép tấm 10", không ghi mác
    expect(r.gradeMismatch).toBe(true)
  })

  it('TẦNG 3 chưa có mã: không ép khớp, trả về rỗng', () => {
    const r = matchAplMaterial('SS400', 'C-200X80X7.5X11', IDX, noAlias)
    expect(r.via).toBeNull()
    expect(r.materialCode).toBeNull()
  })

  it('TẦNG 2 bí danh THẮNG luật máy', () => {
    const alias = new Map<string, IndexedMaterial>([[aplAliasKey('SS400', 'C-200X80X7.5X11'), IDX[2]]])
    const r = matchAplMaterial('SS400', 'C-200X80X7.5X11', IDX, alias)
    expect(r.via).toBe('alias')
    expect(r.materialCode).toBe('VLC.H175.001')

    // ngay cả khi luật cũng khớp được, bí danh vẫn thắng
    const a2 = new Map<string, IndexedMaterial>([[aplAliasKey('A572GR50', 'PL25'), IDX[4]]])
    expect(matchAplMaterial('A572GR50', 'PL25', IDX, a2).materialCode).toBe('BL.BINOX.08.35')
  })

  it('khoá bí danh có tiền tố APL: nên không đụng mã cũ thật của kho', () => {
    expect(aplAliasKey('SS400', 'PL25')).toBe('APL:SS400|PL25')
    expect(aplAliasKey('A572GR50', 'C-200X80X7.5X11')).toBe('APL:A572GR50|C200X80X75X11')
  })

  it('nhiều mã cùng khớp thì nêu ứng viên, không tự chọn bừa', () => {
    const r = matchAplMaterial('SS400', 'H-100X100X6X8', IDX, noAlias)
    expect(r.via).toBe('rule')
    expect(r.candidates.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Nhóm chữ hình tương đương ──
// Bản vẽ và kho gọi cùng một loại thép bằng chữ khác nhau. Đo trên file thật, riêng luật này
// kéo tỉ lệ phủ 63,4% → 77,5%.
describe('apl-material-match — H ≡ I, C ≡ U', () => {
  const KHO2: CatalogueItem[] = [
    { id: 'i1', materialCode: 'VLC-I244-001', name: 'Thép I244x175x7x11x12000 SS400', grade: 'SS400', specification: 'I244x175x7x11x12000' },
    { id: 'u1', materialCode: 'VLC.U200.007', name: 'Thép U200x80x7.5x11x12000', grade: null, specification: 'U200x80x7.5x11x12000' },
  ]
  const IDX2 = indexCatalogue(KHO2)
  const none = new Map<string, IndexedMaterial>()

  it('bản vẽ ghi H, kho ghi I → vẫn khớp', () => {
    const r = matchAplMaterial('SS400', 'H-244X175X7X11', IDX2, none)
    expect(r.via).toBe('rule')
    expect(r.materialCode).toBe('VLC-I244-001')
  })

  it('bản vẽ ghi C, kho ghi U → vẫn khớp (cặp này nặng 178 tấn)', () => {
    const r = matchAplMaterial('SS400', 'C-200X80X7.5X11', IDX2, none)
    expect(r.via).toBe('rule')
    expect(r.materialCode).toBe('VLC.U200.007')
  })

  it('KHÔNG gộp bừa: L không phải cùng nhóm với H/I', () => {
    expect(shapeFamily('H')).toBe(shapeFamily('I'))
    expect(shapeFamily('C')).toBe(shapeFamily('U'))
    expect(shapeFamily('L')).not.toBe(shapeFamily('H'))
    expect(shapeFamily('PL')).toBe('PL')
  })
})

// ── Tầng lịch sử: học lại từ PR/BOM người đã gắn ──
describe('apl-material-match — kho tri thức lịch sử', () => {
  const KHO3: CatalogueItem[] = [
    { id: 'o1', materialCode: 'VLC-O048-300', name: 'Ống thép đen phi 48.3 dày 3.6', grade: 'A53GRB', specification: null },
    { id: 'x1', materialCode: 'VLC-X999', name: 'Vật tư khác', grade: null, specification: null },
  ]
  const IDX3 = indexCatalogue(KHO3)
  const none = new Map<string, IndexedMaterial>()
  // PR cũ: người đã gắn CHS48.3*3.6 với mã ống
  const hist = buildHistoryIndex([{ profile: 'CHS48.3*3.6', grade: 'A53GRB', materialId: 'o1' }])

  it('luật bó tay (tên kho không có ký hiệu) nhưng lịch sử cứu được', () => {
    expect(matchAplMaterial('A53GRB', 'CHS48.3*3.6', IDX3, none).via).toBeNull()
    const r = matchAplMaterial('A53GRB', 'CHS48.3*3.6', IDX3, none, hist)
    expect(r.via).toBe('history')
    expect(r.materialCode).toBe('VLC-O048-300')
  })

  it('lịch sử ứng NHIỀU mã thì không đoán bừa', () => {
    const amb = buildHistoryIndex([
      { profile: 'CHS60.3*5.5', grade: 'A53GRB', materialId: 'o1' },
      { profile: 'CHS60.3*5.5', grade: 'A53GRB', materialId: 'x1' },
    ])
    expect(matchAplMaterial('A53GRB', 'CHS60.3*5.5', IDX3, none, amb).via).toBeNull()
  })

  it('lịch sử KHÔNG đè lên luật — chỉ chạy khi luật không tra được', () => {
    const kho: CatalogueItem[] = [{ id: 'p1', materialCode: 'NL.VT08', name: 'Thép tấm 10', grade: null, specification: null }]
    const idx = indexCatalogue(kho)
    const h = buildHistoryIndex([{ profile: 'PL10', grade: 'SS400', materialId: 'zzz' }])
    const r = matchAplMaterial('SS400', 'PL10', idx, none, h)
    expect(r.via).toBe('rule')
    expect(r.materialCode).toBe('NL.VT08')
  })
})
