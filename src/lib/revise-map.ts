// Revise Flow36 — bản đồ A4 (loại revise → bước vào). CHỐT Toan 2026-07-22, verify DB SX-PROD 12/12.
// Nguồn: SPEC_Revise_Flow36 mục A4. MVP lưu config-const (đổi map phải deploy — chấp nhận ở MVP).

export type ReviseMode = 'artifact' | 'process'

export interface ReviseTypeDef {
  entryStepCode: string   // bước vào (đã verify ∈ template SX-PROD)
  ownerRole: string       // phòng khởi tạo revise
  label: string
  mode: ReviseMode        // artifact = nối BomVersion/ECO (approveRevision); process = fork trực tiếp
}

export const REVISE_TYPE_MAP = {
  REV_DESIGN:          { entryStepCode: 'P2.1',  ownerRole: 'R04', label: 'Bản vẽ / VT chính',              mode: 'artifact' },
  REV_WELDPAINT:       { entryStepCode: 'P2.2',  ownerRole: 'R02', label: 'VT hàn / sơn',                   mode: 'process'  },
  REV_CONSUMABLE:      { entryStepCode: 'P2.3',  ownerRole: 'R05', label: 'VT tiêu hao',                    mode: 'process'  },
  REV_ESTIMATE_NEW:    { entryStepCode: 'P1.2',  ownerRole: 'R03', label: 'Dự toán — làm lại từ đầu',       mode: 'process'  },
  REV_ESTIMATE_ADJ:    { entryStepCode: 'P2.4',  ownerRole: 'R03', label: 'Dự toán — điều chỉnh',           mode: 'process'  },
  REV_WBS:             { entryStepCode: 'P1.2A', ownerRole: 'R02', label: 'Kế hoạch / WBS',                 mode: 'process'  },
  REV_CASHFLOW:        { entryStepCode: 'P2.1A', ownerRole: 'R08', label: 'Kế hoạch dòng tiền',             mode: 'process'  },
  REV_QUOTE:           { entryStepCode: 'P3.5',  ownerRole: 'R07', label: 'Giá / nhà cung cấp',             mode: 'process'  },
  REV_PRODPLAN:        { entryStepCode: 'P3.4',  ownerRole: 'R06', label: 'Phương án SX (tổng thể)',        mode: 'process'  },
  REV_PROD_INPROGRESS: { entryStepCode: 'P5.1',  ownerRole: 'R06', label: 'Điều chỉnh khi đang chế tạo',    mode: 'process'  },
  REV_QC_MATERIAL:     { entryStepCode: 'P4.3',  ownerRole: 'R09', label: 'QC vật tư',                      mode: 'process'  },
  REV_QC_FAB:          { entryStepCode: 'P5.3',  ownerRole: 'R09', label: 'Nghiệm thu chế tạo',             mode: 'process'  },
} as const satisfies Record<string, ReviseTypeDef>

export type ReviseType = keyof typeof REVISE_TYPE_MAP

export function getReviseTypeDef(type: string): ReviseTypeDef | null {
  return (REVISE_TYPE_MAP as Record<string, ReviseTypeDef>)[type] ?? null
}
