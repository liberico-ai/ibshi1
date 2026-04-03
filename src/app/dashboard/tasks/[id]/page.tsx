'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch, useAuthStore } from '@/hooks/useAuth'
import { getStepFormConfig, type FormField } from '@/lib/step-form-configs'
import { WORKFLOW_RULES, PHASE_LABELS } from '@/lib/workflow-constants'
import * as XLSX from 'xlsx'
import MultiFileUpload from '@/components/MultiFileUpload'
import type { TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, MomItem, MomSection, MomAttendant, SupplierQuote, SupplierEntry, PrevStepFile, WbsRow } from '@/lib/types'

// ── Number formatting helpers ──
const formatNumberWithCommas = (val: string | number): string => {
  if (val === "" || val === null || val === undefined) return "";
  const str = String(val).replace(/,/g, "");
  if (str === "-" || str === ".") return str;
  const num = parseFloat(str);
  if (isNaN(num)) return String(val);
  const parts = str.split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
};
const unformatNumber = (val: string): string => String(val).replace(/,/g, "");

interface TaskData {
  id: string
  projectId: string
  stepCode: string
  stepName: string
  status: string
  assignedRole: string
  notes: string | null
  resultData: Record<string, unknown> | null
  deadline: string | null
  startedAt: string | null
  completedAt: string | null
  project: {
    projectCode: string; projectName: string; clientName: string;
    productType?: string; contractValue?: string | number; currency?: string;
    startDate?: string; endDate?: string; description?: string;
  }
  assignee: { id: string; fullName: string; username: string } | null
}

function WbsTableUI({ isWbsEditable, wbsItemsData, onChange, mode, onIssueLSX, onRequestMaterial, lsxStatus, cellAssignments, onAssign, lsxIssuedDetails, onIssueSingleTeam, materialRequests, onUpdateMaterials, onRequestIssue, onSave }: { isWbsEditable: boolean; wbsItemsData: any; onChange?: (val: string) => void; mode?: 'default' | 'lsx'; onIssueLSX?: (rowIndex: number, row: Record<string, string>) => void; onRequestMaterial?: (rowIndex: number, row: Record<string, string>) => void; lsxStatus?: Record<number, { lsx?: boolean; vt?: boolean }>; cellAssignments?: CellAssignMap; onAssign?: (rowIdx: number, colKey: string, assigns: TeamAssign[]) => void; lsxIssuedDetails?: LsxIssuedMap; onIssueSingleTeam?: (rowIdx: number, colKey: string, teamIdx: number) => void; materialRequests?: MaterialReqMap; onUpdateMaterials?: (rowIdx: number, stageKey: string, teamIdx: number, items: MaterialReqItem[]) => void; onRequestIssue?: (rowIdx: number, stageKey: string, teamIdx: number, matIdx: number, material: MaterialReqItem) => Promise<void>; onSave?: () => void }) {
  const emptyRow = (): WbsRow => ({ stt: '', hangMuc: '', dvt: 'kg', khoiLuong: '', phamVi: 'IBS', thauPhu: '', batDau: '', ketThuc: '', trangThai: '', cutting: '', machining: '', fitup: '', welding: '', tryAssembly: '', dismantle: '', blasting: '', painting: '', insulation: '', commissioning: '', packing: '', delivery: '', khuVuc: '', ghiChu: '' });

  let rows: WbsRow[] = [];
  try {
    const p = wbsItemsData ? (typeof wbsItemsData === 'string' ? JSON.parse(wbsItemsData) : wbsItemsData) : null;
    rows = (Array.isArray(p) && p.length > 0) ? p : [{ ...emptyRow(), stt: '1' }];
  } catch {
    rows = [{ ...emptyRow(), stt: '1' }];
  }
  
  const [wbsModalOpen, setWbsModalOpen] = useState(false);
  const [lsxConfirmRow, setLsxConfirmRow] = useState<{ idx: number; row: Record<string, string>; type: 'lsx' | 'vt' } | null>(null);

  const fmtDate = (d: string) => {
    if (!d) return '';
    // Convert yyyy-mm-dd or any date to mm/dd/yyyy
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`;
  };

  const [assignCell, setAssignCell] = useState<{ ri: number; col: string } | null>(null);
  const [tempAssigns, setTempAssigns] = useState<TeamAssign[]>([]);
  const [tempMaterials, setTempMaterials] = useState<MaterialReqItem[]>([]);
  const [dncRow, setDncRow] = useState<{ idx: number; row: Record<string, string>; stageKey: string; teamIdx: number; teamVolume: number } | null>(null);

  // Helper: get all materials for a row (aggregate from all stages/teams)
  const getAllMaterialsForRow = (ri: number): MaterialReqItem[] => {
    const rowData = materialRequests?.[ri];
    if (!rowData) return [];
    const all: MaterialReqItem[] = [];
    Object.values(rowData).forEach(stageData => {
      Object.values(stageData).forEach(teamMats => {
        all.push(...teamMats.filter(m => m.requested));
      });
    });
    return all;
  };

  // Helper: get total material quantity for a specific team LSX
  const getTeamMaterialTotal = (ri: number, stageKey: string, teamIdx: number): number => {
    const mats = materialRequests?.[ri]?.[stageKey]?.[teamIdx] || [];
    return mats.reduce((s, m) => s + (Number(m.quantity) || 0), 0);
  };

  // Helper: check if a row (hạng mục) is fully complete
  // Complete = all active stages fully assigned (100% KL) + all teams have DNC VT
  const isRowComplete = (ri: number, row: Record<string, string>): boolean => {
    const totalKL = Number(row.khoiLuong) || 0;
    if (totalKL <= 0) return false;
    const activeStages = subCols.filter(c => (row[c.key] || '').trim() !== '');
    if (activeStages.length === 0) return false;
    for (const stage of activeStages) {
      const assigns = cellAssignments?.[ri]?.[stage.key] || [];
      if (assigns.length === 0) return false;
      const assignedVol = assigns.reduce((s, a) => s + (Number(a.volume) || 0), 0);
      if (assignedVol < totalKL) return false;
      for (let ti = 0; ti < assigns.length; ti++) {
        const teamMats = materialRequests?.[ri]?.[stage.key]?.[ti] || [];
        if (teamMats.length === 0) return false;
      }
    }
    return true;
  };

  const teamsByStage: Record<string, string[]> = {
    cutting: ['Tổ Cắt 1', 'Tổ Cắt 2', 'Tổ Cắt 3'],
    machining: ['Tổ GCCK 1', 'Tổ GCCK 2'],
    fitup: ['Tổ Gá 1', 'Tổ Gá 2', 'Tổ Gá 3'],
    welding: ['Tổ Hàn 1', 'Tổ Hàn 2', 'Tổ Hàn 3', 'Tổ Hàn 4'],
    tryAssembly: ['Tổ Tổ hợp 1', 'Tổ Tổ hợp 2'],
    dismantle: ['Tổ Tháo dỡ 1', 'Tổ Tháo dỡ 2'],
    blasting: ['Tổ Làm sạch 1', 'Tổ Làm sạch 2'],
    painting: ['Tổ Sơn 1', 'Tổ Sơn 2'],
    insulation: ['Tổ Bảo ôn 1'],
    commissioning: ['Tổ Chạy thử 1'],
    packing: ['Tổ Đóng kiện 1'],
    delivery: ['Tổ Giao hàng 1'],
  };

  const openAssignPanel = (ri: number, colKey: string) => {
    const existing = cellAssignments?.[ri]?.[colKey];
    setTempAssigns(existing && existing.length > 0 ? JSON.parse(JSON.stringify(existing)) : [{ teamName: '', volume: '', startDate: '', endDate: '' }]);
    setAssignCell({ ri, col: colKey });
  };

  const saveAssign = () => {
    if (assignCell) {
      const valid = tempAssigns.filter(a => a.teamName.trim());
      onAssign?.(assignCell.ri, assignCell.col, valid);
    }
    setAssignCell(null);
  };

  const save = (next: WbsRow[]) => {
    if (!isWbsEditable) return;
    if (onChange) onChange(JSON.stringify(next));
  };
  const addRow = () => save([...rows, { ...emptyRow(), stt: String(rows.length + 1) }]);
  const removeRow = (i: number) => save(rows.filter((_, idx) => idx !== i));
  const update = (i: number, key: string, val: string) => { const n = [...rows]; n[i] = { ...n[i], [key]: val }; save(n); };

  // Base keys handled separately in table layout
  const baseKeys = new Set(['stt', 'hangMuc', 'dvt', 'khoiLuong', 'phamVi', 'thauPhu', 'batDau', 'ketThuc', 'khuVuc', 'ghiChu', 'trangThai']);
  // Default sub-columns (shown when no extra keys exist in data)
  const defaultSubCols = [
    { key: 'cutting', label: 'Cắt' }, { key: 'machining', label: 'GCCK' },
    { key: 'fitup', label: 'Gá' }, { key: 'welding', label: 'Hàn' },
    { key: 'tryAssembly', label: 'Tổ hợp' }, { key: 'dismantle', label: 'Tháo dỡ' },
    { key: 'blasting', label: 'Làm sạch' }, { key: 'painting', label: 'Sơn' },
    { key: 'insulation', label: 'Bảo ôn' }, { key: 'commissioning', label: 'Chạy thử' },
    { key: 'packing', label: 'Đóng kiện' }, { key: 'delivery', label: 'Giao hàng' },
  ];
  // Derive sub-columns dynamically from actual data keys
  const dataExtraKeys = new Set<string>();
  rows.forEach(r => Object.keys(r).forEach(k => { if (!baseKeys.has(k) && r[k]) dataExtraKeys.add(k); }));
  // Preferred column order + label map
  const colOrderList = ['cutting', 'machining', 'fitup', 'welding', 'tryAssembly', 'dismantle', 'blasting', 'painting', 'galvanize', 'insulation', 'commissioning', 'khungKien', 'packing', 'delivery'];
  const labelMap: Record<string, string> = { cutting: 'Cắt', machining: 'GCCK', fitup: 'Gá', welding: 'Hàn', tryAssembly: 'Tổ hợp', dismantle: 'Tháo dỡ', blasting: 'Làm sạch', painting: 'Sơn', galvanize: 'Mạ', insulation: 'Bảo ôn', commissioning: 'Chạy thử', packing: 'Đóng kiện', delivery: 'Giao hàng', shippingFrame: 'Shipping', khungKien: 'Khung kiện' };
  const subCols = dataExtraKeys.size > 0
    ? Array.from(dataExtraKeys)
        .sort((a, b) => {
          const ia = colOrderList.indexOf(a); const ib = colOrderList.indexOf(b);
          if (ia >= 0 && ib >= 0) return ia - ib;
          if (ia >= 0) return -1; if (ib >= 0) return 1;
          return a.localeCompare(b);
        })
        .map(k => ({ key: k, label: labelMap[k] || k }))
    : defaultSubCols;
  
  const exportExcel = () => {
    const headers = ['STT', 'Tên hạng mục', 'ĐVT', 'Khối lượng', 'Phạm vi', 'Thầu phụ', 'Bắt đầu', 'Kết thúc', 'Trạng thái', ...subCols.map(c => c.label), 'Khu vực TC', 'Ghi chú'];
    const data = rows.map(r => [
      r.stt, r.hangMuc, r.dvt, r.khoiLuong, r.phamVi, r.thauPhu, r.batDau, r.ketThuc, r.trangThai,
      ...subCols.map(c => r[c.key] || ''), r.khuVuc, r.ghiChu
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [{ wch: 5 }, { wch: 35 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, ...subCols.map(() => ({ wch: 10 })), { wch: 15 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'WBS');
    XLSX.writeFile(wb, `WBS_export.xlsx`);
  };

  const importExcel = () => {
    if (!isWbsEditable) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt: any) => {
        try {
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' });
          if (jsonData.length < 2) return;

          let headerRowIndex = -1;
          for (let r = 0; r < Math.min(jsonData.length, 20); r++) {
            const rowStr = (jsonData[r] || []).map(String).join(' ').toLowerCase();
            if (rowStr.includes('stt') || rowStr.includes('hạng mục') || rowStr.includes('tiến độ') || rowStr.includes('khối lượng') || rowStr.includes('công trình')) {
              headerRowIndex = r;
              break;
            }
          }
          if (headerRowIndex === -1) headerRowIndex = 0;

          const maxCols = Math.max(...jsonData.slice(headerRowIndex, headerRowIndex + 3).map(r => (r || []).length));
          const headerRow = Array(maxCols).fill('');
          for (let r = headerRowIndex; r < Math.min(jsonData.length, headerRowIndex + 3); r++) {
            for (let c = 0; c < (jsonData[r] || []).length; c++) {
              if (jsonData[r][c]) {
                headerRow[c] = (headerRow[c] + ' ' + String(jsonData[r][c]).trim().toLowerCase()).trim();
              }
            }
          }

          const findColIndex = (keywords: string[]) => {
            return headerRow.findIndex(h => keywords.some(kw => h.includes(kw)));
          };

          // Known column mappings: keywords → key name (ORDER matters for display)
          const knownCols: [string, string[]][] = [
            ['stt', ['stt', 'no.', 'số tt']],
            ['hangMuc', ['hạng mục', 'công trình', 'description', 'tên']],
            ['dvt', ['đvt', 'unit']],
            ['khoiLuong', ['khối lượng', 'volume']],
            ['phamVi', ['ibs hi', 'phạm vi', 'scope']],
            ['thauPhu', ['thầu phụ', 'sub-contractor']],
            ['batDau', ['bắt đầu', 'start']],
            ['ketThuc', ['kết thúc', 'finish']],
            ['trangThai', ['shipping frame', 'trạng thái', 'status']],
            ['cutting', ['cắt', 'cutting']],
            ['machining', ['gcck', 'machining']],
            ['fitup', ['gá', 'fitup']],
            ['welding', ['hàn', 'welding']],
            ['tryAssembly', ['tổ hợp', 'try-assembly']],
            ['dismantle', ['tháo dỡ', 'dismantle']],
            ['blasting', ['làm sạch', 'blasting']],
            ['painting', ['sơn', 'painting']],
            ['galvanize', ['mạ', 'galvanize']],
            ['insulation', ['bảo ôn', 'insulation']],
            ['commissioning', ['chạy thử', 'commissioning']],
            ['khungKien', ['chế tạo khung kiện', 'khung kiện']],
            ['packing', ['đóng kiện', 'packing']],
            ['delivery', ['giao hàng', 'delivery']],
            ['khuVuc', ['khu vực', 'area']],
            ['ghiChu', ['ghi chú', 'remark']],
          ];

          // Build colIndices from known mappings (first match wins per column)
          const colIndices: Record<string, number> = {};
          const mappedCols = new Set<number>();
          knownCols.forEach(([key, keywords]) => {
            const idx = headerRow.findIndex((h, i) => !mappedCols.has(i) && keywords.some(kw => h.includes(kw)));
            if (idx >= 0) { colIndices[key] = idx; mappedCols.add(idx); }
          });

          // Auto-detect unmapped columns → use sanitized header as key
          headerRow.forEach((h, colIdx) => {
            if (!h || mappedCols.has(colIdx)) return;
            // Skip the first column (often row-group label, not useful)
            if (colIdx === 0) return;
            // Create a camelCase key from header text
            const clean = h.replace(/[^a-zA-Zàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ0-9\s]/gi, '').trim();
            if (!clean) return;
            const key = 'x_' + clean.substring(0, 30).replace(/\s+/g, '_');
            colIndices[key] = colIdx;
          });

          const imported: WbsRow[] = [];
          for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
            const rowData = jsonData[i];
            if (!rowData || rowData.length === 0) continue;
            
            const sttVal = colIndices.stt >= 0 && rowData[colIndices.stt] != null ? String(rowData[colIndices.stt]).trim() : '';
            const hangMucVal = colIndices.hangMuc >= 0 && rowData[colIndices.hangMuc] != null ? String(rowData[colIndices.hangMuc]).trim() : '';
            
            if (!hangMucVal && !sttVal) continue;

            // Only include rows that have a numeric KL (weight/quantity) value
            const klRaw = colIndices.khoiLuong >= 0 ? rowData[colIndices.khoiLuong] : null;
            const klNum = Number(klRaw);
            if (!klRaw || isNaN(klNum) || klNum <= 0) continue;

            const sttLower = sttVal.toLowerCase();
            const hangMucLower = hangMucVal.toLowerCase();

            if (sttLower === '(a)' || sttLower === 'stt' || sttLower.includes('sub-contractor') || sttLower === '(i-1)' || sttLower.includes('d-')) continue;
            if (hangMucLower.includes('dự kiến nhà máy') || hangMucLower.includes('dự kiến') || hangMucLower.includes('ghi chú') || hangMucLower.includes('bcth-ibshi-qlda-01') || hangMucLower.includes('kế hoạch tổng thể')) continue;
            if (hangMucLower === 'tổng nhân lực cần cho các dự án') continue;
            if (hangMucLower.includes('người lập') || hangMucLower.includes('prepared by') || hangMucLower.includes('approved by') || hangMucLower.includes('người duyệt')) continue;

            const newRow = emptyRow();
            const dateKeys = new Set(['batDau', 'ketThuc']);
            Object.keys(colIndices).forEach(key => {
              const idx = colIndices[key];
              if (idx >= 0 && rowData[idx] !== undefined && rowData[idx] !== null && rowData[idx] !== '') {
                let val = rowData[idx];
                // Convert Excel serial dates to YYYY-MM-DD for HTML date inputs
                if (dateKeys.has(key) && typeof val === 'number' && val > 40000 && val < 60000) {
                  const d = new Date((val - 25569) * 86400000);
                  val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                }
                newRow[key] = String(val).trim();
              }
            });
            
            if (!newRow.stt) newRow.stt = String(imported.length + 1);
            if (newRow.phamVi === '' && newRow.thauPhu !== '') {
               newRow.phamVi = 'TP';
            }

            imported.push(newRow);
          }
          // Remove summary/total row: if first row's KL ≈ sum of remaining rows, it's a parent
          if (imported.length > 2) {
            const firstKL = Number(imported[0].khoiLuong) || 0;
            const restKL = imported.slice(1).reduce((s, r) => s + (Number(r.khoiLuong) || 0), 0);
            if (firstKL > 0 && restKL > 0 && Math.abs(firstKL - restKL) / firstKL < 0.05) {
              imported.shift();
            }
          }
          if (imported.length > 0) {
            save(imported);
          } else {
            alert('Không có dữ liệu hợp lệ trong file!');
          }
        } catch(err) {
          console.error(err);
          alert('Lỗi đọc file Excel!');
        }
      };
      reader.readAsBinaryString(file);
    };
    input.click();
  };

  // Calculate total KL, excluding summary rows whose KL = sum of remaining rows
  let totalKL = rows.reduce((s, r) => s + (Number(r.khoiLuong) || 0), 0);
  if (rows.length > 2) {
    const firstKL = Number(rows[0].khoiLuong) || 0;
    const restKL = rows.slice(1).reduce((s, r) => s + (Number(r.khoiLuong) || 0), 0);
    if (firstKL > 0 && restKL > 0 && Math.abs(firstKL - restKL) / firstKL < 0.05) {
      totalKL = restKL;
    }
  }
  const doneCount = rows.filter(r => (r.trangThai || '').toLowerCase().includes('done')).length;
  const ongoingCount = rows.filter(r => (r.trangThai || '').toLowerCase().includes('ongoing')).length;

  const thS: React.CSSProperties = { padding: '6px 8px', fontSize: '0.68rem', fontWeight: 700, color: '#1e3a5f', whiteSpace: 'nowrap', borderBottom: '2px solid #c2d9e3', borderRight: '1px solid #d5e5ee', background: '#dceef5', textAlign: 'center', position: 'sticky', top: 0, zIndex: 3 };
  const thS2: React.CSSProperties = { ...thS, top: 34 };
  const tdS: React.CSSProperties = { padding: '3px 4px', borderBottom: '1px solid var(--border)', borderRight: '1px solid #eee', fontSize: '0.72rem', verticalAlign: 'middle' };
  const inputS: React.CSSProperties = { fontSize: '0.72rem', padding: '3px 5px', width: '100%', border: '1px solid #e2e8f0', borderRadius: 4, background: isWbsEditable ? '#fff' : '#f8fafc', boxSizing: 'border-box' };
  const frozenBg = '#f8fafc';

  return (
    <div style={{ width: '100%' }}>
      <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid #0ea5e9' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#0ea5e9' }}>📋 Bảng kế hoạch tổng thể triển khai (WBS)</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Biểu mẫu BCTH-IBSHI-QLDA-095</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {mode === 'lsx' && onSave && <button type="button" onClick={onSave} style={{ padding: '5px 12px', fontSize: '0.75rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>💾 Lưu</button>}
            <button type="button" onClick={exportExcel} style={{ padding: '5px 12px', fontSize: '0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>📤 Export</button>
            {isWbsEditable && <button type="button" onClick={importExcel} style={{ padding: '5px 12px', fontSize: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>📥 Import</button>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0ea5e9' }}>{rows.length}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Hạng mục</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{totalKL > 1000 ? `${(totalKL / 1000).toFixed(1)}t` : `${totalKL.toLocaleString('vi-VN')}`}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tổng KL (kg)</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#16a34a' }}>{doneCount}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Done</div>
          </div>
          {ongoingCount > 0 && <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f59e0b' }}>{ongoingCount}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Ongoing</div>
          </div>}
        </div>
        {mode === 'lsx' && (
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', alignItems: 'center', padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Chú thích:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: '#fef3c7', border: '2px solid #fde68a' }}></span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Chưa phân giao</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: '#dbeafe', border: '2px solid #2563eb' }}></span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Chưa phân giao đủ KL</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: '#d1fae5', border: '2px solid #16a34a' }}></span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Đã phân giao đủ KL</span>
            </div>
          </div>
        )}
        <button type="button" onClick={() => setWbsModalOpen(true)} style={{ marginTop: 16, padding: '10px 20px', width: '100%', fontSize: '0.9rem', fontWeight: 700, background: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', letterSpacing: '0.3px' }}>
          {isWbsEditable ? '📋 Xem & Sửa chi tiết' : '📋 XEM'}
        </button>
      </div>

      {wbsModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setWbsModalOpen(false); }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '12px 20px', borderBottom: '2px solid #0ea5e9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#f0f9ff' }}>
              <div><h2 style={{ margin: 0, fontSize: '1.05rem', color: '#0c4a6e' }}>📋 WBS</h2><span style={{ fontSize: '0.72rem', color: '#64748b' }}>{rows.length} hạng mục</span></div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {isWbsEditable && <button type="button" onClick={addRow} style={{ padding: '5px 14px', fontSize: '0.75rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>+ Thêm</button>}
                <button type="button" onClick={exportExcel} style={{ padding: '5px 14px', fontSize: '0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>📤 Export</button>
                {isWbsEditable && <button type="button" onClick={importExcel} style={{ padding: '5px 14px', fontSize: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>📥 Import</button>}
                <button type="button" onClick={() => setWbsModalOpen(false)} style={{ padding: '5px 14px', fontSize: '0.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>✕ Đóng</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 700 + subCols.length * 80 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...thS, position: 'sticky', left: 0, zIndex: 5, width: 40, background: '#c7e2ef' }}>STT</th>
                    <th rowSpan={2} style={{ ...thS, position: 'sticky', left: 40, zIndex: 5, width: 220, background: '#c7e2ef', textAlign: 'left' }}>TÊN HẠNG MỤC</th>
                    <th rowSpan={2} style={{ ...thS, width: 50 }}>ĐVT</th>
                    <th rowSpan={2} style={{ ...thS, width: 80 }}>KL</th>
                    <th colSpan={2} style={{ ...thS, background: '#d0e8d0' }}>PHẠM VI</th>
                    <th colSpan={2} style={{ ...thS, background: '#e8ddd0' }}>TIẾN ĐỘ</th>
                    <th colSpan={subCols.length} style={{ ...thS, background: '#fde7e7' }}>CHI TIẾT</th>
                    <th rowSpan={2} style={{ ...thS, width: 100 }}>KHU VỰC</th>
                    <th rowSpan={2} style={{ ...thS, width: 120 }}>GHI CHÚ</th>
                    <th rowSpan={2} style={{ ...thS, width: 70 }}>TT</th>
                    {mode === 'lsx' && <th rowSpan={2} style={{ ...thS, width: 180, background: '#fef3c7' }}>HÀNH ĐỘNG</th>}
                    {isWbsEditable && <th rowSpan={2} style={{ ...thS, width: 32 }}></th>}
                  </tr>
                  <tr>
                    <th style={{ ...thS2, background: '#d0e8d0', width: 55 }}>IBS</th>
                    <th style={{ ...thS2, background: '#d0e8d0', width: 90 }}>TP</th>
                    <th style={{ ...thS2, background: '#e8ddd0', width: 90 }}>Bắt đầu</th>
                    <th style={{ ...thS2, background: '#e8ddd0', width: 90 }}>Kết thúc</th>
                    {subCols.map(c => <th key={c.key} style={{ ...thS2, background: '#fde7e7', width: 70 }}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => {
                    const rowComplete = mode === 'lsx' && isRowComplete(ri, row);
                    return (
                    <tr key={ri} style={{ background: rowComplete ? '#dcfce7' : ri % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ ...tdS, position: 'sticky', left: 0, zIndex: 2, background: rowComplete ? '#bbf7d0' : ri % 2 === 0 ? frozenBg : '#eef4f8', textAlign: 'center' }}><input className="input" value={row.stt || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'stt', e.target.value)} style={{ ...inputS, width: 32, textAlign: 'center' }} /></td>
                      <td style={{ ...tdS, position: 'sticky', left: 40, zIndex: 2, background: rowComplete ? '#bbf7d0' : ri % 2 === 0 ? frozenBg : '#eef4f8' }}><input className="input" value={row.hangMuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'hangMuc', e.target.value)} placeholder="Tên" style={{ ...inputS, fontWeight: 500 }} /></td>
                      <td style={tdS}><input className="input" value={row.dvt || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'dvt', e.target.value)} style={{ ...inputS, width: 50 }} /></td>
                      <td style={tdS}><input type="number" className="input" value={row.khoiLuong || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'khoiLuong', e.target.value)} style={{ ...inputS, textAlign: 'right' }} /></td>
                      <td style={tdS}><input className="input" value={row.phamVi || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'phamVi', e.target.value)} style={inputS} /></td>
                      <td style={tdS}><input className="input" value={row.thauPhu || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'thauPhu', e.target.value)} style={inputS} /></td>
                      <td style={tdS}>{!isWbsEditable && row.batDau ? <span style={{ fontSize: '0.72rem', padding: '3px 5px' }}>{fmtDate(row.batDau)}</span> : <input type="date" className="input" value={row.batDau || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'batDau', e.target.value)} style={inputS} />}</td>
                      <td style={tdS}>{!isWbsEditable && row.ketThuc ? <span style={{ fontSize: '0.72rem', padding: '3px 5px' }}>{fmtDate(row.ketThuc)}</span> : <input type="date" className="input" value={row.ketThuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'ketThuc', e.target.value)} style={inputS} />}</td>
                      {subCols.map(c => {
                        const cellVal = row[c.key] || '';
                        const assigns = cellAssignments?.[ri]?.[c.key] || [];
                        const assignCount = assigns.length;
                        const totalKL = Number(row.khoiLuong) || 0;
                        const assignedKL = assigns.reduce((s, a) => s + (Number(a.volume) || 0), 0);
                        if (mode === 'lsx' && cellVal) {
                          // 3 states: full (green), partial (blue), none (yellow)
                          const isFull = assignCount > 0 && assignedKL >= totalKL;
                          const isPartial = assignCount > 0 && assignedKL < totalKL;
                          const borderColor = isFull ? '#16a34a' : isPartial ? '#2563eb' : '#fde68a';
                          const bgColor = isFull ? '#d1fae5' : isPartial ? '#dbeafe' : '#fef3c7';
                          const badgeColor = isFull ? '#16a34a' : '#2563eb';
                          const tooltipText = isFull
                            ? `✅ Đã phân giao đủ (${assignedKL.toLocaleString('vi-VN')}/${totalKL.toLocaleString('vi-VN')} ${row.dvt || 'kg'} • ${assignCount} tổ)`
                            : isPartial
                            ? `⏳ Chưa phân giao đủ (${assignedKL.toLocaleString('vi-VN')}/${totalKL.toLocaleString('vi-VN')} ${row.dvt || 'kg'} • còn ${(totalKL - assignedKL).toLocaleString('vi-VN')})`
                            : '📋 Chưa phân giao — Click để phân giao tổ';
                          return (
                            <td key={c.key} style={tdS}>
                              <button type="button" onClick={() => openAssignPanel(ri, c.key)}
                                title={tooltipText}
                                style={{ ...inputS, cursor: 'pointer', border: `2px solid ${borderColor}`, background: bgColor, fontWeight: 600, textAlign: 'center', borderRadius: 5, position: 'relative' }}>
                                {cellVal}
                                {assignCount > 0 && <span style={{ position: 'absolute', top: -6, right: -6, background: badgeColor, color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{assignCount}</span>}
                              </button>
                            </td>
                          );
                        }
                        return <td key={c.key} style={tdS}><input className="input" value={cellVal} disabled={!isWbsEditable} onChange={e => update(ri, c.key, e.target.value)} style={inputS} /></td>;
                      })}
                      <td style={tdS}><input className="input" value={row.khuVuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'khuVuc', e.target.value)} style={inputS} /></td>
                      <td style={tdS}><input className="input" value={row.ghiChu || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'ghiChu', e.target.value)} style={inputS} /></td>
                      <td style={tdS}><input className="input" value={row.trangThai || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'trangThai', e.target.value)} style={{ ...inputS, background: (row.trangThai||'').toLowerCase().includes('done')?'#d1fae5':'#fff' }} /></td>
                      {mode === 'lsx' && (
                        <td style={{ ...tdS, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button type="button" onClick={() => setLsxConfirmRow({ idx: ri, row, type: 'lsx' })}
                              disabled={lsxStatus?.[ri]?.lsx}
                              style={{ padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 5, border: 'none', cursor: lsxStatus?.[ri]?.lsx ? 'default' : 'pointer', background: lsxStatus?.[ri]?.lsx ? '#d1fae5' : '#f59e0b', color: lsxStatus?.[ri]?.lsx ? '#16a34a' : '#fff', opacity: lsxStatus?.[ri]?.lsx ? 0.8 : 1 }}>
                              {lsxStatus?.[ri]?.lsx ? '✅ Đã LSX' : '📋 LSX'}
                            </button>
                            {(() => {
                              const allMats = getAllMaterialsForRow(ri);
                              const hasMats = allMats.length > 0;
                              return (
                                <button type="button" onClick={() => setLsxConfirmRow({ idx: ri, row, type: 'vt' })}
                                  style={{ padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 5, border: 'none', cursor: 'pointer', background: hasMats ? '#d1fae5' : '#8b5cf6', color: hasMats ? '#16a34a' : '#fff', opacity: 1, position: 'relative' }}>
                                  {hasMats ? '✅ Vật tư' : '📦 Vật tư'}
                                  {hasMats && <span style={{ position: 'absolute', top: -6, right: -6, background: '#16a34a', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{allMats.length}</span>}
                                </button>
                              );
                            })()}
                          </div>
                        </td>
                      )}
                      {isWbsEditable && <td style={tdS}><button type="button" onClick={() => removeRow(ri)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>×</button></td>}
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {lsxConfirmRow && (() => {
        const { idx, row, type } = lsxConfirmRow;
        if (type === 'lsx') {
          // LSX modal: show all assignments grouped by stage with individual issue buttons
          const rowAssigns = cellAssignments?.[idx] || {};
          const activeStages = subCols.filter(c => row[c.key] && rowAssigns[c.key]?.length);
          const totalTeams = activeStages.reduce((s, c) => s + (rowAssigns[c.key]?.length || 0), 0);
          const issuedCount = activeStages.reduce((s, c) => s + (rowAssigns[c.key] || []).filter((_, ti) => lsxIssuedDetails?.[idx]?.[c.key]?.[ti]).length, 0);
          const totalKL = Number(row.khoiLuong) || 0;
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '32px 24px', overflowY: 'auto' }} onClick={() => setLsxConfirmRow(null)}>
              <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 900, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>📋 LỆNH SẢN XUẤT</div>
                    <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem' }}>{row.stt}. {row.hangMuc || 'Hạng mục'}</h3>
                    <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.9 }}>
                      KL: <strong>{totalKL.toLocaleString('vi-VN')} {row.dvt || 'kg'}</strong>
                      {' • '}{fmtDate(row.batDau)} — {fmtDate(row.ketThuc)}
                      {' • '}{row.phamVi}{row.thauPhu ? ` • ${row.thauPhu}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{issuedCount}/{totalTeams}</div>
                    <div style={{ fontSize: '0.72rem' }}>đã phát hành</div>
                  </div>
                </div>
                {/* Assignment list grouped by stage */}
                <div style={{ padding: '16px 24px', maxHeight: '60vh', overflowY: 'auto' }}>
                  {activeStages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '2rem', marginBottom: 8 }}>💭</div>
                      <div style={{ fontSize: '0.95rem' }}>Chưa có phân giao nào cho hạng mục này.</div>
                      <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Hãy click vào các ô IBS/TP trong cột Chi tiết để phân giao tổ trước.</div>
                    </div>
                  ) : activeStages.map(stage => {
                    const teams = rowAssigns[stage.key] || [];
                    return (
                      <div key={stage.key} style={{ marginBottom: 16 }}>
                        <div style={{ padding: '8px 12px', background: '#fef3c7', borderRadius: '8px 8px 0 0', borderBottom: '2px solid #f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400e' }}>🔧 {stage.label}</span>
                          <span style={{ fontSize: '0.75rem', color: '#b45309' }}>{teams.length} tổ</span>
                        </div>
                        {/* Table header */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 0.7fr 0.7fr 120px 100px', gap: 8, padding: '8px 12px 4px', background: '#fafafa' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tổ THỰC HIỆN</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>KHỐI LƯỢNG</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>TỪ NGÀY</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐẾN NGÀY</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>PHÁT HÀNH</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>DNC VẬT TƯ</span>
                        </div>
                        {/* Team rows */}
                        {teams.map((team, ti) => {
                          const issued = lsxIssuedDetails?.[idx]?.[stage.key]?.[ti] || false;
                          const teamVol = Number(team.volume || 0);
                          const teamMatTotal = getTeamMaterialTotal(idx, stage.key, ti);
                          const teamMatCount = (materialRequests?.[idx]?.[stage.key]?.[ti] || []).length;
                          const limitPct = 110;
                          const maxAllowed = teamVol * (limitPct / 100);
                          const atLimit = teamMatTotal >= maxAllowed && teamVol > 0;
                          const hasMats = teamMatCount > 0;
                          const canIssue = hasMats && !issued;
                          return (
                            <div key={ti} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 0.7fr 0.7fr 120px 100px', gap: 8, padding: '8px 12px', alignItems: 'center', background: ti % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{team.teamName || `Tổ ${ti + 1}`}</span>
                              <span style={{ fontWeight: 700, color: '#0ea5e9', fontSize: '0.88rem' }}>{teamVol.toLocaleString('vi-VN')} {row.dvt || 'kg'}</span>
                              <span style={{ fontSize: '0.82rem' }}>{fmtDate(team.startDate) || '—'}</span>
                              <span style={{ fontSize: '0.82rem' }}>{fmtDate(team.endDate) || '—'}</span>
                              <div style={{ textAlign: 'center' }}>
                                <button type="button" disabled={!canIssue}
                                  title={!hasMats ? 'Cần lập DNC Vật tư trước khi phát hành' : issued ? 'Đã phát hành' : 'Phát hành LSX'}
                                  onClick={() => onIssueSingleTeam?.(idx, stage.key, ti)}
                                  style={{ padding: '6px 16px', fontSize: '0.8rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: canIssue ? 'pointer' : 'default', background: issued ? '#d1fae5' : canIssue ? '#f59e0b' : '#e2e8f0', color: issued ? '#16a34a' : canIssue ? '#fff' : '#94a3b8', opacity: issued ? 0.9 : 1, transition: 'all 0.2s' }}>
                                  {issued ? '✅ Đã PH' : !hasMats ? '🔒 Phát hành' : '📤 Phát hành'}
                                </button>
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                <button type="button" disabled={atLimit}
                                  title={atLimit ? `Đã đạt ${limitPct}% KL (${teamMatTotal.toLocaleString('vi-VN')}/${maxAllowed.toLocaleString('vi-VN')})` : `DNC: ${teamMatTotal.toLocaleString('vi-VN')}/${maxAllowed.toLocaleString('vi-VN')} (${teamVol > 0 ? Math.round(teamMatTotal / teamVol * 100) : 0}%)`}
                                  onClick={() => {
                                    const existing = materialRequests?.[idx]?.[stage.key]?.[ti] || [];
                                    setTempMaterials(existing.length > 0 ? JSON.parse(JSON.stringify(existing)) : [{ name: '', code: '', spec: '', quantity: '', unit: 'kg' }]);
                                    setDncRow({ idx, row, stageKey: stage.key, teamIdx: ti, teamVolume: teamVol });
                                  }}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: atLimit ? 'default' : 'pointer', background: atLimit ? '#d1fae5' : hasMats ? '#0ea5e9' : '#64748b', color: atLimit ? '#16a34a' : '#fff', opacity: atLimit ? 0.9 : 1, transition: 'all 0.2s', position: 'relative' }}>
                                  {atLimit ? '✅ Đủ VT' : '📝 DNC VT'}
                                  {hasMats && !atLimit && <span style={{ position: 'absolute', top: -6, right: -6, background: '#0ea5e9', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{teamMatCount}</span>}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                {/* Footer */}
                <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: '#fafafa', borderRadius: '0 0 14px 14px' }}>
                  <button type="button" onClick={() => setLsxConfirmRow(null)}
                    style={{ padding: '10px 24px', fontSize: '0.9rem', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Đóng</button>
                </div>
              </div>
            </div>
          );
        }
        // VT modal — Material list per row
        const totalKL = Number(row.khoiLuong) || 0;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '32px 24px', overflowY: 'auto' }} onClick={() => setLsxConfirmRow(null)}>
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 850, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', color: '#fff' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>📦 VẬT TƯ HẠNG MỤC</div>
                <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem' }}>{row.stt}. {row.hangMuc || 'Hạng mục'}</h3>
                <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.9 }}>
                  KL: <strong>{totalKL.toLocaleString('vi-VN')} {row.dvt || 'kg'}</strong>
                  {' \u2022 '}{row.phamVi}{row.thauPhu ? ` \u2022 ${row.thauPhu}` : ''}
                </div>
              </div>
              {/* Material list — read only (aggregate all teams) */}
              {(() => {
                const allMats = getAllMaterialsForRow(idx);
                return (
                  <div style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: '1rem', color: '#6d28d9' }}>📋 Tổng hợp vật tư đã yêu cầu</h4>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{allMats.length} mục</span>
                    </div>
                    {allMats.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>📭</div>
                        <div style={{ fontSize: '0.9rem' }}>Chưa có DNC vật tư nào. Hãy lập DNC VT trong modal LSX trước.</div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 0.8fr 1fr 0.6fr 0.4fr', gap: 8, padding: '8px 10px', background: '#faf5ff', borderRadius: '6px 6px 0 0', borderBottom: '2px solid #8b5cf6' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>#</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>TÊN VẬT TƯ</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>MÃ VT</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>QUY CÁCH</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9', textAlign: 'right' }}>SỐ LƯỢNG</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6d28d9' }}>ĐVT</span>
                        </div>
                        {allMats.map((m, mi) => (
                          <div key={mi} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 0.8fr 1fr 0.6fr 0.4fr', gap: 8, padding: '8px 10px', alignItems: 'center', background: mi % 2 === 0 ? '#fff' : '#faf5ff', borderBottom: '1px solid #f3e8ff' }}>
                            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)' }}>{mi + 1}</span>
                            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{m.name || '—'}</span>
                            <span style={{ fontSize: '0.82rem', color: '#6d28d9', fontWeight: 600 }}>{m.code || '—'}</span>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{m.spec || '—'}</span>
                            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0ea5e9', textAlign: 'right' }}>{Number(m.quantity || 0).toLocaleString('vi-VN')}</span>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{m.unit}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}
              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: '#fafafa', borderRadius: '0 0 14px 14px' }}>
                <button type="button" onClick={() => setLsxConfirmRow(null)}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Đóng</button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* DNC Vật tư Modal — Editable (per team LSX) */}
      {dncRow && (() => {
        const { idx, row, stageKey, teamIdx, teamVolume } = dncRow;
        const filledCount = tempMaterials.filter(m => m.name.trim()).length;
        const tempTotal = tempMaterials.reduce((s, m) => s + (Number(m.quantity) || 0), 0);
        const maxAllowed = teamVolume * 1.1;
        const pctUsed = teamVolume > 0 ? Math.round(tempTotal / teamVolume * 100) : 0;
        const overLimit = tempTotal > maxAllowed;
        const stageLabel = subCols.find(c => c.key === stageKey)?.label || stageKey;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '32px 24px', overflowY: 'auto' }} onClick={() => setDncRow(null)}>
            <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 900, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: '16px 24px', borderBottom: '3px solid #0ea5e9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>📝 DNC Vật tư — {stageLabel}</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {row.hangMuc || `Hạng mục #${idx + 1}`} • KL tổ: {teamVolume.toLocaleString('vi-VN')} {row.dvt || 'kg'} • Giới hạn: {maxAllowed.toLocaleString('vi-VN')} (110%)
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: overLimit ? '#dc2626' : pctUsed > 100 ? '#f59e0b' : '#16a34a', background: overLimit ? '#fef2f2' : pctUsed > 100 ? '#fef3c7' : '#f0fdf4', padding: '4px 10px', borderRadius: 20 }}>
                    {tempTotal.toLocaleString('vi-VN')} / {maxAllowed.toLocaleString('vi-VN')} ({pctUsed}%)
                  </span>
                  <button type="button" onClick={() => setTempMaterials(prev => [...prev, { name: '', code: '', spec: '', quantity: '', unit: 'kg' }])}
                    style={{ padding: '7px 14px', fontSize: '0.85rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
                    + Thêm VT
                  </button>
                </div>
              </div>
              {/* Limit warning */}
              {overLimit && (
                <div style={{ padding: '10px 24px', background: '#fef2f2', borderBottom: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#dc2626', fontWeight: 600 }}>
                  ⚠️ Tổng vật tư vượt 110% khối lượng tổ. Vui lòng giảm số lượng.
                </div>
              )}
              {/* Table */}
              <div style={{ padding: '16px 24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '36px 1.5fr 0.7fr 0.7fr 0.6fr 0.4fr 100px 32px', gap: 6, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>#</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Tên VT *</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Mã VT *</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Quy chuẩn</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>Số lượng</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>ĐVT</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center' }}>ĐỀ NGHỊ CẤP</span>
                  <span></span>
                </div>
                {tempMaterials.map((m, mi) => (
                  <div key={mi} style={{ display: 'grid', gridTemplateColumns: '36px 1.5fr 0.7fr 0.7fr 0.6fr 0.4fr 100px 32px', gap: 6, padding: '8px 0', alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>{mi + 1}</span>
                    <input className="input" placeholder="Tên vật tư" value={m.name} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], name: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }} />
                    <input className="input" placeholder="Mã VT" value={m.code || ''} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], code: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }} />
                    <input className="input" placeholder="Quy chuẩn" value={m.spec} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], spec: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }} />
                    <input className="input" type="number" placeholder="0" value={m.quantity || ''} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], quantity: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, textAlign: 'right', opacity: m.requested ? 0.7 : 1 }} />
                    <select className="input" value={m.unit || ''} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], unit: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.8rem', padding: '8px 4px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }}>
                      <option value="kg">kg</option><option value="tấn">tấn</option><option value="m">m</option><option value="m2">m²</option><option value="cái">cái</option><option value="bộ">bộ</option><option value="lít">lít</option><option value="hộp">hộp</option><option value="cuộn">cuộn</option>
                    </select>
                    <div style={{ textAlign: 'center' }}>
                      {m.name.trim() && (m.code || '').trim() && Number(m.quantity) > 0 ? (
                        <button type="button" disabled={m.requested}
                          onClick={async () => {
                            const n = [...tempMaterials]; n[mi] = { ...n[mi], requested: true }; setTempMaterials(n);
                            await onRequestIssue?.(idx, stageKey, teamIdx, mi, m);
                          }}
                          style={{ padding: '4px 8px', fontSize: '0.72rem', fontWeight: 700, borderRadius: 5, border: 'none', cursor: m.requested ? 'default' : 'pointer', background: m.requested ? '#d1fae5' : '#f59e0b', color: m.requested ? '#16a34a' : '#fff', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
                          {m.requested ? '✅ Đã ĐNC' : '📋 Đề nghị cấp'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>—</span>
                      )}
                    </div>
                    <button type="button" onClick={() => setTempMaterials(prev => prev.filter((_, i) => i !== mi))} disabled={m.requested}
                      style={{ background: 'none', border: 'none', color: m.requested ? '#cbd5e1' : '#dc2626', cursor: m.requested ? 'default' : 'pointer', fontWeight: 700, fontSize: '1.1rem' }}>—</button>
                  </div>
                ))}
                <div style={{ marginTop: 10, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Đã nhập: <strong>{filledCount}</strong> / {tempMaterials.length} mục
                </div>
              </div>
              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fafafa', borderRadius: '0 0 14px 14px' }}>
                <button type="button" onClick={() => setDncRow(null)}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Hủy</button>
                <button type="button" disabled={overLimit || filledCount === 0}
                  onClick={() => {
                    const valid = tempMaterials.filter(m => m.name.trim());
                    onUpdateMaterials?.(idx, stageKey, teamIdx, valid);
                    setDncRow(null);
                  }}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: overLimit || filledCount === 0 ? '#e2e8f0' : '#16a34a', color: overLimit || filledCount === 0 ? '#94a3b8' : '#fff', border: 'none', borderRadius: 8, cursor: overLimit || filledCount === 0 ? 'default' : 'pointer', fontWeight: 700 }}>
                  💾 Lưu ({filledCount} mục)
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Assignment Panel (web-in-web) */}
      {assignCell && (() => {
        const row = rows[assignCell.ri];
        const stageCol = subCols.find(c => c.key === assignCell.col);
        const totalKL = Number(row.khoiLuong) || 0;
        const assignedKL = tempAssigns.reduce((s, a) => s + (Number(a.volume) || 0), 0);
        const remaining = totalKL - assignedKL;
        const teams = teamsByStage[assignCell.col] || [`Tổ ${stageCol?.label || ''} 1`];
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '40px 24px', overflowY: 'auto' }} onClick={() => setAssignCell(null)}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', color: '#fff' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 2 }}>PHÂN GIAO CÔNG ĐOẠN</div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>🔧 {stageCol?.label || assignCell.col}</h3>
              </div>
              {/* Row info reference */}
              <div style={{ padding: '16px 24px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '0.3fr 2fr 0.5fr 0.5fr 0.5fr', gap: 12, fontSize: '0.85rem' }}>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>STT</div><div style={{ fontWeight: 700 }}>{row.stt}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>HẠNG MỤC</div><div style={{ fontWeight: 700 }}>{row.hangMuc || '—'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>KHỐI LƯỢNG</div><div style={{ fontWeight: 700, color: '#0ea5e9' }}>{totalKL.toLocaleString('vi-VN')} {row.dvt || 'kg'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>BẮT ĐẦU</div><div style={{ fontWeight: 600 }}>{fmtDate(row.batDau) || '—'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>KẾT THÚC</div><div style={{ fontWeight: 600 }}>{fmtDate(row.ketThuc) || '—'}</div></div>
                </div>
              </div>
              {/* Assignment form */}
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: '#0c4a6e' }}>📋 Thực hiện phân giao</h4>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    Đã giao: <span style={{ color: assignedKL >= totalKL ? '#16a34a' : '#f59e0b', fontWeight: 800 }}>{assignedKL.toLocaleString('vi-VN')}</span> / {totalKL.toLocaleString('vi-VN')} {row.dvt || 'kg'}
                    {remaining > 0 && <span style={{ color: '#dc2626', marginLeft: 8, fontSize: '0.8rem' }}>Còn lại: {remaining.toLocaleString('vi-VN')}</span>}
                    {remaining < 0 && <span style={{ color: '#dc2626', marginLeft: 8, fontSize: '0.8rem' }}>⚠️ Vượt {Math.abs(remaining).toLocaleString('vi-VN')}</span>}
                  </div>
                </div>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.8fr 32px', gap: 10, marginBottom: 8, padding: '0 4px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tổ thực hiện</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>KL thực hiện ({row.dvt || 'kg'})</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Từ ngày</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Đến ngày</span>
                  <span></span>
                </div>
                {/* Team rows */}
                {tempAssigns.map((a, ai) => (
                  <div key={ai} style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 0.8fr 0.8fr 32px', gap: 10, marginBottom: 8, alignItems: 'center' }}>
                    <select className="input" value={a.teamName} onChange={e => { const n = [...tempAssigns]; n[ai] = { ...n[ai], teamName: e.target.value }; setTempAssigns(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px' }}>
                      <option value="">-- Chọn tổ --</option>
                      {teams.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input className="input" type="number" placeholder="0" value={a.volume}
                      onChange={e => { const n = [...tempAssigns]; n[ai] = { ...n[ai], volume: e.target.value }; setTempAssigns(n); }}
                      style={{ fontSize: '0.85rem', textAlign: 'right', padding: '8px 10px' }} />
                    <input className="input" type="date" value={a.startDate}
                      onChange={e => { const n = [...tempAssigns]; n[ai] = { ...n[ai], startDate: e.target.value }; setTempAssigns(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 6px' }} />
                    <input className="input" type="date" value={a.endDate}
                      onChange={e => { const n = [...tempAssigns]; n[ai] = { ...n[ai], endDate: e.target.value }; setTempAssigns(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 6px' }} />
                    <button type="button" onClick={() => setTempAssigns(prev => prev.filter((_, i) => i !== ai))}
                      style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700, fontSize: '1.1rem' }}>×</button>
                  </div>
                ))}
                {/* Add button — only show if remaining > 0 */}
                {remaining > 0 && (
                  <button type="button" onClick={() => setTempAssigns(prev => [...prev, { teamName: '', volume: String(remaining), startDate: '', endDate: '' }])}
                    style={{ marginTop: 4, padding: '8px 16px', fontSize: '0.85rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                    ➕ Thêm tổ ({remaining.toLocaleString('vi-VN')} {row.dvt || 'kg'} chưa giao)
                  </button>
                )}
                {remaining <= 0 && tempAssigns.length > 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#d1fae5', borderRadius: 8, fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                    ✅ Đã phân giao đủ khối lượng
                  </div>
                )}
              </div>
              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fafafa' }}>
                <button type="button" onClick={() => setAssignCell(null)}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Hủy</button>
                <button type="button" onClick={saveAssign}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                  💾 Lưu phân giao
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MOM Sections UI — BB họp triển khai dự án (Minutes of Meeting)
// ══════════════════════════════════════════════════════════════

const DEFAULT_SECTIONS: MomSection[] = [
  { key: 'I', title: 'Hợp đồng', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'II', title: 'Thiết kế', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'III', title: 'Vật tư', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'IV', title: 'Phần chế tạo', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
  { key: 'V', title: 'Các việc liên quan', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] },
]

function MomSectionsUI({ isEditable, attendantsData, sectionsData, onAttendantsChange, onSectionsChange, onHeaderImport }: {
  isEditable: boolean
  attendantsData: unknown
  sectionsData: unknown
  onAttendantsChange: (val: string) => void
  onSectionsChange: (val: string) => void
  onHeaderImport?: (h: Record<string, string>) => void
}) {
  // Parse data
  let attendants: MomAttendant[] = []
  try { const p = attendantsData ? JSON.parse(String(attendantsData)) : null; if (Array.isArray(p)) attendants = p } catch { /* */ }

  let sections: MomSection[] = []
  try { const p = sectionsData ? JSON.parse(String(sectionsData)) : null; if (Array.isArray(p) && p.length > 0) sections = p } catch { /* */ }
  if (sections.length === 0) sections = DEFAULT_SECTIONS

  const updateAttendants = (next: MomAttendant[]) => onAttendantsChange(JSON.stringify(next))
  const updateSections = (next: MomSection[]) => onSectionsChange(JSON.stringify(next))

  const addAttendant = () => updateAttendants([...attendants, { name: '', role: '' }])
  const removeAttendant = (i: number) => updateAttendants(attendants.filter((_, idx) => idx !== i))
  const editAttendant = (i: number, field: string, val: string) => {
    const next = [...attendants]; next[i] = { ...next[i], [field]: val }; updateAttendants(next)
  }

  const addItem = (secIdx: number) => {
    const next = [...sections]
    const items = next[secIdx].items
    next[secIdx] = { ...next[secIdx], items: [...items, { stt: String(items.length + 1), noiDung: '', actionBy: '', dueDate: '', remark: '' }] }
    updateSections(next)
  }
  const removeItem = (secIdx: number, itemIdx: number) => {
    const next = [...sections]
    next[secIdx] = { ...next[secIdx], items: next[secIdx].items.filter((_, i) => i !== itemIdx) }
    updateSections(next)
  }
  const editItem = (secIdx: number, itemIdx: number, field: string, val: string) => {
    const next = [...sections]
    const items = [...next[secIdx].items]
    items[itemIdx] = { ...items[itemIdx], [field]: val }
    next[secIdx] = { ...next[secIdx], items }
    updateSections(next)
  }
  const editSectionTitle = (secIdx: number, val: string) => {
    const next = [...sections]; next[secIdx] = { ...next[secIdx], title: val }; updateSections(next)
  }
  const addSection = () => {
    const keys = ['I','II','III','IV','V','VI','VII','VIII','IX','X']
    const nextKey = keys[sections.length] || String(sections.length + 1)
    updateSections([...sections, { key: nextKey, title: '', items: [{ stt: '1', noiDung: '', actionBy: '', dueDate: '', remark: '' }] }])
  }
  const removeSection = (secIdx: number) => updateSections(sections.filter((_, i) => i !== secIdx))

  // ── Import BB họp Excel ──
  const importMomExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.xlsx,.xls'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[wb.SheetNames.length - 1]] // Last sheet is usually the target
        const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

        // Parse header
        const header: Record<string, string> = {}
        const parsedAttendants: MomAttendant[] = []
        let inAttendants = false
        let sectionStartRow = -1

        for (let r = 0; r < Math.min(data.length, 20); r++) {
          const row = data[r]
          if (!row) continue
          const c0 = String(row[0] || '').trim()
          const c2 = String(row[2] || '').trim()

          // Place
          if (c0.toLowerCase().includes('place') || c0.includes('Địa điểm')) {
            header.momPlace = c2
          }
          // Date
          if (c0.toLowerCase().includes('date') || c0.includes('Ngày')) {
            const rawDate = row[2]
            if (typeof rawDate === 'number') {
              // Excel serial date → YYYY-MM-DD
              const d = new Date((rawDate - 25569) * 86400000)
              header.kickoffDate = d.toISOString().split('T')[0]
            } else if (rawDate) {
              header.kickoffDate = String(rawDate)
            }
          }
          // MOM No
          if (c0.includes('MOM No') || c0.includes('Số biên bản')) {
            const rawNum = row[row.length - 1]
            if (typeof rawNum === 'number') {
              const d = new Date((rawNum - 25569) * 86400000)
              header.momNumber = d.toLocaleDateString('vi-VN')
            } else {
              header.momNumber = String(rawNum || '')
            }
          }
          // Prepared by
          if (c0.toLowerCase().includes('prepared') || c0.includes('Chuẩn bị')) {
            header.momPreparedBy = c2 || String(row[row.length - 1] || '')
          }
          // Attendants
          if (c0.toLowerCase().includes('attendant') || c0.includes('Thành phần')) {
            inAttendants = true
            if (c2) parsedAttendants.push({ name: c2.split(':')[0]?.trim() || c2, role: c2.split(':')[1]?.trim() || '' })
            continue
          }
          if (inAttendants) {
            if (c0.toLowerCase().includes('subject') || c0.includes('Chủ đề') || c2.includes('Acknowledge')) {
              inAttendants = false
            } else if (c2 && !c2.includes('Acknowledge')) {
              // "Mr Hưng: PM" or "IBSHI:" etc
              if (c2.endsWith(':') || c2.toUpperCase() === c2) {
                // Group header like "IBSHI:" — skip or add as role marker
              } else {
                const parts = c2.split(':')
                parsedAttendants.push({ name: parts[0]?.trim() || c2, role: parts[1]?.trim() || '' })
              }
            }
          }
          // Subject
          if (c0.toLowerCase().includes('subject') || c0.includes('Chủ đề')) {
            header.kickoffAgenda = c2
          }
          // Detect section start (STT header row)
          if (c0.toLowerCase().includes('stt') || c0.includes('No.')) {
            sectionStartRow = r + 1
          }
        }

        // Parse sections by Roman numerals
        if (sectionStartRow < 0) sectionStartRow = 15 // fallback
        const parsedSections: MomSection[] = []
        let currentSection: MomSection | null = null
        const romanPattern = /^(I{1,3}|IV|V|VI{0,3}|IX|X)$/

        for (let r = sectionStartRow; r < data.length; r++) {
          const row = data[r]
          if (!row || row.every(c => !c)) continue
          const stt = String(row[0] || '').trim()
          const content = String(row[1] || '').trim()

          if (romanPattern.test(stt)) {
            // New section header
            if (currentSection) parsedSections.push(currentSection)
            currentSection = { key: stt, title: content.replace(/:$/, ''), items: [] }
          } else if (currentSection && (content || String(row[2] || ''))) {
            // Item row
            const noiDung = content || String(row[2] || '')
            const actionByRaw = row[8] ?? row[7] ?? ''
            const dueDateRaw = row[9] ?? ''
            const remarkRaw = row[10] ?? ''

            let dueDate = ''
            if (typeof dueDateRaw === 'number') {
              const d = new Date((dueDateRaw - 25569) * 86400000)
              dueDate = d.toLocaleDateString('vi-VN')
            } else if (dueDateRaw) {
              dueDate = String(dueDateRaw)
            }

            if (noiDung.includes('Acknowledge') || noiDung.includes('ĐẠI DIỆN')) continue
            currentSection.items.push({
              stt: stt || '-',
              noiDung,
              actionBy: String(actionByRaw || ''),
              dueDate,
              remark: String(remarkRaw || ''),
            })
          }
        }
        if (currentSection && currentSection.items.length > 0) parsedSections.push(currentSection)

        // Apply parsed data
        if (parsedAttendants.length > 0) updateAttendants(parsedAttendants)
        if (parsedSections.length > 0) updateSections(parsedSections)
        if (onHeaderImport && Object.keys(header).length > 0) onHeaderImport(header)
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  // ── Export BB họp Excel ──
  const exportMomExcel = () => {
    const wb = XLSX.utils.book_new()
    const rows: (string | number | null)[][] = []

    // Header
    rows.push([null, null, null, 'THE MINUTES OF MEETING\nBiên bản cuộc họp'])
    rows.push([])
    rows.push(['ATTENDANTS\nThành phần tham dự', null, attendants.map(a => `${a.name}${a.role ? ': ' + a.role : ''}`).join('\n')])
    rows.push([])
    rows.push(['No.\nSTT', 'DESCRIPTION OF DISCUSSION\nNội dung cuộc họp', null, null, null, null, null, null, 'ACTION BY\nHành động bởi', 'DUE DATE\nThời hạn', 'REMARK\nGhi chú'])

    sections.forEach(sec => {
      rows.push([sec.key, `${sec.title}:`])
      sec.items.forEach(item => {
        rows.push([item.stt, item.noiDung, null, null, null, null, null, null, item.actionBy, item.dueDate, item.remark])
      })
    })

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 6 }, { wch: 50 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 20 }]
    XLSX.utils.book_append_sheet(wb, ws, 'BB Hop')
    XLSX.writeFile(wb, 'BB_Hop_Trien_Khai.xlsx')
  }

  const cellStyle = { padding: '4px 6px', border: '1px solid var(--border)', fontSize: '0.8rem' }
  const inputStyle = { width: '100%', padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 4, fontSize: '0.8rem', background: 'var(--bg-secondary)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
      {/* Import / Export buttons */}
      <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #7c3aed' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#7c3aed' }}>Nội dung BB họp triển khai dự án</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={exportMomExcel}
              style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              📥 Export
            </button>
            {isEditable && (
              <button type="button" onClick={importMomExcel}
                style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                📤 Import Excel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Attendants */}
      <div className="card" style={{ padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Thành phần tham dự (Attendants)</h4>
          {isEditable && (
            <button type="button" onClick={addAttendant}
              style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
              + Thêm
            </button>
          )}
        </div>
        {attendants.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', border: '1px dashed var(--border)', borderRadius: 6 }}>
            Chưa có. Nhấn &quot;Import Excel&quot; hoặc &quot;Thêm&quot; để bắt đầu.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={{ ...cellStyle, width: 30 }}>#</th>
                <th style={cellStyle}>Họ tên</th>
                <th style={cellStyle}>Chức danh / Phòng ban</th>
                {isEditable && <th style={{ ...cellStyle, width: 40 }}></th>}
              </tr>
            </thead>
            <tbody>
              {attendants.map((a, i) => (
                <tr key={i}>
                  <td style={{ ...cellStyle, textAlign: 'center' }}>{i + 1}</td>
                  <td style={cellStyle}>
                    {isEditable ? <input style={inputStyle} value={a.name} onChange={e => editAttendant(i, 'name', e.target.value)} placeholder="VD: Mr Hưng" />
                      : a.name}
                  </td>
                  <td style={cellStyle}>
                    {isEditable ? <input style={inputStyle} value={a.role} onChange={e => editAttendant(i, 'role', e.target.value)} placeholder="VD: PM" />
                      : a.role}
                  </td>
                  {isEditable && (
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      <button type="button" onClick={() => removeAttendant(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Sections I-V */}
      {sections.map((sec, secIdx) => (
        <div key={sec.key} className="card" style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--accent)' }}>{sec.key}.</span>
              {isEditable ? (
                <input style={{ ...inputStyle, fontWeight: 600, fontSize: '0.9rem', minWidth: 200 }} value={sec.title}
                  onChange={e => editSectionTitle(secIdx, e.target.value)} placeholder="Tên mục" />
              ) : (
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{sec.title}</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {isEditable && (
                <button type="button" onClick={() => addItem(secIdx)}
                  style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                  + Thêm
                </button>
              )}
              {isEditable && sections.length > 1 && (
                <button type="button" onClick={() => removeSection(secIdx)}
                  style={{ padding: '3px 8px', fontSize: '0.7rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}>
                  Xóa mục
                </button>
              )}
            </div>
          </div>
          {sec.items.length === 0 ? (
            <div style={{ padding: 8, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Không có nội dung</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)' }}>
                  <th style={{ ...cellStyle, width: 40 }}>STT</th>
                  <th style={cellStyle}>Nội dung</th>
                  <th style={{ ...cellStyle, width: 110 }}>Hành động bởi</th>
                  <th style={{ ...cellStyle, width: 100 }}>Thời hạn</th>
                  <th style={{ ...cellStyle, width: 130 }}>Ghi chú</th>
                  {isEditable && <th style={{ ...cellStyle, width: 30 }}></th>}
                </tr>
              </thead>
              <tbody>
                {sec.items.map((item, itemIdx) => (
                  <tr key={itemIdx}>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                      {isEditable ? <input style={{ ...inputStyle, width: 30, textAlign: 'center' }} value={item.stt} onChange={e => editItem(secIdx, itemIdx, 'stt', e.target.value)} />
                        : item.stt}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.noiDung} onChange={e => editItem(secIdx, itemIdx, 'noiDung', e.target.value)} placeholder="Nội dung công việc" />
                        : item.noiDung}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.actionBy} onChange={e => editItem(secIdx, itemIdx, 'actionBy', e.target.value)} placeholder="Ai thực hiện" />
                        : item.actionBy}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.dueDate} onChange={e => editItem(secIdx, itemIdx, 'dueDate', e.target.value)} placeholder="dd/mm/yyyy" />
                        : item.dueDate}
                    </td>
                    <td style={cellStyle}>
                      {isEditable ? <input style={inputStyle} value={item.remark} onChange={e => editItem(secIdx, itemIdx, 'remark', e.target.value)} placeholder="Ghi chú" />
                        : item.remark}
                    </td>
                    {isEditable && (
                      <td style={{ ...cellStyle, textAlign: 'center' }}>
                        <button type="button" onClick={() => removeItem(secIdx, itemIdx)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {/* Add section button */}
      {isEditable && (
        <button type="button" onClick={addSection}
          style={{ padding: '8px 16px', fontSize: '0.85rem', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, width: '100%' }}>
          + Thêm mục mới
        </button>
      )}
    </div>
  )
}

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const taskId = params.id as string
  const { user: currentUser } = useAuthStore()

  const [task, setTask] = useState<TaskData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState<Record<string, string | number>>({})
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({})
  const [submitNotes, setSubmitNotes] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [siblingFiles, setSiblingFiles] = useState<Record<string, string> | null>(null)
  const [rejectionInfo, setRejectionInfo] = useState<{ reason: string; rejectedBy: string; rejectedAt: string } | null>(null)
  const [milestones, setMilestones] = useState<{ name: string; startDate: string; endDate: string; assigneeId: string }[]>([])
  const emptyBomItem = { name: '', code: '', spec: '', quantity: '', unit: '' }
  const [bomItems, setBomItems] = useState<{ name: string; code: string; spec: string; quantity: string; unit: string }[]>([{ ...emptyBomItem }, { ...emptyBomItem }, { ...emptyBomItem }])
  const emptyWoItem = { costCode: '', content: '', jobCode: '', typeCode: '', unit: '', qty1: '', qty2: '', totalQty: '', startDate: '', endDate: '' }
  const [woItems, setWoItems] = useState<{ costCode: string; content: string; jobCode: string; typeCode: string; unit: string; qty1: string; qty2: string; totalQty: string; startDate: string; endDate: string }[]>([{ ...emptyWoItem }])
  // P3.5 supplier entries
  const emptyQuote: SupplierQuote = { material: '', price: '' }
  const emptySupplier: SupplierEntry = { name: '', quotes: [{ ...emptyQuote }] }
  const [suppliers, setSuppliers] = useState<SupplierEntry[]>([{ ...emptySupplier, quotes: [{ ...emptyQuote }] }, { ...emptySupplier, quotes: [{ ...emptyQuote }] }, { ...emptySupplier, quotes: [{ ...emptyQuote }] }])
  // P3.7 payment & delivery state
  const [paymentType, setPaymentType] = useState<'full' | 'partial'>('full')
  const [paymentMilestones, setPaymentMilestones] = useState<{ label: string; percent: string; date: string }[]>([{ label: 'Đợt 1', percent: '', date: '' }])
  const [deliveryType, setDeliveryType] = useState<'full' | 'batch'>('full')
  const [deliveryBatches, setDeliveryBatches] = useState<{ material: string; qty: string; date: string }[]>([{ material: '', qty: '', date: '' }])
  const [userList, setUserList] = useState<{ id: string; fullName: string; roleCode: string }[]>([])
  const [inventoryMaterials, setInventoryMaterials] = useState<{ id: string; materialCode: string; name: string; unit: string; category: string; specification: string | null; currentStock: number }[]>([])
  const [inventoryLoading, setInventoryLoading] = useState(false)
  const [inventorySearch, setInventorySearch] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic workflow JSON from DB, shape varies per step
  const [previousStepData, setPreviousStepData] = useState<{ plan?: any; estimate?: any; bom?: any; bomMain?: any; bomWeldPaint?: any; bomSupply?: any; prItems?: any; fromStock?: any; toPurchase?: any; inventory?: any; supplierData?: any; poData?: any; qcData?: any; jobCardData?: any; volumeData?: any; woData?: any; lsxData?: any; departmentEstimates?: any; budgetTotal?: any } | null>(null)
  const [previousStepFiles, setPreviousStepFiles] = useState<PrevStepFile[]>([])
  // P1.2A WBS expanded rows
  const [wbsExpandedRows, setWbsExpandedRows] = useState<Set<number>>(new Set())
  // P4.1 payment confirmations per milestone
  const [paymentConfirmations, setPaymentConfirmations] = useState<{ confirmed: boolean; method: string }[]>([])
  // P4.4 warehouse items per material
  const [warehouseItems, setWarehouseItems] = useState<{ material: string; ncc: string; price: string; receivedQty: string; storageLocation: string }[]>([])
  const [planDecision, setPlanDecision] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [estimateDecision, setEstimateDecision] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [planRejectReason, setPlanRejectReason] = useState('')
  const [estimateRejectReason, setEstimateRejectReason] = useState('')
  const [showPlanReject, setShowPlanReject] = useState(false)
  const [showEstimateReject, setShowEstimateReject] = useState(false)

  useEffect(() => { loadTask(); loadUsers() }, [taskId])

  async function loadUsers() {
    const res = await apiFetch('/api/users')
    if (res.ok && res.users) setUserList(res.users)
  }

  // Check if current user can assign this task (L1 same department or admin)
  const canAssignTask = (() => {
    if (!currentUser || !task) return false
    const userRole = currentUser.roleCode || ''
    const userLevel = currentUser.userLevel ?? 99
    const isAdmin = ['R00', 'R01', 'R02', 'R02a'].includes(userRole)
    if (isAdmin) return true
    if (userLevel > 1) return false
    const userBase = userRole.replace(/[a-zA-Z]$/, '')
    const taskBase = task.assignedRole.replace(/[a-zA-Z]$/, '')
    return userBase === taskBase
  })()

  async function handleAssignTask(userId: string) {
    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'assign', assignToUserId: userId }),
    })
    if (res.ok || res.success) {
      setSuccessMsg('✅ Đã phân công thành công')
      setShowAssignModal(false)
      loadTask()
      setTimeout(() => setSuccessMsg(''), 3000)
    } else {
      setError(res.error || 'Lỗi khi phân công')
    }
  }

  async function loadInventory() {
    setInventoryLoading(true)
    try {
      let res = await apiFetch(`/api/materials?t=${Date.now()}`)
      // Auto-seed if no materials exist
      if (res.ok && res.materials && res.materials.length === 0) {
        await apiFetch('/api/materials/seed', { method: 'POST' })
        res = await apiFetch(`/api/materials?t=${Date.now()}`)
      }
      if (res.ok && res.materials) setInventoryMaterials(res.materials)
    } catch (err) { console.error('Load inventory error:', err) }
    setInventoryLoading(false)
  }

  async function loadTask() {
    const res = await apiFetch(`/api/tasks/${taskId}`)
    if (res.ok) {
      setTask(res.task)
      // Pre-fill form with existing resultData
      if (res.task.resultData) {
        setFormData(res.task.resultData as Record<string, string | number>)
        // Restore bomItems for P2.1/P2.2/P2.3 reopened tasks
        const rd = res.task.resultData as Record<string, unknown>
        if (rd.bomItems && Array.isArray(rd.bomItems)) {
          setBomItems(rd.bomItems as { name: string; code: string; spec: string; quantity: string; unit: string }[])
        }
        // Restore woItems for P3.4 reopened tasks
        if (rd.woItems && Array.isArray(rd.woItems)) {
          setWoItems(rd.woItems as typeof woItems)
        }
        // Restore suppliers for P3.5
        if (rd.suppliers && Array.isArray(rd.suppliers)) {
          setSuppliers(rd.suppliers as SupplierEntry[])
        }
        // Restore P3.7 payment & delivery
        if (rd.paymentType) setPaymentType(rd.paymentType as 'full' | 'partial')
        if (rd.paymentMilestones && Array.isArray(rd.paymentMilestones)) setPaymentMilestones(rd.paymentMilestones as typeof paymentMilestones)
        if (rd.deliveryType) setDeliveryType(rd.deliveryType as 'full' | 'batch')
        if (rd.deliveryBatches && Array.isArray(rd.deliveryBatches)) setDeliveryBatches(rd.deliveryBatches as typeof deliveryBatches)
        // Restore P4.1 payment confirmations
        if (rd.paymentConfirmations && Array.isArray(rd.paymentConfirmations)) setPaymentConfirmations(rd.paymentConfirmations as typeof paymentConfirmations)
        // Restore P4.4 warehouse items
        if (rd.warehouseItems && Array.isArray(rd.warehouseItems)) setWarehouseItems(rd.warehouseItems as typeof warehouseItems)
        // Restore milestones for P1.2A reopened tasks
        if (rd.milestones && Array.isArray(rd.milestones)) {
          setMilestones(rd.milestones as { name: string; startDate: string; endDate: string; assigneeId: string }[])
        }
      }
      // Load inventory for P2.1/P2.2/P2.3 (always, not just when resultData exists)
      if (['P2.1', 'P2.2', 'P2.3'].includes(res.task.stepCode)) {
        loadInventory()
      }
      // Auto-generate WO number for P3.4
      if (res.task.stepCode === 'P3.4' && !res.task.resultData?.woNumber) {
        const pCode = res.task.project?.projectCode || 'LSX'
        const woNum = `${pCode}-${String(Math.floor(Math.random() * 99) + 1).padStart(2, '0')}`
        setFormData(prev => ({ ...prev, woNumber: woNum }))
      }
      if (res.previousStepFiles) {
        setPreviousStepFiles(res.previousStepFiles)
      }
      if (res.previousStepData) {
        setPreviousStepData(res.previousStepData)
        // P3.5: auto-fill default suppliers with PR items if no saved supplier data
        if (res.task.stepCode === 'P3.5' && !(res.task.resultData as Record<string, unknown> | null)?.suppliers) {
          const prRaw = (res.previousStepData as Record<string, unknown>)?.prItems
          if (Array.isArray(prRaw) && prRaw.length > 0) {
            const prQuotes = prRaw.filter((p: Record<string, string>) => p.name?.trim()).map((p: Record<string, string>) => ({ material: p.name, price: '' }))
            setSuppliers([
              { name: '', quotes: [...prQuotes] },
              { name: '', quotes: [...prQuotes] },
              { name: '', quotes: [...prQuotes] },
            ])
          }
        }
      }
      // For P1.3: restore previous approval decisions
      if (res.task.stepCode === 'P1.3' && res.task.resultData) {
        const rd = res.task.resultData as Record<string, unknown>
        if (rd.planApproved) setPlanDecision('approved')
        if (rd.estimateApproved) setEstimateDecision('approved')
      }
      // For P1.1B: auto-fill project data into readonly form fields
      if (res.task.stepCode === 'P1.1B' && res.task.project) {
        const p = res.task.project
        setFormData(prev => ({
          ...prev,
          projectCode: p.projectCode || '',
          projectName: p.projectName || '',
          clientName: p.clientName || '',
          productType: p.productType || '',
          contractValue: p.contractValue ? String(p.contractValue) : '',
          currency: p.currency || '',
          startDate: p.startDate ? new Date(p.startDate).toLocaleDateString('vi-VN') : '',
          endDate: p.endDate ? new Date(p.endDate).toLocaleDateString('vi-VN') : '',
          description: (p.description || '').replace(/\n?<!--FILES:.*?-->/g, '').trim(),
        }))
      }
      // Load sibling files for P1.1B (files from P1.1)
      if (res.siblingFiles) {
        setSiblingFiles(res.siblingFiles)
      }
      // Load rejection info for P1.1 (from P1.1B)
      if (res.rejectionInfo) {
        setRejectionInfo(res.rejectionInfo)
      }
      // For P1.1 reopened: pre-fill form with existing project data
      if (res.task.stepCode === 'P1.1' && res.task.project) {
        const p = res.task.project
        setFormData(prev => ({
          ...prev,
          projectCode: prev.projectCode || p.projectCode || '',
          projectName: prev.projectName || p.projectName || '',
          clientName: prev.clientName || p.clientName || '',
          productType: prev.productType || p.productType || '',
          contractValue: prev.contractValue || (p.contractValue ? String(p.contractValue) : ''),
          currency: prev.currency || p.currency || '',
          startDate: prev.startDate || (p.startDate ? new Date(p.startDate).toISOString().split('T')[0] : ''),
          endDate: prev.endDate || (p.endDate ? new Date(p.endDate).toISOString().split('T')[0] : ''),
          description: prev.description || (p.description || '').replace(/\n?<!--FILES:.*?-->/g, '').trim(),
        }))
      }
      // For P2.4: auto-fill BOM summary and budget comparison (KTKH reviews data from P2.1/P2.2/P2.3)
      if (res.task.stepCode === 'P2.4' && res.previousStepData) {
        const bomData = res.previousStepData.bom
        const estimateData = res.previousStepData.estimate
        let bomSummary = '—'
        let budgetComparison = '—'
        if (bomData?.bomItems) {
          const items = bomData.bomItems as Array<{ quantity: string }>
          const totalQty = items.reduce((sum: number, item: { quantity: string }) => sum + (Number(item.quantity) || 0), 0)
          bomSummary = `${items.length} mục VT — Tổng SL: ${totalQty.toLocaleString('vi-VN')}`
        }
        if (estimateData?.totalEstimate) {
          const totalEstimate = Number(estimateData.totalEstimate) || 0
          budgetComparison = `Dự toán: ${totalEstimate.toLocaleString('vi-VN')} VNĐ`
        }
        setFormData(prev => ({ ...prev, bomSummary, budgetComparison }))
      }
      // For P6.5: auto-fill readonly fields from P6.1-P6.4 status
      if (res.task.stepCode === 'P6.5' && res.previousStepData) {
        const pd = res.previousStepData as Record<string, unknown>
        const totalCost = pd.p62Total ? `${Number(pd.p62Total).toLocaleString('vi-VN')} đ` : ''
        const variance = pd.p62Variance ? ` (chênh lệch: ${Number(pd.p62Variance) > 0 ? '+' : ''}${pd.p62Variance}%)` : ''
        const profit = pd.p63Profit ? `LN: ${Number(pd.p63Profit).toLocaleString('vi-VN')} đ` : ''
        const margin = pd.p63Margin ? ` — Biên LN: ${pd.p63Margin}%` : ''
        setFormData(prev => ({
          ...prev,
          qcDossierStatus: pd.p61Status as string || '⏳ Chưa bắt đầu',
          costSettlement: pd.p62Status ? `${pd.p62Status}${totalCost ? ` — ${totalCost}${variance}` : ''}` : '⏳ Chưa bắt đầu',
          plSummary: pd.p63Status ? `${pd.p63Status}${profit ? ` — ${profit}${margin}` : ''}` : '⏳ Chưa bắt đầu',
          lessonLearnStatus: pd.p64Status as string || '⏳ Chưa bắt đầu',
        }))
      }    }
    setLoading(false)
  }

  const config = task ? getStepFormConfig(task.stepCode) : undefined
  const rule = task ? WORKFLOW_RULES[task.stepCode] : undefined
  const phaseName = rule ? PHASE_LABELS[rule.phase]?.name : ''

  function handleFieldChange(key: string, value: string | number) {
    setFormData(prev => {
      const next = { ...prev, [key]: value }
      // Auto-calculate total from currency fields (P2.4 and other steps with editable tables)
      if (config && config.fields.some(f => f.key === 'totalEstimate' && f.type === 'readonly')) {
        // Fallback for other steps with currency fields
        const currencyKeys = config.fields.filter(f => f.type === 'currency').map(f => f.key)
        if (currencyKeys.length > 0) {
          const total = currencyKeys.reduce((sum, k) => sum + (Number(next[k]) || 0), 0)
          next.totalEstimate = total
        }
      }
      return next
    })
  }

  function handleChecklistToggle(key: string) {
    setChecklistState(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function addMilestone() {
    setMilestones(prev => [...prev, { name: '', startDate: '', endDate: '', assigneeId: '' }])
  }
  function removeMilestone(idx: number) {
    setMilestones(prev => prev.filter((_, i) => i !== idx))
  }
  function updateMilestone(idx: number, field: string, value: string) {
    setMilestones(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m))
  }

  function addBomItem() {
    setBomItems(prev => [...prev, { name: '', code: '', spec: '', quantity: '', unit: '' }])
  }
  function removeBomItem(idx: number) {
    setBomItems(prev => prev.filter((_, i) => i !== idx))
  }
  function updateBomItem(idx: number, field: string, value: string) {
    setBomItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  }

  // --- Excel for Milestones ---
  const exportMilestonesExcel = () => {
    const headers = ['STT', 'Tên Milestone', 'Bắt đầu', 'Kết thúc', 'Người phụ trách']
    const data = milestones.map((m, idx) => [
      idx + 1, m.name, m.startDate, m.endDate,
      userList.find(u => u.id === m.assigneeId)?.fullName || m.assigneeId
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    ws['!cols'] = [{ wch: 5 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 25 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Milestones')
    XLSX.writeFile(wb, `Milestones_${task?.project?.projectCode || 'P1.2A'}.xlsx`)
  }

  const importMilestonesExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
        if (jsonData.length < 2) return
        const headerRow = jsonData[0].map(h => String(h || '').trim().toLowerCase())
        const keyMap: Record<string, string> = {
          'tên milestone': 'name', 'tên': 'name', 'hạng mục': 'name', 'milestone': 'name',
          'bắt đầu': 'startDate', 'start': 'startDate', 'ngày bắt đầu': 'startDate',
          'kết thúc': 'endDate', 'end': 'endDate', 'ngày kết thúc': 'endDate',
          'người phụ trách': 'assigneeId', 'pic': 'assigneeId', 'assignee': 'assigneeId'
        }
        const colMapping = headerRow.map(h => keyMap[h] || '')
        const imported: typeof milestones = []
        for (let i = 1; i < jsonData.length; i++) {
          const rowData = jsonData[i]
          if (!rowData || rowData.every(c => !c)) continue
          const newRow = { name: '', startDate: '', endDate: '', assigneeId: '' }
          colMapping.forEach((key, ci) => {
            if (key && rowData[ci] != null) {
              let val = String(rowData[ci])
              if (key === 'assigneeId') {
                const matchedUser = userList.find(u => u.fullName.toLowerCase() === val.toLowerCase() || u.id === val)
                if (matchedUser) val = matchedUser.id
              }
              if (key === 'startDate' || key === 'endDate') {
                if (val && val.includes('/')) {
                  const parts = val.split('/')
                  if (parts.length === 3) val = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
                }
                if (!isNaN(Number(val)) && Number(val) > 40000) {
                   const date = new Date(Math.round((Number(val) - 25569) * 86400 * 1000))
                   val = date.toISOString().split('T')[0]
                }
              }
              // @ts-expect-error dynamic
              newRow[key] = val
            }
          })
          if (newRow.name) imported.push(newRow)
        }
        if (imported.length > 0) {
          setMilestones(prev => {
            const cleanPrev = prev.filter(r => r.name.trim() || r.startDate || r.endDate)
            return [...cleanPrev, ...imported]
          })
          setSuccessMsg(`✅ Đã import ${imported.length} milestones`)
          setTimeout(() => setSuccessMsg(''), 3000)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  // --- Excel for BOM Items ---
  const exportBomExcel = () => {
    const headers = ['STT', 'Mã Vật Tư', 'Tên Vật Tư', 'Quy Chuẩn', 'Số Lượng', 'ĐVT']
    const data = bomItems.map((m, idx) => [
      idx + 1, m.code, m.name, m.spec, m.quantity, m.unit
    ])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    ws['!cols'] = [{ wch: 5 }, { wch: 20 }, { wch: 40 }, { wch: 25 }, { wch: 15 }, { wch: 10 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'BOM')
    XLSX.writeFile(wb, `BOM_${task?.project?.projectCode || 'P2.X'}.xlsx`)
  }

  const importBomExcel = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.xlsx,.xls,.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (evt) => {
        const wb = XLSX.read(evt.target?.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
        if (jsonData.length < 2) return
        const headerRow = jsonData[0].map(h => String(h || '').trim().toLowerCase())
        const keyMap: Record<string, string> = {
          'mã vật tư': 'code', 'mã vt': 'code', 'code': 'code', 'mã': 'code',
          'tên vật tư': 'name', 'tên vt': 'name', 'name': 'name', 'tên': 'name',
          'quy chuẩn': 'spec', 'quy cách': 'spec', 'spec': 'spec', 'specification': 'spec',
          'số lượng': 'quantity', 'khối lượng': 'quantity', 'kl': 'quantity', 'sl': 'quantity', 'qty': 'quantity', 'quantity': 'quantity',
          'đvt': 'unit', 'đv': 'unit', 'unit': 'unit'
        }
        const colMapping = headerRow.map(h => keyMap[h] || '')
        const imported: typeof bomItems = []
        for (let i = 1; i < jsonData.length; i++) {
          const rowData = jsonData[i]
          if (!rowData || rowData.every(c => !c)) continue
          const newRow = { name: '', code: '', spec: '', quantity: '', unit: '' }
          colMapping.forEach((key, ci) => {
            if (key && rowData[ci] != null) {
              // @ts-expect-error dynamic assignment
              newRow[key] = String(rowData[ci])
            }
          })
          if (newRow.name || newRow.code) imported.push(newRow)
        }
        if (imported.length > 0) {
          setBomItems(prev => {
            const cleanPrev = prev.filter(r => r.name.trim() || r.code.trim())
            return [...cleanPrev, ...imported]
          })
          setSuccessMsg(`✅ Đã import ${imported.length} vật tư`)
          setTimeout(() => setSuccessMsg(''), 3000)
        }
      }
      reader.readAsBinaryString(file)
    }
    input.click()
  }

  async function handleSubmit(action: 'complete' | 'reject') {
    if (!task || !config) return
    setSubmitting(true)
    setError('')

    // Validate required fields
    const missingFields = config.fields
      .filter(f => f.required && !formData[f.key] && f.type !== 'readonly')
      .map(f => f.label)

    if (missingFields.length > 0 && action === 'complete') {
      setError(`Vui lòng nhập: ${missingFields.join(', ')}`)
      setSubmitting(false)
      return
    }

    // Validate BOM items for P2.1 (VT chính) — P2.2 is optional
    if (task.stepCode === 'P2.1' && action === 'complete') {
      const filledBomItems = bomItems.filter(b => b.name.trim() && b.code.trim())
      if (filledBomItems.length < 3) {
        setError('Danh sách vật tư phải có tối thiểu 3 mục (đã nhập tên + mã VT)')
        setSubmitting(false)
        return
      }
    }

    // Validate required checklist items
    const missingChecklist = config.checklist
      .filter(c => c.required && !checklistState[c.key])
      .map(c => c.label)

    if (missingChecklist.length > 0 && action === 'complete') {
      setError(`Vui lòng xác nhận: ${missingChecklist.join(', ')}`)
      setSubmitting(false)
      return
    }

    // Check if this is a reject action
    if (action === 'reject') {
      const reason = formData.rejectReason as string || submitNotes
      if (!reason) {
        setError('Vui lòng nhập lý do từ chối')
        setSubmitting(false)
        return
      }
      const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      })
      if (res.success) {
        setSuccessMsg(`✅ Đã từ chối. Quay về bước ${res.returnedTo}: ${res.returnedToName || ''}`)
        setTimeout(() => router.push('/dashboard/tasks'), 2000)
      } else {
        setError(res.error || 'Lỗi khi từ chối')
      }
      setSubmitting(false)
      return
    }

    // Complete action
    const finalData = { ...formData }
    if (task.stepCode === 'P2.4' || task.stepCode === 'P2.1A') {
      const ensuredKeys = [
        { key: 'dt02Items', def: [{ maCP: 'I', noiDung: 'Chi phí vật tư', giaTri: '', tyLe: '' }] },
        { key: 'dt03Items', def: [{ nhomVT: '', danhMuc: '', dvt: '', kl: '', donGia: '', thanhTien: '' }] },
        { key: 'dt04Items', def: [{ maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' }] },
        { key: 'dt05Items', def: [{ maCP: '', noiDung: '', dvt: '', kl: '', donGia: '', thanhTien: '' }] },
        { key: 'dt06Items', def: [{ maCP: '', noiDung: '', dvt: '', kl: '', donGia: '', thanhTien: '' }] },
        { key: 'dt07Items', def: [{ maCP: '', danhMuc: '', dvt: '', kl: '', donGia: '', thanhTien: '' }] },
      ]
      ensuredKeys.forEach(({ key, def }) => {
        const isRendered = (task.stepCode === 'P2.1A' && ['dt02Items','dt07Items'].includes(key)) ||
                           (task.stepCode === 'P2.4')
        if (isRendered && !finalData[key]) {
          const defaultArray = Array.isArray(def) ? def : [def] // TS compat, def is always array here
          finalData[key] = JSON.stringify(getInheritedEstRows(key, defaultArray as Record<string,string>[]))
        }
      })
    }

    const res = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({
        action: 'complete',
        resultData: {
          ...finalData,
          checklist: checklistState,
          ...(siblingFiles ? { attachedFiles: siblingFiles } : {}),
          ...(milestones.length > 0 ? { milestones } : {}),
          ...(bomItems.filter(b => b.name.trim()).length > 0 ? { bomItems: bomItems.filter(b => b.name.trim()) } : {}),
          ...(woItems.filter(w => w.content.trim()).length > 0 ? { woItems: woItems.filter(w => w.content.trim()) } : {}),
          ...(suppliers.filter(s => s.name.trim()).length > 0 ? { suppliers: suppliers.filter(s => s.name.trim()) } : {}),
          paymentType,
          ...(paymentType === 'partial' ? { paymentMilestones } : {}),
          deliveryType,
          ...(deliveryType === 'batch' ? { deliveryBatches: deliveryBatches.filter(d => d.material.trim()) } : {}),
          ...(paymentConfirmations.length > 0 ? { paymentConfirmations } : {}),
          ...(warehouseItems.length > 0 ? { warehouseItems } : {}),
        },
        notes: submitNotes || `Completed: ${task.stepName}`,
      }),
    })

    if (res.ok) {
      setSuccessMsg(`✅ Hoàn thành! Bước tiếp: ${res.nextSteps?.join(', ') || 'Không có'}`)
      setTimeout(() => router.push('/dashboard/tasks'), 2000)
    } else {
      setError(res.error || 'Lỗi khi hoàn thành')
    }
    setSubmitting(false)
  }

  const getInheritedEstRows = (key: string, baseDefault: any[]) => {
    if (!task || task.stepCode !== 'P2.4' || !previousStepData?.estimate) return baseDefault
    try {
      const raw = previousStepData.estimate[key]
      if (!raw) return baseDefault
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return (Array.isArray(parsed) && parsed.length > 0) ? parsed : baseDefault
    } catch { return baseDefault }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
      <div style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>⏳ Đang tải...</div>
    </div>
  )

  if (!task) return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>❌ Task không tồn tại</h2>
      <button onClick={() => router.push('/dashboard/tasks')} className="btn-accent" style={{ marginTop: '1rem' }}>
        ← Quay lại danh sách
      </button>
    </div>
  )

  const isActive = task.status === 'IN_PROGRESS'
  const isDone = task.status === 'DONE'

  let isP45Valid = true
  let displayTitle = task.stepName
  if (task && task.stepCode === 'P4.5') {
    const src = (task.resultData as any)?.sourceStep
    if (src === 'P3.3') displayTitle = 'Kho cấp vật tư cho PM (Thầu phụ)'
    else if (src === 'P3.4') displayTitle = 'Kho cấp vật tư cho QLSX (Nội bộ)'
    else displayTitle = 'Kho đề nghị cấp vật tư cho PM và QLSX'

    const reqs = ((task.resultData as Record<string, any>)?.materialIssueRequests as Record<string, any>[]) || []
    const req = reqs[0]
    if (req) {
      const stockItem = inventoryMaterials.find(m => m.materialCode === req.code)
      const currentStock = stockItem ? Number(stockItem.currentStock) : 0
      const reqQty = Number(req.quantity) || 0
      if (currentStock < reqQty) isP45Valid = false
    } else {
      isP45Valid = false
    }
  }
  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border)',
        borderRadius: 12, padding: '1.5rem 2rem', marginBottom: '1.5rem',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
          <span>Phase {rule?.phase}: {phaseName}</span>
          <span>•</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>{task.project.projectCode}</span>
          <span>•</span>
          <span>{task.project.projectName}</span>
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: 'var(--text-primary, #0f172a)' }}>
          {task.stepCode} — {displayTitle}
        </h1>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary, #475569)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDone ? '#059669' : isActive ? '#2563eb' : 'inherit' }}>
            {isDone ? '✅ Hoàn thành' : isActive ? '🔄 Đang thực hiện' : `📋 ${task.status}`}
          </span>
          {task.deadline && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626' }}>
              ⏰ Deadline: {new Date(task.deadline).toLocaleDateString('vi-VN')}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            👤 {task.assignee ? task.assignee.fullName : <span className="italic opacity-60">Chưa phân công</span>}
            {canAssignTask && isActive && (
              <button
                onClick={() => setShowAssignModal(true)}
                style={{
                  marginLeft: 4, padding: '2px 8px', fontSize: '0.75rem', fontWeight: 600,
                  background: '#3b82f6', color: 'white', border: 'none', borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Phân công
              </button>
            )}
          </span>
        </div>
      </div>

      {successMsg && (
        <div style={{ background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 8, padding: '1rem', marginBottom: '1rem', color: '#155724', fontWeight: 600 }}>
          {successMsg}
        </div>
      )}

      {/* Rejection reason banner — generic for any step rejection */}
      {rejectionInfo && (() => {
        const fromStep = (rejectionInfo as { fromStep?: string }).fromStep
        const isQC = fromStep === 'P4.3' || fromStep === 'P5.3'
        const title = fromStep === 'P5.3' ? 'QC đã từ chối nghiệm thu sản phẩm SX'
          : fromStep === 'P4.3' ? 'QC đã từ chối nghiệm thu nhập kho'
          : 'BGĐ đã từ chối phê duyệt dự án này'
        const hint = isQC
          ? '📝 Vui lòng kiểm tra lại và hoàn thành lại bước này.'
          : '📝 Vui lòng chỉnh sửa thông tin dự án theo yêu cầu và hoàn thành lại bước này.'
        return (
        <div style={{
          background: '#fef2f2', border: '2px solid #fecaca', borderRadius: 10, padding: '1.25rem',
          marginBottom: '1rem', color: '#991b1b',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <strong style={{ fontSize: '1rem' }}>{title}</strong>
          </div>
          <div style={{ fontSize: '0.9rem', marginBottom: 6 }}>
            <strong>Lý do:</strong> {rejectionInfo.reason}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#b91c1c' }}>
            Người từ chối: {rejectionInfo.rejectedBy}
            {rejectionInfo.rejectedAt && ` — ${new Date(rejectionInfo.rejectedAt).toLocaleString('vi-VN')}`}
          </div>
          {/* QC items from P5.3 rejection */}
          {fromStep === 'P5.3' && (() => {
            const qcItems = (rejectionInfo as { qcItems?: { task: string; result: string }[] }).qcItems
            if (!qcItems || !Array.isArray(qcItems) || qcItems.length === 0) return null
            const resultStyle: Record<string, { bg: string; color: string }> = {
              PASS: { bg: '#dcfce7', color: '#16a34a' },
              FAIL: { bg: '#fef2f2', color: '#dc2626' },
              CONDITIONAL: { bg: '#fef3c7', color: '#d97706' },
            }
            return (
              <div style={{ marginTop: 10, background: '#fff', borderRadius: 8, border: '1px solid #fecaca', overflow: 'hidden' }}>
                <div style={{ background: '#fef2f2', padding: '6px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#991b1b' }}>
                  📋 Kết quả nghiệm thu QC ({qcItems.length} hạng mục)
                </div>
                {qcItems.map((item, idx) => {
                  const rs = resultStyle[item.result] || { bg: '#f3f4f6', color: '#6b7280' }
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderBottom: '1px solid #fef2f2' }}>
                      <span style={{ fontSize: '0.7rem', color: '#9ca3af', width: 20 }}>{idx + 1}</span>
                      <span style={{ flex: 1, fontSize: '0.8rem', color: '#374151' }}>{item.task || '—'}</span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: rs.bg, color: rs.color }}>
                        {item.result || '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
          <div style={{ marginTop: 10, fontSize: '0.85rem', color: '#dc2626', fontWeight: 500 }}>
            {hint}
          </div>
        </div>
        )
      })()}

      {error && (
        <div style={{ background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 8, padding: '1rem', marginBottom: '1rem', color: '#721c24' }}>
          ⚠️ {error}
        </div>
      )}

      {config ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.5rem' }}>
          {/* Main Form */}
          <div>
            {/* Description */}
            <div className="card" style={{ marginBottom: '1rem', padding: '1rem 1.25rem' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                ℹ️ {config.description}
              </p>
            </div>

            {/* P1.3 Dual Approval UI */}
            {task.stepCode === 'P1.3' && previousStepData ? (
              <>
                {/* Section 1: PM Plan */}
                <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', border: planDecision === 'approved' ? '2px solid #16a34a' : planDecision === 'rejected' ? '2px solid #dc2626' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8 }}>
                      📋 Kế hoạch Kickoff / WBS / Milestones <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>(PM - P1.2A)</span>
                    </h3>
                    {planDecision !== 'pending' && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: planDecision === 'approved' ? '#16a34a' : '#dc2626' }}>
                        {planDecision === 'approved' ? '✅ Đã duyệt' : '❌ Đã từ chối'}
                      </span>
                    )}
                  </div>
                  {previousStepData.plan ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      {/* MOM Header fields */}
                      {previousStepData.plan.momPlace && (
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Địa điểm</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.momPlace}</div>
                        </div>
                      )}
                      {previousStepData.plan.kickoffDate && (
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Ngày họp</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.kickoffDate}</div>
                        </div>
                      )}
                      {previousStepData.plan.momNumber && (
                        <div>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Số biên bản</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.momNumber}</div>
                        </div>
                      )}
                      {previousStepData.plan.kickoffAgenda && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Chủ đề</label>
                          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '0.75rem', fontSize: '0.9rem', marginTop: 4 }}>{previousStepData.plan.kickoffAgenda}</div>
                        </div>
                      )}
                      {/* MOM Sections (readonly) */}
                      {previousStepData.plan.momSections && (
                        <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                          <MomSectionsUI
                            isEditable={false}
                            attendantsData={previousStepData.plan.momAttendants}
                            sectionsData={previousStepData.plan.momSections}
                            onAttendantsChange={() => {}}
                            onSectionsChange={() => {}}
                          />
                        </div>
                      )}
                      {/* WBS Display */}
                      <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                        <WbsTableUI isWbsEditable={false} wbsItemsData={previousStepData.plan.wbsItems} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu kế hoạch</div>
                  )}
                  {/* Plan approve/reject buttons */}
                  {isActive && planDecision === 'pending' && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={async () => {
                          setPlanDecision('approved')
                          await apiFetch(`/api/tasks/${taskId}`, {
                            method: 'PUT',
                            body: JSON.stringify({ action: 'save', resultData: { ...formData, planApproved: true, checklist: checklistState } }),
                          })
                          setSuccessMsg('✅ Đã duyệt kế hoạch. Vui lòng duyệt dự toán bên dưới.')
                          setTimeout(() => setSuccessMsg(''), 4000)
                        }} disabled={submitting}
                          style={{ padding: '8px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ✅ Duyệt kế hoạch
                        </button>
                        <button onClick={() => setShowPlanReject(!showPlanReject)} disabled={submitting}
                          style={{ padding: '8px 20px', background: 'transparent', color: '#dc2626', border: '1px solid #dc2626', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ❌ Từ chối / Yêu cầu chỉnh sửa
                        </button>
                      </div>
                      {showPlanReject && (
                        <div style={{ marginTop: 10 }}>
                          <textarea value={planRejectReason} onChange={e => setPlanRejectReason(e.target.value)}
                            placeholder="Nhập lý do từ chối kế hoạch..." rows={2}
                            style={{ width: '100%', borderRadius: 8, border: '1px solid #dc2626', padding: '0.5rem', fontSize: '0.85rem', resize: 'vertical', background: 'var(--bg-secondary)' }} />
                          <button onClick={async () => {
                            if (!planRejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return; }
                            setSubmitting(true)
                            try {
                              await apiFetch(`/api/tasks/${taskId}/reject`, {
                                method: 'POST',
                                body: JSON.stringify({ reason: planRejectReason, overrideRejectTo: 'P1.2A' }),
                              })
                              setSuccessMsg('✅ Đã từ chối và đẩy lại task về PM (P1.2A)')
                              setTimeout(() => router.push('/dashboard/tasks'), 2000)
                            } catch { setError('Lỗi khi từ chối') }
                            setSubmitting(false)
                          }} disabled={submitting}
                            style={{ marginTop: 6, padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            ⚠️ Xác nhận từ chối kế hoạch → Gửi lại PM (P1.2A)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Plan pre-approved from previous round */}
                  {planDecision === 'approved' && task?.resultData && Boolean((task.resultData as Record<string, unknown>).planApproved) && (
                    <div style={{ marginTop: 12, padding: '8px 16px', background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                      ✅ Đã được phê duyệt từ lần xét duyệt trước
                    </div>
                  )}
                </div>

                {/* ══ P1.3: ESTIMATE APPROVAL (from P1.2) ══ */}
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>📊 Dự toán thi công (từ P1.2)</h2>
                    {estimateDecision !== 'pending' && (
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: estimateDecision === 'approved' ? '#16a34a' : '#dc2626' }}>
                        {estimateDecision === 'approved' ? '✅ Đã duyệt' : '❌ Đã từ chối'}
                      </span>
                    )}
                  </div>
                  {previousStepData?.estimate ? (() => {
                    const est = previousStepData.estimate as Record<string, unknown>
                    const totalMat = Number(est.totalMaterial) || 0
                    const totalLab = Number(est.totalLabor) || 0
                    const totalSvc = Number(est.totalService) || 0
                    const totalOvh = Number(est.totalOverhead) || 0
                    const totalEst = Number(est.totalEstimate) || 0
                    const contractVal = Number(task.project?.contractValue) || 0
                    const profit = contractVal - totalEst
                    const fmtVND = (v: number) => v > 0 ? v.toLocaleString('vi-VN') + ' đ' : '—'
                    const pctEst = (v: number) => totalEst > 0 ? ((v / totalEst) * 100).toFixed(1) + '%' : '—'

                    // Parse DT02 detail rows
                    let dt02Rows: { maCP: string; noiDung: string; giaTri: number }[] = []
                    try {
                      const parsed = est.dt02Detail ? JSON.parse(String(est.dt02Detail)) : null
                      if (Array.isArray(parsed)) dt02Rows = parsed
                    } catch { /* ignore */ }

                    return (
                      <div>
                        {/* DT01: Project info */}
                        <div style={{ borderRadius: 8, border: '1px solid var(--border)', padding: '1rem', marginBottom: 12 }}>
                          <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: '#3b82f6' }}>DT01 — Thông tin chung dự án</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: '0.85rem' }}>
                            <div><span style={{ color: 'var(--text-muted)' }}>Mã dự án:</span> <strong>{task.project.projectCode}</strong></div>
                            <div><span style={{ color: 'var(--text-muted)' }}>Khách hàng:</span> <strong>{task.project.clientName}</strong></div>
                            <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--text-muted)' }}>Tên dự án:</span> <strong>{task.project.projectName}</strong></div>
                            {task.project.contractValue && <div><span style={{ color: 'var(--text-muted)' }}>Giá trị HĐ:</span> <strong style={{ color: '#059669' }}>{Number(task.project.contractValue).toLocaleString('vi-VN')} đ</strong></div>}
                            {task.project.productType && <div><span style={{ color: 'var(--text-muted)' }}>Sản phẩm:</span> {task.project.productType}</div>}
                          </div>
                        </div>

                        {/* DT02: Cost breakdown table */}
                        {totalEst > 0 ? (
                          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: '0.85rem' }}>
                            {[
                              { label: 'I. Chi phí vật tư', value: totalMat, color: '#e63946' },
                              { label: 'II. Chi phí nhân công', value: totalLab, color: '#f59e0b' },
                              { label: 'III. Chi phí dịch vụ', value: totalSvc, color: '#3b82f6' },
                              { label: 'IV. Chi phí chung', value: totalOvh, color: '#8b5cf6' },
                            ].map((item, i) => (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600 }}>{item.label}</span>
                                <span style={{ textAlign: 'right', fontWeight: 600, color: item.color }}>{fmtVND(item.value)}</span>
                                <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{pctEst(item.value)}</span>
                              </div>
                            ))}
                            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '10px 12px', background: 'var(--bg-secondary)', fontWeight: 700, fontSize: '0.95rem' }}>
                              <span>TỔNG CHI PHÍ</span>
                              <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{fmtVND(totalEst)}</span>
                              <span style={{ textAlign: 'right' }}>100%</span>
                            </div>
                            {contractVal > 0 && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderTop: '2px solid var(--border)' }}>
                                <span style={{ fontWeight: 600 }}>Lợi nhuận dự kiến</span>
                                <span style={{ textAlign: 'right', fontWeight: 700, color: profit >= 0 ? '#059669' : '#dc2626' }}>{fmtVND(Math.abs(profit))}</span>
                                <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{((profit / contractVal) * 100).toFixed(1)}%</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Chưa có dữ liệu tổng hợp chi phí từ P1.2
                          </div>
                        )}

                        {/* DT02 Detail breakdown (collapsible) */}
                        {dt02Rows.length > 0 && (
                          <details style={{ marginTop: 10 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              Chi tiết DT02 ({dt02Rows.length} dòng)
                            </summary>
                            <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: 6, fontSize: '0.8rem' }}>
                              {dt02Rows.map((row, i) => {
                                const isHeader = ['I', 'II', 'III', 'IV'].includes(row.maCP)
                                return (
                                  <div key={i} style={{
                                    display: 'grid', gridTemplateColumns: '60px 1fr 120px',
                                    padding: '4px 10px', borderBottom: '1px solid var(--border)',
                                    background: isHeader ? 'var(--bg-secondary)' : 'transparent',
                                    fontWeight: isHeader ? 700 : 400,
                                  }}>
                                    <span style={{ color: 'var(--text-muted)' }}>{row.maCP}</span>
                                    <span>{row.noiDung}</span>
                                    <span style={{ textAlign: 'right' }}>{row.giaTri > 0 ? Number(row.giaTri).toLocaleString('vi-VN') : ''}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </details>
                        )}

                        {/* File đính kèm from P1.2 */}
                        {est.estimateFileName ? (
                          <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.8rem' }}>
                            File dự toán: <strong>{String(est.estimateFileName)}</strong>
                          </div>
                        ) : null}
                      </div>
                    )
                  })() : (
                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu dự toán từ P1.2</div>
                  )}

                  {/* Estimate approve/reject buttons */}
                  {isActive && estimateDecision === 'pending' && previousStepData?.estimate && (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={async () => {
                          setEstimateDecision('approved')
                          await apiFetch(`/api/tasks/${taskId}`, {
                            method: 'PUT',
                            body: JSON.stringify({ action: 'save', resultData: { ...formData, estimateApproved: true, planApproved: planDecision === 'approved', checklist: checklistState } }),
                          })
                          setSuccessMsg('✅ Đã duyệt dự toán.')
                          setTimeout(() => setSuccessMsg(''), 3000)
                        }} disabled={submitting}
                          style={{ padding: '8px 20px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ✅ Duyệt dự toán
                        </button>
                        <button onClick={() => setShowEstimateReject(!showEstimateReject)} disabled={submitting}
                          style={{ padding: '8px 20px', background: 'transparent', color: '#dc2626', border: '1px solid #dc2626', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                          ❌ Từ chối dự toán
                        </button>
                      </div>
                      {showEstimateReject && (
                        <div style={{ marginTop: 10 }}>
                          <textarea value={estimateRejectReason} onChange={e => setEstimateRejectReason(e.target.value)}
                            placeholder="Nhập lý do từ chối dự toán..." rows={2}
                            style={{ width: '100%', borderRadius: 8, border: '1px solid #dc2626', padding: '0.5rem', fontSize: '0.85rem', resize: 'vertical', background: 'var(--bg-secondary)' }} />
                          <button onClick={async () => {
                            if (!estimateRejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return; }
                            setSubmitting(true)
                            try {
                              await apiFetch(`/api/tasks/${taskId}/reject`, {
                                method: 'POST',
                                body: JSON.stringify({ reason: estimateRejectReason, overrideRejectTo: 'P1.2' }),
                              })
                              setSuccessMsg('✅ Đã từ chối dự toán và đẩy lại về KTKH (P1.2)')
                              setTimeout(() => router.push('/dashboard/tasks'), 2000)
                            } catch { setError('Lỗi khi từ chối') }
                            setSubmitting(false)
                          }} disabled={submitting}
                            style={{ marginTop: 6, padding: '6px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                            ⚠️ Xác nhận từ chối dự toán → Gửi lại KTKH (P1.2)
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {estimateDecision === 'approved' && task?.resultData && Boolean((task.resultData as Record<string, unknown>).estimateApproved) && (
                    <div style={{ marginTop: 12, padding: '8px 16px', background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600 }}>
                      ✅ Dự toán đã được phê duyệt
                    </div>
                  )}
                </div>

                {/* P1.3: Complete button — only when BOTH plan + estimate approved */}
                {isActive && planDecision === 'approved' && estimateDecision === 'approved' && (
                  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', textAlign: 'center' }}>
                    <button onClick={() => handleSubmit('complete')} disabled={submitting}
                      style={{ padding: '12px 32px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: '1rem' }}>
                      {submitting ? '⏳ Đang xử lý...' : '✅ Hoàn thành phê duyệt (Kế hoạch + Dự toán)'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
            {/* P5.1: Fabrication Stages — interactive progress cards (ABOVE the form) */}
            {task.stepCode === 'P5.1' && (() => {
              const FAB_STAGES = [
                { key: 'CUT', label: 'Pha cắt', icon: '🔹' },
                { key: 'FIT', label: 'Gá lắp', icon: '🔹' },
                { key: 'WLD', label: 'Hàn', icon: '🔹' },
                { key: 'MCH', label: 'Gia công cơ khí', icon: '🔹' },
                { key: 'TRF', label: 'Xử lý bề mặt', icon: '🔹' },
                { key: 'FAT', label: 'Factory Acceptance Test', icon: '⭐' },
                { key: 'BLS', label: 'Bắn bi / Làm sạch', icon: '🔹' },
                { key: 'FPC', label: 'Sơn phủ', icon: '🔹' },
                { key: 'PCK', label: 'Đóng kiện (Ready to Ship)', icon: '🔹' },
              ]
              const calcTotal = (overrideKey?: string, overrideVal?: number) => {
                const total = FAB_STAGES.reduce((sum, s) => {
                  if (overrideKey && s.key === overrideKey) return sum + (overrideVal ?? 0)
                  const d = !!formData[`fab_${s.key}_done`]
                  return sum + (d ? 100 : Number(formData[`fab_${s.key}_progress`] || 0))
                }, 0)
                return Math.round(total / FAB_STAGES.length)
              }
              return (
                <div className="card" style={{ padding: '1.5rem' }}>
                  <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '2px solid #f59e0b', paddingBottom: 8, marginBottom: 16, color: '#f59e0b' }}>
                    🏭 Các công đoạn sản xuất
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {FAB_STAGES.map((stage, idx) => {
                      const isDone = !!formData[`fab_${stage.key}_done`]
                      const progress = isDone ? 100 : Number(formData[`fab_${stage.key}_progress`] || 0)
                      const progressColor = progress >= 100 ? '#16a34a' : progress > 0 ? '#f59e0b' : 'var(--text-muted)'
                      return (
                        <div key={stage.key} style={{
                          padding: '12px 16px', borderRadius: 10,
                          border: `1px solid ${isDone ? '#bbf7d0' : 'var(--border)'}`,
                          background: isDone ? '#f0fdf4' : 'var(--bg-secondary)',
                          transition: 'all 0.2s',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, width: 24 }}>{idx + 1}</span>
                            <span style={{ fontSize: '1rem' }}>{stage.icon}</span>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1 }}>
                              {stage.key} — {stage.label}
                            </span>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: isActive ? 'pointer' : 'default', fontSize: '0.8rem', fontWeight: 600, color: isDone ? '#16a34a' : 'var(--text-secondary)' }}>
                              <input type="checkbox" checked={isDone} disabled={!isActive}
                                onChange={() => {
                                  const newDone = !isDone
                                  handleFieldChange(`fab_${stage.key}_done`, newDone ? '1' : '')
                                  if (newDone) {
                                    handleFieldChange(`fab_${stage.key}_progress`, '100')
                                    if (!checklistState[`fab_${stage.key}`]) handleChecklistToggle(`fab_${stage.key}`)
                                  }
                                  handleFieldChange('fabricationProgress', String(calcTotal(stage.key, newDone ? 100 : 0)))
                                }}
                                style={{ accentColor: '#16a34a', width: 16, height: 16 }}
                              />
                              Hoàn thành
                            </label>
                          </div>
                          {!isDone && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10, paddingLeft: 34 }}>
                              <div>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>Tiến độ (%)</label>
                                <input className="input" type="number" min="0" max="100"
                                  value={formData[`fab_${stage.key}_progress`] as string || ''}
                                  disabled={!isActive}
                                  onChange={e => {
                                    handleFieldChange(`fab_${stage.key}_progress`, e.target.value)
                                    handleFieldChange('fabricationProgress', String(calcTotal(stage.key, Number(e.target.value) || 0)))
                                  }}
                                  placeholder="0"
                                  style={{ fontSize: '0.85rem', padding: '6px 8px', width: '100%' }}
                                />
                              </div>
                              <div>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 3 }}>KL hoàn thành</label>
                                <input className="input" type="text"
                                  value={formData[`fab_${stage.key}_qty`] as string || ''}
                                  disabled={!isActive}
                                  onChange={e => handleFieldChange(`fab_${stage.key}_qty`, e.target.value)}
                                  placeholder="VD: 500 kg"
                                  style={{ fontSize: '0.85rem', padding: '6px 8px', width: '100%' }}
                                />
                              </div>
                            </div>
                          )}
                          {isDone && (
                            <div style={{ marginTop: 6, paddingLeft: 34, fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
                              ✅ 100% — Hoàn thành {formData[`fab_${stage.key}_qty`] ? `(KL: ${formData[`fab_${stage.key}_qty`]})` : ''}
                            </div>
                          )}
                          <div style={{ marginTop: 6, paddingLeft: 34 }}>
                            <div style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${Math.min(progress, 100)}%`, background: progressColor, borderRadius: 2, transition: 'width 0.3s' }} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* P6.2: Budget from P1.2 estimates */}
            {task.stepCode === 'P6.2' && previousStepData?.budgetTotal != null && (() => {
              const budget = Number(previousStepData.budgetTotal || 0)
              return (
                <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid #3b82f6', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tổng dự toán từ P1.2 (DT03-DT07)</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#3b82f6', marginTop: 4 }}>{budget > 0 ? `${budget.toLocaleString('vi-VN')} đ` : 'Chưa có dữ liệu dự toán'}</div>
                  </div>
                  <div style={{ fontSize: '2rem' }}>💰</div>
                </div>
              )
            })()}

            {/* Form Fields — skip for steps with dynamic tables */}
            {!['P5.4', 'P1.2', 'P2.1A', 'P2.1B', 'P2.1C', 'P2.4', 'P3.3', 'P3.4'].includes(task.stepCode) && (
            <div className="card" style={{ padding: '1.5rem', marginTop: task.stepCode === 'P5.1' ? '1rem' : undefined }}>
              <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, marginBottom: 16 }}>
                📝 Thông tin nhập liệu
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                {config.fields.map(field => {
                  const isAutoCalc = task.stepCode === 'P5.1' && field.key === 'fabricationProgress'
                  // P6.2: auto-calc fields
                  const isP62Total = task.stepCode === 'P6.2' && field.key === 'totalActualCost'
                  const isP62Variance = task.stepCode === 'P6.2' && field.key === 'costVariance'
                  const isP62CostField = task.stepCode === 'P6.2' && ['actualMaterialCost', 'actualLaborCost', 'actualOutsourceCost', 'actualOverhead'].includes(field.key)
                  // P6.3: auto-calc fields
                  const isP63Profit = task.stepCode === 'P6.3' && field.key === 'grossProfit'
                  const isP63Margin = task.stepCode === 'P6.3' && field.key === 'profitMargin'
                  const isReadonlyCalc = isAutoCalc || isP62Total || isP62Variance || isP63Profit || isP63Margin

                  // P6.2 auto-calc helper
                  const calcP62 = (overrideKey?: string, overrideVal?: string) => {
                    const keys = ['actualMaterialCost', 'actualLaborCost', 'actualOutsourceCost', 'actualOverhead']
                    const total = keys.reduce((sum, k) => {
                      const v = k === overrideKey ? overrideVal : formData[k] as string
                      return sum + (Number(String(v || '0').replace(/[,.]/g, '')) || 0)
                    }, 0)
                    handleFieldChange('totalActualCost', String(total))
                    const budget = Number(previousStepData?.budgetTotal || 0)
                    if (budget > 0) {
                      const variance = ((total - budget) / budget * 100).toFixed(1)
                      handleFieldChange('costVariance', variance)
                    }
                  }
                  // P6.3 auto-calc helper
                  const calcP63 = (overrideKey?: string, overrideVal?: string) => {
                    const rev = Number(String((overrideKey === 'totalRevenue' ? overrideVal : formData.totalRevenue) || '0').replace(/[,.]/g, '')) || 0
                    const cost = Number(String((overrideKey === 'totalCost' ? overrideVal : formData.totalCost) || '0').replace(/[,.]/g, '')) || 0
                    const profit = rev - cost
                    handleFieldChange('grossProfit', String(profit))
                    if (rev > 0) handleFieldChange('profitMargin', ((profit / rev) * 100).toFixed(1))
                  }

                  // Display value for auto-calc fields
                  const getCalcDisplay = () => {
                    if (isP62Total) {
                      const v = Number(formData.totalActualCost || 0)
                      return v ? `${v.toLocaleString('vi-VN')} đ` : '—'
                    }
                    if (isP62Variance) {
                      const v = Number(formData.costVariance || 0)
                      return v ? `${v > 0 ? '+' : ''}${v}%` : '—'
                    }
                    if (isP63Profit) {
                      const v = Number(formData.grossProfit || 0)
                      return v ? `${v.toLocaleString('vi-VN')} đ` : '—'
                    }
                    if (isP63Margin) {
                      const v = Number(formData.profitMargin || 0)
                      return v ? `${v}%` : '—'
                    }
                    return `${formData.fabricationProgress || 0}%`
                  }
                  const getCalcColor = () => {
                    if (isP62Variance) {
                      const v = Number(formData.costVariance || 0)
                      return v > 5 ? '#dc2626' : v > 0 ? '#f59e0b' : '#16a34a'
                    }
                    if (isP63Margin) {
                      const v = Number(formData.profitMargin || 0)
                      return v >= 10 ? '#16a34a' : v >= 0 ? '#f59e0b' : '#dc2626'
                    }
                    if (isAutoCalc) return Number(formData.fabricationProgress || 0) >= 100 ? '#16a34a' : '#f59e0b'
                    return 'var(--text-primary)'
                  }

                  return field.type === 'section' ? (
                    <div key={field.key} style={{
                      gridColumn: '1 / -1', marginTop: 12, paddingBottom: 6,
                      borderBottom: '2px solid var(--accent-light, #c7d2fe)',
                    }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)' }}>
                        {field.label}
                      </span>
                    </div>
                  ) : (
                    <div key={field.key} style={{ gridColumn: field.fullWidth ? '1 / -1' : undefined }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>
                        {field.label} {field.required && <span style={{ color: '#e74c3c' }}>*</span>}
                        {isReadonlyCalc && <span style={{ fontSize: '0.7rem', color: '#f59e0b', marginLeft: 6 }}>(tự động tính)</span>}
                      </label>
                      {isReadonlyCalc ? (
                        <div style={{ padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)', fontSize: '1.1rem', fontWeight: 700, color: getCalcColor() }}>
                          {getCalcDisplay()}
                        </div>
                      ) : isP62CostField ? (
                        renderField(field, formData[field.key] ?? '', (v) => {
                          handleFieldChange(field.key, v)
                          setTimeout(() => calcP62(field.key, v as string), 50)
                        }, isActive)
                      ) : (task.stepCode === 'P6.3' && (field.key === 'totalRevenue' || field.key === 'totalCost')) ? (
                        renderField(field, formData[field.key] ?? '', (v) => {
                          handleFieldChange(field.key, v)
                          setTimeout(() => calcP63(field.key, v as string), 50)
                        }, isActive)
                      ) : (
                        renderField(field, formData[field.key] ?? '', (v) => handleFieldChange(field.key, v), isActive)
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            )}

            {/* P5.2: Auto-display P5.1 job card total progress */}
            {task.stepCode === 'P5.2' && previousStepData?.jobCardData && (() => {
              const jc = previousStepData.jobCardData as Record<string, string>
              const totalProgress = Number(jc.fabricationProgress || 0)
              const jobCode = jc.jobCardCode || '—'
              const FAB_KEYS = ['CUT','FIT','WLD','MCH','TRF','FAT','BLS','FPC','PCK']
              const allQty = FAB_KEYS.map(k => jc[`fab_${k}_qty`] || '').filter(Boolean)
              const totalQty = allQty.join(', ')
              return (
                <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Job Card từ P5.1</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: 2 }}>📋 {jobCode}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: totalProgress >= 100 ? '#16a34a' : '#f59e0b' }}>{totalProgress}%</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Tiến độ SX</div>
                  </div>
                  {totalQty && (
                    <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', paddingLeft: 16 }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>{totalQty}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>KL tổng</div>
                    </div>
                  )}
                  <div style={{ width: 80 }}>
                    <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(totalProgress, 100)}%`, background: totalProgress >= 100 ? '#16a34a' : '#f59e0b', borderRadius: 3 }} />
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* P1.2: Estimate Summary (upload Excel → show DT02 summary) */}
            {task.stepCode === 'P1.2' && (() => {
              const fmt = (v: number) => v > 0 ? v.toLocaleString('vi-VN') + ' đ' : '—'
              const contractVal = Number(task.project?.contractValue) || 0
              const totalMat = Number(formData.totalMaterial) || 0
              const totalLab = Number(formData.totalLabor) || 0
              const totalSvc = Number(formData.totalService) || 0
              const totalOvh = Number(formData.totalOverhead) || 0
              const totalEst = Number(formData.totalEstimate) || 0
              const profit = contractVal - totalEst
              const pct = (v: number) => totalEst > 0 ? ((v / totalEst) * 100).toFixed(1) + '%' : '—'
              const hasData = totalEst > 0

              // Parse DT02 detail rows if available
              let dt02Rows: { maCP: string; noiDung: string; giaTri: number }[] = []
              try {
                const parsed = formData.dt02Detail ? JSON.parse(String(formData.dt02Detail)) : null
                if (Array.isArray(parsed)) dt02Rows = parsed
              } catch { /* ignore */ }

              // ── Import Excel: parse DT02 summary → store totals in formData ──
              const importEstimateExcel = () => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = '.xlsx,.xls'
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = (evt) => {
                    const wb = XLSX.read(evt.target?.result, { type: 'binary' })
                    const sheetNames = wb.SheetNames

                    // Find DT02 sheet (contains "DT02" or "TH")
                    const dt02Name = sheetNames.find(s => s.toLowerCase().includes('dt02'))
                    if (!dt02Name) {
                      setError('Không tìm thấy sheet DT02 trong file Excel.')
                      return
                    }

                    const ws = wb.Sheets[dt02Name]
                    const data: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })

                    // Parse DT02: find rows with Roman numerals I-IV for main categories
                    let matTotal = 0, labTotal = 0, svcTotal = 0, ovhTotal = 0, grandTotal = 0
                    const detailRows: { maCP: string; noiDung: string; giaTri: number }[] = []

                    for (const row of data) {
                      if (!row || row.length < 4) continue
                      const stt = String(row[0] || '').trim()
                      const content = String(row[2] || '').trim()
                      const value = Number(row[3]) || 0

                      if (stt === 'I') { matTotal = value; detailRows.push({ maCP: 'I', noiDung: content || 'Chi phí vật tư', giaTri: value }) }
                      else if (stt === 'II') { labTotal = value; detailRows.push({ maCP: 'II', noiDung: content || 'Chi phí nhân công', giaTri: value }) }
                      else if (stt === 'III') { svcTotal = value; detailRows.push({ maCP: 'III', noiDung: content || 'Chi phí dịch vụ', giaTri: value }) }
                      else if (stt === 'IV') { ovhTotal = value; detailRows.push({ maCP: 'IV', noiDung: content || 'Chi phí chung', giaTri: value }) }

                      // Sub-items (numeric STT under each category)
                      if (/^\d+$/.test(stt) && value > 0) {
                        const maCP = String(row[1] || stt)
                        detailRows.push({ maCP, noiDung: content, giaTri: value })
                      }
                    }

                    // Find grand total row
                    for (const row of data) {
                      if (!row) continue
                      const content = String(row[2] || '').toLowerCase()
                      if (content.includes('tổng hợp') || content.includes('tổng chi phí')) {
                        grandTotal = Number(row[3]) || 0
                      }
                    }
                    if (!grandTotal) grandTotal = matTotal + labTotal + svcTotal + ovhTotal

                    if (grandTotal > 0) {
                      // Store summary values using functional updates
                      setFormData(prev => ({
                        ...prev,
                        totalMaterial: matTotal,
                        totalLabor: labTotal,
                        totalService: svcTotal,
                        totalOverhead: ovhTotal,
                        totalEstimate: grandTotal,
                        dt02Detail: JSON.stringify(detailRows),
                        estimateFileName: file.name,
                      }))
                      setSuccessMsg(`✅ Đã import dự toán: ${fmt(grandTotal)} từ ${sheetNames.length} sheets`)
                      setTimeout(() => setSuccessMsg(''), 4000)
                    } else {
                      setError('Không đọc được dữ liệu DT02. Kiểm tra file Excel có đúng định dạng.')
                    }
                  }
                  reader.readAsBinaryString(file)
                }
                input.click()
              }

              // ── Export template (8-sheet Excel) ──
              const exportTemplate = () => {
                const wb = XLSX.utils.book_new()
                const projectCode = task.project?.projectCode || 'PROJECT'

                // Cover
                const coverData = [
                  ['CÔNG TY CỔ PHẦN KẾT CẤU THÉP IBS'], [], [],
                  ['DỰ TOÁN THI CÔNG'], [],
                  ['Mã dự án', projectCode],
                  ['Khách hàng', task.project?.clientName || ''],
                  ['Tên dự án', task.project?.projectName || ''],
                ]
                const wsCover = XLSX.utils.aoa_to_sheet(coverData)
                wsCover['!cols'] = [{ wch: 20 }, { wch: 40 }]
                XLSX.utils.book_append_sheet(wb, wsCover, '+Cover')

                // DT01
                const dt01Data = [
                  ['DT01 — THÔNG TIN CHUNG DỰ ÁN'], [],
                  ['STT', 'Dữ liệu', 'Thông tin', 'Ghi chú'],
                  ['A', 'THÔNG TIN CHUNG'],
                  [1, 'Khách hàng', task.project?.clientName || ''],
                  [2, 'Tên dự án', task.project?.projectName || ''],
                  [3, 'Mã dự án', projectCode],
                  [4, 'Giá trị HĐ', contractVal],
                ]
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dt01Data), 'DT01 (TTC)')

                // DT02
                const dt02Data = [
                  ['TỔNG HỢP DỰ TOÁN CHI PHÍ THI CÔNG'], [],
                  ['STT', 'Mã CP', 'Nội dung chi phí', 'Giá trị', 'Tỷ lệ'],
                  ['I', '', 'Chi phí vật tư', '', ''],
                  ['II', '', 'Chi phí nhân công trực tiếp', '', ''],
                  ['III', '', 'Chi phí dịch vụ thuê ngoài', '', ''],
                  ['IV', '', 'Chi phí chung', '', ''],
                  [], ['', '', 'TỔNG HỢP CHI PHÍ', '=SUM(D4:D7)', ''],
                ]
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dt02Data), 'DT02 (TH)')

                // DT03-DT07 (empty templates with headers)
                const sheets: [string, string, string[]][] = [
                  ['DT03 (VT)', 'DỰ TOÁN CHI PHÍ VẬT TƯ', ['STT', 'Nhóm vật tư', 'Danh mục vật tư', 'Đơn vị tính', 'Khối lượng/ Số lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
                  ['DT04 (VT)', 'BẢNG DỰ TOÁN CHI TIẾT VẬT TƯ', ['STT', 'Nhóm vật tư', 'Mã vật tư', 'Danh mục vật tư', 'Đơn vị tính', 'Mác vật liệu', 'Quy cách', '', '', 'Khối lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
                  ['DT05 (DV)', 'DỰ TOÁN CHI PHÍ DỊCH VỤ', ['STT', 'Mã CP', 'NỘI DUNG CÔNG VIỆC', 'Đơn vị tính', 'Khối lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
                  ['DT06 (NC)', 'DỰ TOÁN CHI PHÍ NHÂN CÔNG TRỰC TIẾP', ['STT', 'Mã CP', 'NỘI DUNG CÔNG VIỆC', 'Đơn vị tính', 'Khối lượng', 'Đơn giá (vnd)', 'Thành tiền (vnd)']],
                  ['DT07 (CPC)', 'DỰ TOÁN CHI PHÍ CHUNG, CHI PHÍ TÀI CHÍNH', ['STT', 'Mã CP', 'Danh mục chi phí', 'Đơn vị tính', 'Khối lượng', 'Đơn giá bình quân', 'Thành tiền']],
                ]
                sheets.forEach(([name, title, headers]) => {
                  const data = [[title], [], headers]
                  const ws = XLSX.utils.aoa_to_sheet(data)
                  ws['!cols'] = headers.map(h => ({ wch: Math.max(String(h).length + 4, 14) }))
                  XLSX.utils.book_append_sheet(wb, ws, name)
                })

                XLSX.writeFile(wb, `DuToan_Template_${projectCode}.xlsx`)
              }

              return (
                <>
                  {/* ── DT01: Thông tin dự án ── */}
                  <div className="card" style={{ padding: '1.25rem', marginBottom: '0.5rem', borderLeft: '4px solid #3b82f6' }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#3b82f6' }}>DT01 — Thông tin chung dự án</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: '0.85rem' }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>Mã dự án:</span> <strong>{task.project.projectCode}</strong></div>
                      <div><span style={{ color: 'var(--text-muted)' }}>Khách hàng:</span> <strong>{task.project.clientName}</strong></div>
                      <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--text-muted)' }}>Tên dự án:</span> <strong>{task.project.projectName}</strong></div>
                      {task.project.contractValue && <div><span style={{ color: 'var(--text-muted)' }}>Giá trị HĐ:</span> <strong style={{ color: '#059669' }}>{Number(task.project.contractValue).toLocaleString('vi-VN')} đ</strong></div>}
                      {task.project.productType && <div><span style={{ color: 'var(--text-muted)' }}>Sản phẩm:</span> {task.project.productType}</div>}
                      {task.project.startDate && <div><span style={{ color: 'var(--text-muted)' }}>Bắt đầu:</span> {new Date(task.project.startDate).toLocaleDateString('vi-VN')}</div>}
                      {task.project.endDate && <div><span style={{ color: 'var(--text-muted)' }}>Giao hàng:</span> {new Date(task.project.endDate).toLocaleDateString('vi-VN')}</div>}
                    </div>
                  </div>

                  {/* ── Excel Upload/Download ── */}
                  <div className="card" style={{ padding: '1.25rem', marginBottom: '0.5rem', borderLeft: '4px solid #7c3aed' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '0.95rem', color: '#7c3aed' }}>Excel Dự toán thi công</h3>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
                      Upload file Excel dự toán (8 sheets: Cover, DT01-DT07). Hệ thống tự động đọc DT02 để hiển thị tổng hợp chi phí.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" onClick={exportTemplate}
                        style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                        Tải Template Dự Toán
                      </button>
                      {isActive && (
                        <button type="button" onClick={importEstimateExcel}
                          style={{ flex: 1, padding: '10px 16px', fontSize: '0.85rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                        Upload Excel Dự Toán
                        </button>
                      )}
                    </div>
                    {formData.estimateFileName && (
                      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.8rem' }}>
                        File đã upload: <strong>{String(formData.estimateFileName)}</strong>
                      </div>
                    )}
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: '8px 0 0', fontStyle: 'italic' }}>
                      Đính kèm file gốc ở mục &quot;Tài liệu đính kèm&quot; bên dưới để lưu trữ.
                    </p>
                  </div>

                  {/* ── DT02: Tổng hợp chi phí (from parsed Excel) ── */}
                  <div className="card" style={{ padding: '1.25rem', marginTop: '0.5rem', borderLeft: '4px solid #059669' }}>
                    <h3 style={{ margin: '0 0 12px', fontSize: '0.95rem', color: '#059669' }}>DT02 — Tổng hợp dự toán chi phí</h3>
                    {!hasData ? (
                      <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Chưa có dữ liệu. Vui lòng upload file Excel dự toán.
                      </div>
                    ) : (
                      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', fontSize: '0.85rem' }}>
                        {[
                          { label: 'I. Chi phí vật tư', value: totalMat, color: '#e63946' },
                          { label: 'II. Chi phí nhân công', value: totalLab, color: '#f59e0b' },
                          { label: 'III. Chi phí dịch vụ', value: totalSvc, color: '#3b82f6' },
                          { label: 'IV. Chi phí chung', value: totalOvh, color: '#8b5cf6' },
                        ].map((item, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600 }}>{item.label}</span>
                            <span style={{ textAlign: 'right', fontWeight: 600, color: item.color }}>{fmt(item.value)}</span>
                            <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{pct(item.value)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '10px 12px', background: 'var(--bg-secondary)', fontWeight: 700, fontSize: '0.95rem' }}>
                          <span>TỔNG CHI PHÍ</span>
                          <span style={{ textAlign: 'right', color: 'var(--accent)' }}>{fmt(totalEst)}</span>
                          <span style={{ textAlign: 'right' }}>100%</span>
                        </div>
                        {contractVal > 0 && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 0.5fr', padding: '8px 12px', borderTop: '2px solid var(--border)' }}>
                            <span style={{ fontWeight: 600 }}>Lợi nhuận dự kiến</span>
                            <span style={{ textAlign: 'right', fontWeight: 700, color: profit >= 0 ? '#059669' : '#dc2626' }}>{fmt(profit)}</span>
                            <span style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{((profit / contractVal) * 100).toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* DT02 Detail breakdown (collapsible) */}
                    {dt02Rows.length > 0 && (
                      <details style={{ marginTop: 10 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          Chi tiết DT02 ({dt02Rows.length} dòng)
                        </summary>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', marginTop: 6, fontSize: '0.8rem' }}>
                          {dt02Rows.map((row, i) => {
                            const isHeader = ['I', 'II', 'III', 'IV'].includes(row.maCP)
                            return (
                              <div key={i} style={{
                                display: 'grid', gridTemplateColumns: '60px 1fr 120px',
                                padding: '4px 10px', borderBottom: '1px solid var(--border)',
                                background: isHeader ? 'var(--bg-secondary)' : 'transparent',
                                fontWeight: isHeader ? 700 : 400,
                              }}>
                                <span style={{ color: 'var(--text-muted)' }}>{row.maCP}</span>
                                <span>{row.noiDung}</span>
                                <span style={{ textAlign: 'right' }}>{row.giaTri > 0 ? Number(row.giaTri).toLocaleString('vi-VN') : ''}</span>
                              </div>
                            )
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                </>
              )
            })()}

                        {/* P1.2A: MOM Sections (BB họp triển khai) */}
            {task.stepCode === 'P1.2A' && (
              <MomSectionsUI
                isEditable={isActive}
                attendantsData={formData['momAttendants']}
                sectionsData={formData['momSections']}
                onAttendantsChange={(val) => handleFieldChange('momAttendants', val)}
                onSectionsChange={(val) => handleFieldChange('momSections', val)}
                onHeaderImport={(h) => {
                  Object.entries(h).forEach(([k, v]) => handleFieldChange(k, v))
                }}
              />
            )}

                        {/* P1.2A: Dynamic WBS Table UI */}
            {task.stepCode === 'P1.2A' && <WbsTableUI isWbsEditable={isActive} wbsItemsData={formData['wbsItems']} onChange={(val) => handleFieldChange('wbsItems', val)} />}


            {/* P3.1: Readonly WBS from P1.2A + Long-lead items form */}
            {task.stepCode === 'P3.1' && (() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const planData = (previousStepData as any)?.plan || {}
              let wbsRows: WbsRow[] = []
              try {
                const raw = planData.wbsItems
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
                if (Array.isArray(parsed)) wbsRows = parsed
              } catch { /* ignore */ }

              // Long-lead items dynamic form
              type LlItem = { material: string; dateNeeded: string; priority: string; note: string }
              const llKey = 'longLeadItems'
              const defaultLl: LlItem[] = [{ material: '', dateNeeded: '', priority: 'Cao', note: '' }]
              let llItems: LlItem[] = []
              try { const p = formData[llKey] ? JSON.parse(formData[llKey] as string) : null; llItems = (Array.isArray(p) && p.length > 0) ? p : defaultLl } catch { llItems = defaultLl }
              const saveLl = (next: LlItem[]) => handleFieldChange(llKey, JSON.stringify(next))
              const addLl = () => saveLl([...llItems, { material: '', dateNeeded: '', priority: 'Cao', note: '' }])
              const removeLl = (i: number) => saveLl(llItems.filter((_, idx) => idx !== i))
              const updateLl = (i: number, key: string, val: string) => { const n = [...llItems]; n[i] = { ...n[i], [key]: val } as LlItem; saveLl(n) }

              const priorityColors: Record<string, string> = { 'Cao': '#dc2626', 'Trung bình': '#f59e0b', 'Thấp': '#10b981' }

              return (
                <>
                  {/* P3.1: Unified WBS Table UI */}
                  <div style={{ width: '100%', marginTop: '1rem' }}>
                    <WbsTableUI isWbsEditable={false} wbsItemsData={wbsRows} />
                  </div>

                  {/* Long-lead items form */}
                  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid #dc2626' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1rem', color: '#dc2626' }}>🔴 Danh sách vật tư Long-Lead cần ưu tiên</h3>
                        <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Xác định vật tư cần đặt gấp, ngày cần có, mức ưu tiên</p>
                      </div>
                      {isActive && (
                        <button type="button" onClick={addLl}
                          style={{ padding: '5px 14px', fontSize: '0.78rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                          + Thêm
                        </button>
                      )}
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      {/* Header */}
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 120px 100px 1.5fr' + (isActive ? ' 28px' : ''), gap: 0, padding: '6px 8px', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)' }}>
                        {['Tên vật tư / Hạng mục', 'Ngày cần có', 'Ưu tiên', 'Ghi chú'].map(h => (
                          <span key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>{h}</span>
                        ))}
                        {isActive && <span />}
                      </div>
                      {/* Rows */}
                      {llItems.map((item, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 120px 100px 1.5fr' + (isActive ? ' 28px' : ''), gap: 0, padding: '4px 8px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                          <input className="input" value={item.material} disabled={!isActive}
                            onChange={e => updateLl(i, 'material', e.target.value)} placeholder="VD: Thép tấm SS400, Q345B..."
                            style={{ fontSize: '0.78rem', padding: '4px 8px', width: '100%' }} />
                          <input type="date" className="input" value={item.dateNeeded} disabled={!isActive}
                            onChange={e => updateLl(i, 'dateNeeded', e.target.value)}
                            style={{ fontSize: '0.72rem', padding: '3px 4px', width: '100%' }} />
                          <select className="input" value={item.priority} disabled={!isActive}
                            onChange={e => updateLl(i, 'priority', e.target.value)}
                            style={{ fontSize: '0.72rem', padding: '3px 4px', width: '100%', color: priorityColors[item.priority] || '#333', fontWeight: 600 }}>
                            <option value="Cao">🔴 Cao</option>
                            <option value="Trung bình">🟡 TB</option>
                            <option value="Thấp">🟢 Thấp</option>
                          </select>
                          <input className="input" value={item.note} disabled={!isActive}
                            onChange={e => updateLl(i, 'note', e.target.value)} placeholder="Ghi chú..."
                            style={{ fontSize: '0.75rem', padding: '4px 8px', width: '100%' }} />
                          {isActive && (
                            <button type="button" onClick={() => removeLl(i)}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, padding: 0 }}>×</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{llItems.length} vật tư long-lead</div>
                  </div>
                </>
              )
            })()}

            {/* P1.2/P2.1A/P2.4: Dynamic Estimate Tables */}
            {['P1.2', 'P2.1A', 'P2.1B', 'P2.1C', 'P2.4'].includes(task.stepCode) && (() => {
              const getInheritedEstRows = (key: string, baseDefault: any[]) => {
                if (task.stepCode !== 'P2.4' || !previousStepData?.estimate) return baseDefault
                try {
                  const raw = previousStepData.estimate[key]
                  if (!raw) return baseDefault
                  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
                  return (Array.isArray(parsed) && parsed.length > 0) ? parsed : baseDefault
                } catch { return baseDefault }
              }
              type EstRow = Record<string, string>
              const renderEstTable = (
                title: string, code: string, dataKey: string,
                columns: { key: string; label: string; type?: string; width?: string }[],
                defaultRows: EstRow[]
              ) => {
                let rows: EstRow[] = []
                try { const p = formData[dataKey] ? JSON.parse(formData[dataKey] as string) : null; rows = (Array.isArray(p) && p.length > 0) ? p : defaultRows } catch { rows = defaultRows }
                const save = (next: EstRow[]) => handleFieldChange(dataKey, JSON.stringify(next))
                const addRow = () => save([...rows, Object.fromEntries(columns.map(c => [c.key, '']))])
                const removeRow = (i: number) => save(rows.filter((_, idx) => idx !== i))
                const update = (i: number, key: string, val: string) => { const n = [...rows]; n[i] = { ...n[i], [key]: val }; save(n) }
                
                const exportEstExcel = () => {
                  const headers = ['STT', ...columns.map(c => c.label)]
                  const data = rows.map((r, i) => [i + 1, ...columns.map(c => r[c.key] || '')])
                  const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
                  const wb = XLSX.utils.book_new()
                  XLSX.utils.book_append_sheet(wb, ws, code)
                  XLSX.writeFile(wb, `${code}_${task?.project?.projectCode || 'P2'}.xlsx`)
                }

                const importEstExcel = () => {
                  const input = document.createElement('input')
                  input.type = 'file'
                  input.accept = '.xlsx,.xls,.csv'
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = (evt) => {
                      const wb = XLSX.read(evt.target?.result, { type: 'binary' })
                      const ws = wb.Sheets[wb.SheetNames[0]]
                      const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })
                      if (jsonData.length < 2) return
                      const headerRow = jsonData[0].map(h => String(h || '').trim().toLowerCase())
                      const colMapping = headerRow.map(h => {
                        const col = columns.find(c => c.label.toLowerCase() === h)
                        return col ? col.key : ''
                      })
                      const imported: EstRow[] = []
                      for (let i = 1; i < jsonData.length; i++) {
                        const rowData = jsonData[i]
                        if (!rowData || rowData.every(c => !c)) continue
                        const newRow: EstRow = Object.fromEntries(columns.map(c => [c.key, '']))
                        colMapping.forEach((key, ci) => {
                          if (key && rowData[ci] != null) newRow[key] = String(rowData[ci])
                        })
                        if (Object.values(newRow).some(v => String(v).trim())) imported.push(newRow)
                      }
                      if (imported.length > 0) {
                        save([...rows, ...imported])
                        setSuccessMsg(`✅ Đã import ${imported.length} mục cho ${code}`)
                        setTimeout(() => setSuccessMsg(''), 3000)
                      }
                    }
                    reader.readAsBinaryString(file)
                  }
                  input.click()
                }

                return (
                  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid var(--accent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent)' }}>{title}</h3>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" onClick={exportEstExcel}
                          style={{ padding: '4px 12px', fontSize: '0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                          📥 Export
                        </button>
                        {isActive && (
                          <button type="button" onClick={importEstExcel}
                            style={{ padding: '4px 12px', fontSize: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                            📤 Import Excel
                          </button>
                        )}
                        {isActive && (
                          <button type="button" onClick={addRow}
                            style={{ padding: '4px 12px', fontSize: '0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                            + Thêm
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')} ${isActive ? '28px' : ''}`, gap: 4, padding: '6px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>#</span>
                        {columns.map(c => (
                          <span key={c.key} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>{c.label}</span>
                        ))}
                        {isActive && <span />}
                      </div>
                      {rows.map((row, ri) => (
                        <div key={ri} style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')} ${isActive ? '28px' : ''}`, gap: 4, padding: '3px 8px', borderBottom: ri < rows.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ri + 1}</span>
                          {columns.map(c => {
                            if (c.key.toLowerCase() === 'dvt') {
                              return (
                                <select key={c.key} className="input" value={row[c.key] || ''} disabled={!isActive}
                                  onChange={e => update(ri, c.key, e.target.value)}
                                  style={{ fontSize: '0.75rem', padding: '3px 2px' }}>
                                  <option value="">-Chọn-</option>
                                  <option value="kg">kg</option>
                                  <option value="tấn">tấn</option>
                                  <option value="m">m</option>
                                  <option value="m2">m2</option>
                                  <option value="m3">m3</option>
                                  <option value="cái">cái</option>
                                  <option value="bộ">bộ</option>
                                  <option value="lít">lít</option>
                                  <option value="tháng">tháng</option>
                                  <option value="ngày">ngày</option>
                                  <option value="giờ">giờ</option>
                                  <option value="lóng">lóng</option>
                                  <option value="tấm">tấm</option>
                                  <option value="thanh">thanh</option>
                                  <option value="ống">ống</option>
                                </select>
                              )
                            }
                            const isNumber = c.type === 'number' || ['kl', 'sl', 'dongia', 'thanhtien'].includes(c.key.toLowerCase())
                            return (
                              <input key={c.key} type={isNumber ? 'number' : 'text'} className="input" value={row[c.key] || ''} disabled={!isActive}
                                onChange={e => update(ri, c.key, e.target.value)}
                                placeholder={c.label}
                                style={{ fontSize: '0.75rem', padding: '3px 6px', textAlign: isNumber ? 'right' : 'left' }} />
                            )
                          })}
                          {isActive && rows.length > 1 && (
                            <button type="button" onClick={() => removeRow(ri)}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, padding: 0 }}>−</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rows.length} dòng</div>
                  </div>
                )
              }

              const colsVTTH = [
                { key: 'nhomVT', label: 'Nhóm VT', width: '0.8fr' },
                { key: 'danhMuc', label: 'Danh mục VT', width: '1.5fr' },
                { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                { key: 'kl', label: 'KL/SL', type: 'number', width: '0.6fr' },
                { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.8fr' },
                { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.8fr' },
              ]
              const colsVTCT = [
                { key: 'maVT', label: 'Mã VT', width: '0.7fr' },
                { key: 'tenVT', label: 'Tên VT', width: '1.2fr' },
                { key: 'macVL', label: 'Mác VL', width: '0.6fr' },
                { key: 'quyCach', label: 'Quy cách', width: '0.7fr' },
                { key: 'dvt', label: 'ĐVT', width: '0.4fr' },
                { key: 'kl', label: 'KL/SL', type: 'number', width: '0.5fr' },
                { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
                { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
              ]
              const colsDV = [
                { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                { key: 'noiDung', label: 'Nội dung công việc', width: '1.5fr' },
                { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
                { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
                { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
              ]
              const colsNC = colsDV // Same columns for nhân công
              const colsCPChung = [
                { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                { key: 'danhMuc', label: 'Danh mục chi phí', width: '1.5fr' },
                { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
                { key: 'donGia', label: 'Đơn giá BQ', type: 'number', width: '0.7fr' },
                { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
              ]

              // ── P2.1A: TCKT (DT02 + DT07) ──
              if (task.stepCode === 'P2.1A') return (
                <>
                  {siblingFiles?.['file_contract'] && (
                    <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', borderLeft: '4px solid #f59e0b' }}>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#d97706', marginBottom: 12 }}>
                        📄 Hợp đồng dự án (Từ bước P1.1B)
                      </h3>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <a href={siblingFiles['file_contract'] as string} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>
                          ⬇️ {decodeURIComponent((siblingFiles['file_contract'] as string).split('/').pop() || 'Hợp đồng').replace(/^file_contract_?/, '')}
                        </a>
                      </div>
                    </div>
                  )}
                  {renderEstTable('📊 DT02 — Tổng hợp dự toán thi công', 'QT30-DT02', 'dt02Items',
                    [
                      { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                      { key: 'noiDung', label: 'Nội dung chi phí', width: '1.5fr' },
                      { key: 'giaTri', label: 'Giá trị', type: 'number', width: '0.8fr' },
                      { key: 'tyLe', label: 'Tỷ lệ %', type: 'number', width: '0.5fr' },
                    ],
                    [
                      { maCP: 'I', noiDung: 'Chi phí vật tư', giaTri: '', tyLe: '' },
                      { maCP: 'II', noiDung: 'Chi phí nhân công khoán', giaTri: '', tyLe: '' },
                      { maCP: 'III', noiDung: 'Chi phí dịch vụ thuê ngoài', giaTri: '', tyLe: '' },
                      { maCP: 'IV', noiDung: 'Chi phí chung phục vụ SX', giaTri: '', tyLe: '' },
                      { maCP: 'V', noiDung: 'Chi phí tài chính', giaTri: '', tyLe: '' },
                      { maCP: 'VI', noiDung: 'Chi phí quản lý', giaTri: '', tyLe: '' },
                      { maCP: 'VII', noiDung: 'Chi phí dự phòng', giaTri: '', tyLe: '' },
                    ]
                  )}
                  {renderEstTable('🏢 DT07 — Chi phí chung, chi phí tài chính', 'QT30-DT07', 'dt07Items', colsCPChung,
                    [
                      { maCP: 'CPC', danhMuc: 'I. Chi phí chung phục vụ sản xuất', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-01', danhMuc: 'Nhân công (ngoài khoán)', dvt: 'Người', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-02', danhMuc: 'Thuê công nhân thời vụ', dvt: 'Người', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-03', danhMuc: 'Khấu hao TSCĐ', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-04', danhMuc: 'Sửa chữa máy móc thiết bị', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-05', danhMuc: 'Điện sản xuất', dvt: 'kWh', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-06', danhMuc: 'Nước sản xuất', dvt: 'm³', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-07', danhMuc: 'Khí nén (Oxy, Acetylen…)', dvt: 'Chai', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-08', danhMuc: 'Nhiên liệu (dầu, xăng)', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-09', danhMuc: 'Chi phí an toàn lao động', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CPC-10', danhMuc: 'Chi phí SX khác', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CTC', danhMuc: 'II. Chi phí tài chính', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CTC-01', danhMuc: 'Phí bảo lãnh thực hiện HĐ', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CTC-02', danhMuc: 'Phí bảo lãnh tạm ứng', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CTC-03', danhMuc: 'Phí bảo lãnh bảo hành', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CTC-04', danhMuc: 'Lãi vay ngân hàng', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CTC-05', danhMuc: 'Bảo hiểm dự án', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CQL', danhMuc: 'III. Chi phí Quản Lý', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CQL-01', danhMuc: 'Lương nhân viên gián tiếp', dvt: 'Người', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CQL-02', danhMuc: 'Văn phòng phẩm', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CQL-03', danhMuc: 'Bảo vệ, an ninh', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CQL-04', danhMuc: 'Chi phí tiếp khách', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'CQL-05', danhMuc: 'Chi phí quản lý khác', dvt: '', kl: '', donGia: '', thanhTien: '' },
                    ]
                  )}
                </>
              )

              // ── P2.1B: TM (DT03 + DT04 + DT05) ──
              if (task.stepCode === 'P2.1B') return (
                <>
                  {renderEstTable('📦 DT03 — Dự toán chi phí VT tổng hợp', 'QT30-DT03', 'dt03Items', colsVTTH,
                    [
                      { nhomVT: 'VTC', danhMuc: 'Vật tư chính', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTC-01', danhMuc: 'Thép đen các loại', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTC-02', danhMuc: 'Inox các loại', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTC-03', danhMuc: 'Grating', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTP', danhMuc: 'Vật tư phụ', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTPCK', danhMuc: 'Vật tư phụ kiện, bu lông…', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTDK', danhMuc: 'Vật tư đóng kiện', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTBP', danhMuc: 'Vật tư làm biện pháp', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTBP-01', danhMuc: 'Thép đen các loại (biện pháp)', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTBP-TH', danhMuc: 'Thu hồi lại vật tư biện pháp (75% giá trị)', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTTH', danhMuc: 'Vật tư tiêu hao', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTTH-01', danhMuc: 'Que hàn các loại', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTTH-02', danhMuc: 'Dây hàn', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTTH-03', danhMuc: 'Khí hàn (Argon, CO2…)', dvt: 'Chai', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTTH-04', danhMuc: 'Đá cắt, đá mài', dvt: 'Viên', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTS', danhMuc: 'Vật tư sơn', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTS-01', danhMuc: 'Sơn lót', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTS-02', danhMuc: 'Sơn phủ', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTS-03', danhMuc: 'Dung môi, phụ gia sơn', dvt: 'Lít', kl: '', donGia: '', thanhTien: '' },
                      { nhomVT: 'VTDP', danhMuc: 'Vật tư dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
                    ]
                  )}
                  {renderEstTable('📋 DT04 — Dự toán chi tiết VT', 'QT30-DT04', 'dt04Items', colsVTCT,
                    [
                      { maVT: 'A', tenVT: 'VTC — Vật tư chính', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: 'A2', tenVT: 'Vật tư còn lại (chưa có chi tiết)', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: 'B', tenVT: 'VT04 — Vật tư phụ kiện, bu lông…', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: 'C', tenVT: 'VTDK — Vật tư đóng kiện', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: 'D', tenVT: 'VTBP — Vật tư làm biện pháp', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: 'E', tenVT: 'VTTH — Vật tư tiêu hao', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: 'F', tenVT: 'VTDP — Vật tư dự phòng', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' },
                    ]
                  )}
                  {renderEstTable('🔧 DT05 — Dự toán chi phí dịch vụ', 'QT30-DT05', 'dt05Items', colsDV,
                    [
                      { maCP: 'A', noiDung: 'VẬN TẢI', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'A-01', noiDung: 'Vận chuyển nội bộ', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'A-02', noiDung: 'Vận chuyển giao hàng', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B', noiDung: 'NDT, QUY TRÌNH VÀ THÍ NGHIỆM', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-01', noiDung: 'Chụp phim RT', dvt: 'Phim', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-02', noiDung: 'Siêu âm UT', dvt: 'Mối', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-03', noiDung: 'Kiểm tra PT/MT', dvt: 'Mối', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-04', noiDung: 'Thử áp lực (Hydro test)', dvt: 'Lần', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C', noiDung: 'MẠ KẼM', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-01', noiDung: 'Mạ kẽm nhúng nóng', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'D', noiDung: 'CÁC CHI PHÍ KHÁC', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'D-01', noiDung: 'Chi phí dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
                    ]
                  )}
                </>
              )

              // ── P2.1C: SX (DT06) ──
              if (task.stepCode === 'P2.1C') return (
                <>
                  {renderEstTable('👷 DT06 — Dự toán chi phí nhân công trực tiếp', 'QT30-DT06', 'dt06Items', colsNC,
                    [
                      { maCP: 'A', noiDung: 'PC — PHA CẮT', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'A-01', noiDung: 'Pha cắt thép tấm', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'A-02', noiDung: 'Pha cắt thép hình', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'A-03', noiDung: 'Pha cắt ống', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B', noiDung: 'GC — GIA CÔNG', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-01', noiDung: 'Gia công CNC / Plasma', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-02', noiDung: 'Uốn, dập, khoan, tiện', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'B-03', noiDung: 'Vát mép, chuẩn bị mối hàn', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C', noiDung: 'CT — CHẾ TẠO', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-01', noiDung: 'Chế tạo - Roller frame', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-02', noiDung: 'Chế tạo - Slewing frame', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-03', noiDung: 'Chế tạo - Platform / Sàn', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-04', noiDung: 'Chế tạo - Lan can', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-05', noiDung: 'Chế tạo - Giá đỡ', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-06', noiDung: 'Chế tạo - Ống', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-07', noiDung: 'Chế tạo - Hộp', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-08', noiDung: 'Chế tạo - Cầu thang', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'C-09', noiDung: 'Chế tạo - Khác', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'D', noiDung: 'KK — KHUNG KIỆN', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'D-01', noiDung: 'Khung kiện', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'E', noiDung: 'TH — TỔ HỢP SẢN PHẨM', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'E-01', noiDung: 'Tổ hợp sản phẩm', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'F', noiDung: 'LD — LẮP DỰNG + NGHIỆM THU', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'F-01', noiDung: 'Lắp dựng + Nghiệm thu', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'G', noiDung: 'VS — VỆ SINH HỢP KIM', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'G-01', noiDung: 'Vệ sinh VL hợp kim bằng dung dịch', dvt: 'Kg', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'H', noiDung: 'SON — LÀM SẠCH, SƠN', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'H-01', noiDung: 'Làm sạch bề mặt (bi, cát)', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'H-02', noiDung: 'Sơn (lót + phủ)', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'I', noiDung: 'BO — BẢO ÔN', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'I-01', noiDung: 'Bảo ôn', dvt: 'm²', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'J', noiDung: 'LTB — LẮP THIẾT BỊ', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'J-01', noiDung: 'Lắp thiết bị phụ kiện trước đóng kiện', dvt: 'Bộ', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'K', noiDung: 'DK — ĐÓNG KIỆN', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'K-01', noiDung: 'Đóng kiện', dvt: 'Kiện', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'L', noiDung: 'GH — GIAO HÀNG', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'L-01', noiDung: 'Giao hàng', dvt: 'Chuyến', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'M', noiDung: 'DP — NHÂN CÔNG DỰ PHÒNG', dvt: '', kl: '', donGia: '', thanhTien: '' },
                      { maCP: 'M-01', noiDung: 'Nhân công dự phòng', dvt: '', kl: '', donGia: '', thanhTien: '' },
                    ]
                  )}
                </>
              )

              return null
            })()}

            {/* P2.4 also renders DT02-DT07: aggregated from all departments */}
            {task.stepCode === 'P2.4' && (() => {
              // P2.4 shows ALL 6 DT tables for full review
              // Reuse same renderEstTable and column definitions
              type EstRow = Record<string, string>
              const renderEstTable = (
                title: string, code: string, dataKey: string,
                columns: { key: string; label: string; type?: string; width?: string }[],
                defaultRows: EstRow[]
              ) => {
                let rows: EstRow[] = []
                try { const p = formData[dataKey] ? JSON.parse(formData[dataKey] as string) : null; rows = (Array.isArray(p) && p.length > 0) ? p : defaultRows } catch { rows = defaultRows }
                const save = (next: EstRow[]) => handleFieldChange(dataKey, JSON.stringify(next))
                const addRow = () => save([...rows, Object.fromEntries(columns.map(c => [c.key, '']))])
                const removeRow = (i: number) => save(rows.filter((_, idx) => idx !== i))
                const update = (i: number, key: string, val: string) => { const n = [...rows]; n[i] = { ...n[i], [key]: val }; save(n) }
                return (
                  <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid var(--accent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent)' }}>{title}</h3>
                      {isActive && (
                        <button type="button" onClick={addRow}
                          style={{ padding: '4px 12px', fontSize: '0.75rem', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                          + Thêm
                        </button>
                      )}
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')} ${isActive ? '28px' : ''}`, gap: 4, padding: '6px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>#</span>
                        {columns.map(c => (
                          <span key={c.key} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>{c.label}</span>
                        ))}
                        {isActive && <span />}
                      </div>
                      {rows.map((row, ri) => (
                        <div key={ri} style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')} ${isActive ? '28px' : ''}`, gap: 4, padding: '3px 8px', borderBottom: ri < rows.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ri + 1}</span>
                          {columns.map(c => {
                            if (c.key.toLowerCase() === 'dvt') {
                              return (
                                <select key={c.key} className="input" value={row[c.key] || ''} disabled={!isActive}
                                  onChange={e => update(ri, c.key, e.target.value)}
                                  style={{ fontSize: '0.75rem', padding: '3px 2px' }}>
                                  <option value="">-Chọn-</option>
                                  <option value="kg">kg</option>
                                  <option value="tấn">tấn</option>
                                  <option value="m">m</option>
                                  <option value="m2">m2</option>
                                  <option value="m3">m3</option>
                                  <option value="cái">cái</option>
                                  <option value="bộ">bộ</option>
                                  <option value="lít">lít</option>
                                  <option value="tháng">tháng</option>
                                  <option value="ngày">ngày</option>
                                  <option value="giờ">giờ</option>
                                  <option value="lóng">lóng</option>
                                  <option value="tấm">tấm</option>
                                  <option value="thanh">thanh</option>
                                  <option value="ống">ống</option>
                                </select>
                              )
                            }
                            const isNumber = c.type === 'number' || ['kl', 'sl', 'dongia', 'thanhtien'].includes(c.key.toLowerCase())
                            return (
                              <input key={c.key} type={isNumber ? 'number' : 'text'} className="input" value={row[c.key] || ''} disabled={!isActive}
                                onChange={e => update(ri, c.key, e.target.value)}
                                placeholder={c.label}
                                style={{ fontSize: '0.75rem', padding: '3px 6px', textAlign: isNumber ? 'right' : 'left' }} />
                            )
                          })}
                          {isActive && rows.length > 1 && (
                            <button type="button" onClick={() => removeRow(ri)}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, padding: 0 }}>−</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rows.length} dòng</div>
                  </div>
                )
              }

              return (
                <>
                  <div className="card" style={{ padding: '1rem', marginTop: '1rem', background: 'var(--bg-secondary)', borderLeft: '4px solid #f59e0b' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#f59e0b' }}>📋 Cụm bảng dự toán chi tiết</h3>
                    <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      'Dữ liệu dự toán được đối soát từ P1.2 và điều chỉnh tại P2.4.'
                    </p>
                  </div>

                  {(task.stepCode === 'P2.4') && renderEstTable('📦 DT03 — Dự toán chi phí VT tổng hợp', 'QT30-DT03', 'dt03Items',
                    [
                      { key: 'nhomVT', label: 'Nhóm VT', width: '0.8fr' },
                      { key: 'danhMuc', label: 'Danh mục VT', width: '1.5fr' },
                      { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                      { key: 'kl', label: 'KL/SL', type: 'number', width: '0.6fr' },
                      { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.8fr' },
                      { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.8fr' },
                    ],
                    getInheritedEstRows('dt03Items', [{ nhomVT: 'VTC', danhMuc: 'Vật tư chính', dvt: '', kl: '', donGia: '', thanhTien: '' }])
                  )}
                  {(task.stepCode === 'P2.4') && renderEstTable('📋 DT04 — Dự toán chi tiết VT', 'QT30-DT04', 'dt04Items',
                    [
                      { key: 'maVT', label: 'Mã VT', width: '0.7fr' },
                      { key: 'tenVT', label: 'Tên VT', width: '1.2fr' },
                      { key: 'macVL', label: 'Mác VL', width: '0.6fr' },
                      { key: 'quyCach', label: 'Quy cách', width: '0.7fr' },
                      { key: 'dvt', label: 'ĐVT', width: '0.4fr' },
                      { key: 'kl', label: 'KL/SL', type: 'number', width: '0.5fr' },
                      { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
                      { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
                    ],
                    getInheritedEstRows('dt04Items', [{ maVT: '', tenVT: '', macVL: '', quyCach: '', dvt: '', kl: '', donGia: '', thanhTien: '' }])
                  )}
                  {(task.stepCode === 'P2.4') && renderEstTable('🔧 DT05 — Dự toán chi phí dịch vụ', 'QT30-DT05', 'dt05Items',
                    [
                      { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                      { key: 'noiDung', label: 'Nội dung công việc', width: '1.5fr' },
                      { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                      { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
                      { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
                      { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
                    ],
                    getInheritedEstRows('dt05Items', [{ maCP: '', noiDung: '', dvt: '', kl: '', donGia: '', thanhTien: '' }])
                  )}
                  {(task.stepCode === 'P2.4') && renderEstTable('👷 DT06 — Dự toán chi phí nhân công trực tiếp', 'QT30-DT06', 'dt06Items',
                    [
                      { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                      { key: 'noiDung', label: 'Nội dung công việc', width: '1.5fr' },
                      { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                      { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
                      { key: 'donGia', label: 'Đơn giá', type: 'number', width: '0.7fr' },
                      { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
                    ],
                    getInheritedEstRows('dt06Items', [{ maCP: '', noiDung: '', dvt: '', kl: '', donGia: '', thanhTien: '' }])
                  )}

                  {(task.stepCode === 'P2.4') && renderEstTable('📊 DT02 — Tổng hợp chi phí dự toán thi công', 'QT30-DT02', 'dt02Items',
                    [
                      { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                      { key: 'noiDung', label: 'Nội dung chi phí', width: '1.5fr' },
                      { key: 'giaTri', label: 'Giá trị', type: 'number', width: '0.8fr' },
                      { key: 'tyLe', label: 'Tỷ lệ %', type: 'number', width: '0.5fr' },
                    ],
                    getInheritedEstRows('dt02Items', [{ maCP: 'I', noiDung: 'Chi phí vật tư', giaTri: '', tyLe: '' }])
                  )}
                  {(task.stepCode === 'P2.4') && renderEstTable('🏢 DT07 — Chi phí chung, chi phí tài chính', 'QT30-DT07', 'dt07Items',
                    [
                      { key: 'maCP', label: 'Mã CP', width: '0.6fr' },
                      { key: 'danhMuc', label: 'Danh mục chi phí', width: '1.5fr' },
                      { key: 'dvt', label: 'ĐVT', width: '0.5fr' },
                      { key: 'kl', label: 'KL', type: 'number', width: '0.5fr' },
                      { key: 'donGia', label: 'Đơn giá BQ', type: 'number', width: '0.7fr' },
                      { key: 'thanhTien', label: 'Thành tiền', type: 'number', width: '0.7fr' },
                    ],
                    getInheritedEstRows('dt07Items', [{ maCP: '', danhMuc: '', dvt: '', kl: '', donGia: '', thanhTien: '' }])
                  )}
                </>
              )
            })()}
            {/* P2.4: Aggregated BOM + Estimate from previous steps */}
            {task.stepCode === 'P2.4' && previousStepData && (
              <>
                {/* Estimate from P1.2 */}
                {previousStepData.estimate && (
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>💰 Dự toán thi công (từ P1.2)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.9rem' }}>
                      {previousStepData.estimate.estimatedBudget && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Ngân sách dự kiến:</span> <strong style={{ color: '#16a34a' }}>{Number(previousStepData.estimate.estimatedBudget).toLocaleString()} {previousStepData.estimate.currency || 'VND'}</strong></div>
                      )}
                      {previousStepData.estimate.materialCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí vật tư:</span> <strong>{Number(previousStepData.estimate.materialCost).toLocaleString()}</strong></div>
                      )}
                      {previousStepData.estimate.laborCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí nhân công:</span> <strong>{Number(previousStepData.estimate.laborCost).toLocaleString()}</strong></div>
                      )}
                      {previousStepData.estimate.overheadCost && (
                        <div><span style={{ color: 'var(--text-secondary)' }}>Chi phí chung:</span> <strong>{Number(previousStepData.estimate.overheadCost).toLocaleString()}</strong></div>
                      )}
                    </div>
                    {previousStepData.estimate.estimateNotes && (
                      <div style={{ marginTop: 8, padding: 8, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        📝 {previousStepData.estimate.estimateNotes}
                      </div>
                    )}
                  </div>
                )}

                {/* BOM sections from P2.1, P2.2, P2.3 */}
                {[{ key: 'bomMain', label: '📦 VT chính — Thiết kế (P2.1)', color: '#3b82f6' },
                  { key: 'bomWeldPaint', label: '🔥 VT hàn & sơn — PM (P2.2)', color: '#ef4444' },
                  { key: 'bomSupply', label: '📋 VT phụ — Kho (P2.3)', color: '#10b981' },
                ].map(section => {
                  const data = previousStepData[section.key as keyof typeof previousStepData] as Record<string, unknown> | null
                  const items = (data?.bomItems as { name: string; code: string; spec: string; quantity: string; unit: string }[]) || []
                  const filledItems = items.filter(b => b.name?.trim())
                  return (
                    <div key={section.key} className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: `4px solid ${section.color}` }}>
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: section.color }}>{section.label}</h3>
                      {filledItems.length === 0 ? (
                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 8, fontSize: '0.85rem' }}>
                          Chưa có dữ liệu
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1.2fr 0.7fr 0.6fr', gap: 6, padding: '6px 4px', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên VT</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>SL</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                          </div>
                          {filledItems.map((item, idx) => (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1.2fr 0.7fr 0.6fr', gap: 6, padding: '5px 4px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 4, fontSize: '0.82rem' }}>
                              <span style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                              <span style={{ fontWeight: 600 }}>{item.name}</span>
                              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{item.code}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{item.spec || '—'}</span>
                              <span style={{ fontWeight: 700 }}>{item.quantity || '—'}</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{item.unit || '—'}</span>
                            </div>
                          ))}
                          <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                            Tổng: <strong>{filledItems.length}</strong> mục
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* P2.5: Show P2.4 data (KH SX + dự toán điều chỉnh) + BOM summary for BGĐ review */}
            {task.stepCode === 'P2.5' && previousStepData && (
              <>
                {/* KH SX + Dự toán điều chỉnh from P2.4 */}
                {previousStepData.plan && (
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #8b5cf6' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#8b5cf6' }}>📋 Kế hoạch SX & Dự toán điều chỉnh (từ KTKH — P2.4)</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.9rem' }}>
                      {previousStepData.plan.adjustedBudget && (
                        <div style={{ gridColumn: '1 / -1' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Dự toán điều chỉnh:</span>{' '}
                          <strong style={{ color: '#16a34a', fontSize: '1.1rem' }}>{Number(previousStepData.plan.adjustedBudget).toLocaleString()} VND</strong>
                        </div>
                      )}
                    </div>
                    {previousStepData.plan.productionPlan && (
                      <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>KH sản xuất tổng thể:</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(previousStepData.plan.productionPlan)}</div>
                      </div>
                    )}
                    {previousStepData.plan.budgetImpact && (
                      <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Tác động WBS budget:</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(previousStepData.plan.budgetImpact)}</div>
                      </div>
                    )}
                    {previousStepData.plan.workshopTimeline && (
                      <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Timeline phân xưởng:</strong>
                        <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(previousStepData.plan.workshopTimeline)}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Department Estimates DT02-DT07 from P2.4 */}
                {previousStepData.plan && (() => {
                  const de = previousStepData.plan
                  type DtRow = Record<string, string>
                  const renderReadonlyTable = (title: string, code: string, dataStr: string | null, columns: { key: string; label: string; width?: string }[]) => {
                    let rows: DtRow[] = []
                    try { rows = dataStr ? JSON.parse(dataStr as string) : [] } catch { rows = [] }
                    if (!rows || rows.length === 0) return (
                      <div className="card" style={{ padding: '1rem', marginTop: '0.75rem', borderLeft: '4px solid var(--border)' }}>
                        <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{title} — Chưa có dữ liệu</h4>
                      </div>
                    )
                    return (
                      <div className="card" style={{ padding: '1rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: '0.9rem', color: 'var(--accent)' }}>{title}</h4>
                        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')}`, gap: 4, padding: '5px 8px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>#</span>
                            {columns.map(c => <span key={c.key} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>{c.label}</span>)}
                          </div>
                          {rows.map((row, ri) => (
                            <div key={ri} style={{ display: 'grid', gridTemplateColumns: `30px ${columns.map(c => c.width || '1fr').join(' ')}`, gap: 4, padding: '3px 8px', borderBottom: ri < rows.length - 1 ? '1px solid var(--border)' : 'none', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{ri + 1}</span>
                              {columns.map(c => <span key={c.key} style={{ fontSize: '0.75rem' }}>{row[c.key] || '—'}</span>)}
                            </div>
                          ))}
                        </div>
                        <div style={{ marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>{rows.length} dòng</div>
                      </div>
                    )
                  }
                  return (
                    <div style={{ marginTop: '1rem' }}>
                      <div className="card" style={{ padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderLeft: '4px solid #059669' }}>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#059669' }}>📊 Dự toán chi tiết từ các phòng ban</h3>
                      </div>
                      {renderReadonlyTable('DT02 — Tổng hợp chi phí', 'QT30-DT02', de.dt02Items || (previousStepData.estimate as Record<string, string>)?.dt02Items, [
                        { key: 'maCP', label: 'Mã CP', width: '0.6fr' }, { key: 'noiDung', label: 'Nội dung chi phí', width: '1.5fr' },
                        { key: 'giaTri', label: 'Giá trị', width: '0.8fr' }, { key: 'tyLe', label: 'Tỷ lệ %', width: '0.5fr' },
                      ])}
                      {renderReadonlyTable('DT03 — VT tổng hợp', 'QT30-DT03', de.dt03Items || (previousStepData.estimate as Record<string, string>)?.dt03Items, [
                        { key: 'nhomVT', label: 'Nhóm VT', width: '0.8fr' }, { key: 'danhMuc', label: 'Danh mục VT', width: '1.5fr' },
                        { key: 'dvt', label: 'ĐVT', width: '0.5fr' }, { key: 'kl', label: 'KL/SL', width: '0.6fr' },
                        { key: 'donGia', label: 'Đơn giá', width: '0.7fr' }, { key: 'thanhTien', label: 'Thành tiền', width: '0.7fr' },
                      ])}
                      {renderReadonlyTable('DT04 — VT chi tiết', 'QT30-DT04', de.dt04Items || (previousStepData.estimate as Record<string, string>)?.dt04Items, [
                        { key: 'maVT', label: 'Mã VT', width: '0.7fr' }, { key: 'tenVT', label: 'Tên VT', width: '1.2fr' },
                        { key: 'macVL', label: 'Mác VL', width: '0.6fr' }, { key: 'quyCach', label: 'Quy cách', width: '0.7fr' },
                        { key: 'dvt', label: 'ĐVT', width: '0.4fr' }, { key: 'kl', label: 'KL/SL', width: '0.5fr' },
                        { key: 'donGia', label: 'Đơn giá', width: '0.7fr' }, { key: 'thanhTien', label: 'Thành tiền', width: '0.7fr' },
                      ])}
                      {renderReadonlyTable('DT05 — Dịch vụ thuê ngoài', 'QT30-DT05', de.dt05Items || (previousStepData.estimate as Record<string, string>)?.dt05Items, [
                        { key: 'maCP', label: 'Mã CP', width: '0.6fr' }, { key: 'noiDung', label: 'Nội dung', width: '1.5fr' },
                        { key: 'dvt', label: 'ĐVT', width: '0.5fr' }, { key: 'kl', label: 'KL', width: '0.5fr' },
                        { key: 'donGia', label: 'Đơn giá', width: '0.7fr' }, { key: 'thanhTien', label: 'Thành tiền', width: '0.7fr' },
                      ])}
                      {renderReadonlyTable('DT06 — Nhân công trực tiếp', 'QT30-DT06', de.dt06Items || (previousStepData.estimate as Record<string, string>)?.dt06Items, [
                        { key: 'maCP', label: 'Mã CP', width: '0.6fr' }, { key: 'noiDung', label: 'Nội dung', width: '1.5fr' },
                        { key: 'dvt', label: 'ĐVT', width: '0.5fr' }, { key: 'kl', label: 'KL', width: '0.5fr' },
                        { key: 'donGia', label: 'Đơn giá', width: '0.7fr' }, { key: 'thanhTien', label: 'Thành tiền', width: '0.7fr' },
                      ])}
                      {renderReadonlyTable('DT07 — CP chung, tài chính', 'QT30-DT07', de.dt07Items || (previousStepData.estimate as Record<string, string>)?.dt07Items, [
                        { key: 'maCP', label: 'Mã CP', width: '0.6fr' }, { key: 'danhMuc', label: 'Danh mục', width: '1.5fr' },
                        { key: 'dvt', label: 'ĐVT', width: '0.5fr' }, { key: 'kl', label: 'KL', width: '0.5fr' },
                        { key: 'donGia', label: 'Đơn giá BQ', width: '0.7fr' }, { key: 'thanhTien', label: 'Thành tiền', width: '0.7fr' },
                      ])}
                    </div>
                  )
                })()}



                {/* BOM summary from P2.1/P2.2/P2.3 */}
                {[{ key: 'bomMain', label: '📦 VT chính — Thiết kế (P2.1)', color: '#3b82f6' },
                  { key: 'bomWeldPaint', label: '🔥 VT hàn & sơn — PM (P2.2)', color: '#ef4444' },
                  { key: 'bomSupply', label: '📋 VT phụ — Kho (P2.3)', color: '#10b981' },
                ].map(section => {
                  const data = previousStepData[section.key as keyof typeof previousStepData] as Record<string, unknown> | null
                  const items = (data?.bomItems as { name: string; code: string; spec: string; quantity: string; unit: string }[]) || []
                  const filledItems = items.filter(b => b.name?.trim())
                  if (filledItems.length === 0) return null
                  return (
                    <div key={section.key} className="card" style={{ padding: '1.25rem', marginTop: '0.75rem', borderLeft: `4px solid ${section.color}` }}>
                      <h3 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', color: section.color }}>{section.label}</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '35px 1.5fr 1fr 1.2fr 0.6fr 0.5fr', gap: 4, padding: '4px 2px', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
                        {['#', 'Tên VT', 'Mã VT', 'Quy chuẩn', 'SL', 'ĐVT'].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {filledItems.map((item, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '35px 1.5fr 1fr 1.2fr 0.6fr 0.5fr', gap: 4, padding: '3px 2px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 3, fontSize: '0.78rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                          <span style={{ fontWeight: 600 }}>{item.name}</span>
                          <span style={{ color: 'var(--accent)' }}>{item.code}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.spec || '—'}</span>
                          <span style={{ fontWeight: 700 }}>{item.quantity || '—'}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.unit || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </>
            )}

            {/* P3.2: Stock Check — auto compare PR items vs inventory */}
            {task.stepCode === 'P3.2' && previousStepData && (
              <>
                {/* Summary bar */}
                <div className="card" style={{ padding: '1rem 1.5rem', marginTop: '1rem', display: 'flex', gap: 24, alignItems: 'center', background: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)' }}>
                  <div style={{ fontSize: '0.85rem' }}>
                    📊 Tổng PR: <strong>{(previousStepData.prItems as unknown[])?.length || 0}</strong> mục
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#16a34a' }}>
                    ✅ Xuất kho: <strong>{(previousStepData.fromStock as unknown[])?.length || 0}</strong>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#dc2626' }}>
                    🛒 Cần mua: <strong>{(previousStepData.toPurchase as unknown[])?.length || 0}</strong>
                  </div>
                </div>

                {/* From Stock — items that can be issued from warehouse */}
                <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #16a34a' }}>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#16a34a' }}>✅ Xuất từ kho (Tồn đủ + Quy chuẩn OK)</h3>
                  {(previousStepData.fromStock as { name: string; code: string; spec: string; quantity: string; unit: string; source: string; inStock: number; requestedQty: number; matchedMaterial: { code: string; name: string; spec: string | null; stock: number } | null }[])?.length > 0 ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '30px 1.2fr 0.8fr 0.8fr 0.6fr 0.6fr 0.6fr 0.5fr', gap: 4, padding: '4px 2px', borderBottom: '2px solid var(--border)', marginBottom: 2 }}>
                        {['#', 'Tên VT', 'Mã VT', 'Quy chuẩn', 'Yêu cầu', 'Tồn kho', 'ĐVT', 'Nguồn'].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {(previousStepData.fromStock as { name: string; code: string; spec: string; quantity: string; unit: string; source: string; inStock: number; requestedQty: number }[]).map((item, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 1.2fr 0.8fr 0.8fr 0.6fr 0.6fr 0.6fr 0.5fr', gap: 4, padding: '4px 2px', background: idx % 2 === 0 ? '#f0fdf4' : 'transparent', borderRadius: 4, fontSize: '0.8rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                          <span style={{ fontWeight: 600 }}>{item.name}</span>
                          <span style={{ color: 'var(--accent)' }}>{item.code}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.spec || '—'}</span>
                          <span style={{ fontWeight: 700 }}>{item.requestedQty}</span>
                          <span style={{ color: '#16a34a', fontWeight: 700 }}>{item.inStock}</span>
                          <span>{item.unit}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.source}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 8 }}>
                      Không có mục nào đủ điều kiện xuất kho
                    </div>
                  )}
                </div>

                {/* To Purchase — items that need to be bought */}
                <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #dc2626' }}>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#dc2626' }}>🛒 Cần mua (Không đủ tồn / Quy chuẩn không đạt)</h3>
                  {(previousStepData.toPurchase as { name: string; code: string; spec: string; quantity: string; unit: string; source: string; inStock: number; requestedQty: number; shortfall: number; specMatch: boolean; matchedMaterial: { code: string; name: string; spec: string | null } | null }[])?.length > 0 ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '30px 1.2fr 0.8fr 0.8fr 0.5fr 0.5fr 0.5fr 0.5fr 0.5fr', gap: 4, padding: '4px 2px', borderBottom: '2px solid var(--border)', marginBottom: 2 }}>
                        {['#', 'Tên VT', 'Mã VT', 'Quy chuẩn', 'Yêu cầu', 'Tồn kho', 'Thiếu', 'Spec', 'Nguồn'].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {(previousStepData.toPurchase as { name: string; code: string; spec: string; quantity: string; unit: string; source: string; inStock: number; requestedQty: number; shortfall: number; specMatch: boolean; matchedMaterial: { code: string; name: string; spec: string | null } | null }[]).map((item, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 1.2fr 0.8fr 0.8fr 0.5fr 0.5fr 0.5fr 0.5fr 0.5fr', gap: 4, padding: '4px 2px', background: idx % 2 === 0 ? '#fef2f2' : 'transparent', borderRadius: 4, fontSize: '0.8rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{idx + 1}</span>
                          <span style={{ fontWeight: 600 }}>{item.name}</span>
                          <span style={{ color: 'var(--accent)' }}>{item.code}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{item.spec || '—'}</span>
                          <span style={{ fontWeight: 700 }}>{item.requestedQty}</span>
                          <span style={{ color: item.inStock > 0 ? '#f59e0b' : '#dc2626', fontWeight: 700 }}>{item.inStock}</span>
                          <span style={{ color: '#dc2626', fontWeight: 700 }}>{item.shortfall > 0 ? `−${item.shortfall}` : '—'}</span>
                          <span style={{ fontSize: '0.7rem' }}>{item.matchedMaterial ? (item.specMatch ? '✅' : '❌ Sai') : '⚠️ N/A'}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{item.source}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ padding: '1rem', textAlign: 'center', color: '#16a34a', border: '2px dashed #bbf7d0', borderRadius: 8, fontWeight: 600 }}>
                      🎉 Tất cả vật tư đều sẵn có trong kho!
                    </div>
                  )}
                </div>
              </>
            )}

            {/* P3.5: Supplier Entries + Auto Price Comparison */}
            {task.stepCode === 'P3.5' && (() => {
              // Get PR materials from P2.1/P2.2/P2.3
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const prItemsRaw = (previousStepData as any)?.prItems
              type PrItem = { name: string; code: string; spec: string; quantity: string; unit: string; source: string }
              const prItems: PrItem[] = Array.isArray(prItemsRaw) ? prItemsRaw.filter((p: PrItem) => p.name?.trim()) : []

              return (
                <>
                  {/* Merged: NCC Cards with PR materials table inside */}
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: '2px solid #8b5cf6', paddingBottom: 8 }}>
                          🏭 Nhà cung cấp đề xuất <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>* (tối thiểu 3 NCC)</span>
                        </h3>
                        <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {prItems.length > 0 ? `${prItems.length} vật tư PR từ BOM (P2.1/P2.2/P2.3) — TM chỉ điền giá cho từng NCC` : 'Chưa có vật tư PR — TM tự nhập vật tư'}
                        </p>
                      </div>
                      {isActive && (
                        <button type="button" onClick={() => setSuppliers(prev => [...prev, { name: '', quotes: prItems.length > 0 ? prItems.map(m => ({ material: m.name, price: '' })) : [{ material: '', price: '' }] }])}
                          style={{ background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                          ➕ Thêm NCC
                        </button>
                      )}
                    </div>
                    {suppliers.length < 3 && (
                      <div style={{ padding: '6px 12px', background: '#fef2f2', borderRadius: 8, fontSize: '0.8rem', color: '#dc2626', marginBottom: 12 }}>
                        ⚠️ Cần tối thiểu 3 NCC. Hiện có: {suppliers.length}
                      </div>
                    )}
                    {suppliers.map((supplier, sIdx) => (
                      <div key={sIdx} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', marginBottom: 16, borderLeft: `4px solid hsl(${sIdx * 60 + 200}, 60%, 50%)` }}>
                        {/* NCC header: name + capability file + delete */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: `hsl(${sIdx * 60 + 200}, 60%, 40%)`, minWidth: 60 }}>NCC {sIdx + 1}</span>
                          <input className="input" placeholder="Tên nhà cung cấp *" value={supplier.name} disabled={!isActive}
                            onChange={e => setSuppliers(prev => prev.map((s, i) => i === sIdx ? { ...s, name: e.target.value } : s))}
                            style={{ flex: 1, fontSize: '0.85rem', fontWeight: 600 }} />
                          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', cursor: 'pointer', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            📎 Năng lực NCC
                            <input type="file" accept=".pdf,.doc,.docx,.xlsx" style={{ display: 'none' }} disabled={!isActive}
                              onChange={e => {
                                const file = e.target.files?.[0]
                                if (file) {
                                  const reader = new FileReader()
                                  reader.onload = () => {
                                    setSuppliers(prev => prev.map((s, i) => i === sIdx ? { ...s, capabilityFile: file.name, capabilityFileData: reader.result as string } : s))
                                  }
                                  reader.readAsDataURL(file)
                                }
                              }} />
                          </label>
                          {(supplier as unknown as { capabilityFile?: string; capabilityFileData?: string }).capabilityFile && (
                            <a
                              href={(supplier as unknown as { capabilityFileData?: string }).capabilityFileData || '#'}
                              download={(supplier as unknown as { capabilityFile?: string }).capabilityFile}
                              style={{ fontSize: '0.7rem', color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 6px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', textDecoration: 'none', cursor: 'pointer' }}
                              title={`Tải về: ${(supplier as unknown as { capabilityFile?: string }).capabilityFile}`}>
                              ✅ {(supplier as unknown as { capabilityFile?: string }).capabilityFile}
                            </a>
                          )}
                          {isActive && suppliers.length > 3 && (
                            <button type="button" onClick={() => setSuppliers(prev => prev.filter((_, i) => i !== sIdx))}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700 }} title="Xóa NCC">×</button>
                          )}
                        </div>
                        {/* Material quotes table — PR items with price column */}
                        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                            <thead>
                              <tr style={{ background: 'var(--bg-secondary)' }}>
                                {['#', 'Tên vật tư', 'Mã VT', 'Quy cách', 'SL', 'ĐVT', 'Nguồn', 'Giá (VND)'].map(h => (
                                  <th key={h} style={{ padding: '5px 6px', fontWeight: 700, color: h === 'Giá (VND)' ? '#dc2626' : 'var(--text-muted)', borderBottom: '2px solid var(--border)', textAlign: h === 'SL' || h === 'Giá (VND)' ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                                {isActive && <th style={{ width: 24, borderBottom: '2px solid var(--border)' }} />}
                              </tr>
                            </thead>
                            <tbody>
                              {supplier.quotes.map((q, qIdx) => {
                                // Try to match quote with PR item for readonly info
                                const prMatch = prItems.find(p => p.name.toLowerCase() === q.material.toLowerCase())
                                return (
                                  <tr key={qIdx} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '3px 6px', color: 'var(--text-muted)', textAlign: 'center' }}>{qIdx + 1}</td>
                                    <td style={{ padding: '3px 6px', fontWeight: 500 }}>
                                      {prMatch ? (
                                        <span>{q.material}</span>
                                      ) : (
                                        <input className="input" value={q.material} disabled={!isActive}
                                          onChange={e => setSuppliers(prev => prev.map((s, i) => i === sIdx ? { ...s, quotes: s.quotes.map((qq, j) => j === qIdx ? { ...qq, material: e.target.value } : qq) } : s))}
                                          placeholder="Tên vật tư" style={{ fontSize: '0.72rem', padding: '2px 4px', width: '100%' }} />
                                      )}
                                    </td>
                                    <td style={{ padding: '3px 6px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>{prMatch?.code || ''}</td>
                                    <td style={{ padding: '3px 6px', fontSize: '0.65rem' }}>{prMatch?.spec || ''}</td>
                                    <td style={{ padding: '3px 6px', textAlign: 'right', fontSize: '0.68rem' }}>{prMatch?.quantity || ''}</td>
                                    <td style={{ padding: '3px 6px', fontSize: '0.68rem' }}>{prMatch?.unit || ''}</td>
                                    <td style={{ padding: '3px 6px' }}>
                                      {prMatch?.source && <span style={{ padding: '1px 4px', borderRadius: 3, fontSize: '0.58rem', fontWeight: 600, background: '#dbeafe', color: '#1d4ed8' }}>{prMatch.source}</span>}
                                    </td>
                                    <td style={{ padding: '3px 6px' }}>
                                      <input className="input" type="number" value={q.price} disabled={!isActive}
                                        onChange={e => setSuppliers(prev => prev.map((s, i) => i === sIdx ? { ...s, quotes: s.quotes.map((qq, j) => j === qIdx ? { ...qq, price: e.target.value } : qq) } : s))}
                                        placeholder="0" style={{ fontSize: '0.75rem', padding: '3px 6px', width: '100%', textAlign: 'right', fontWeight: 600, color: '#dc2626' }} />
                                    </td>
                                    {isActive && (
                                      <td style={{ textAlign: 'center', padding: '2px' }}>
                                        <button type="button" onClick={() => setSuppliers(prev => prev.map((s, i) => i === sIdx ? { ...s, quotes: s.quotes.filter((_, j) => j !== qIdx) } : s))}
                                          style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, padding: 0 }}>−</button>
                                      </td>
                                    )}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        {isActive && (
                          <button type="button" onClick={() => setSuppliers(prev => prev.map((s, i) => i === sIdx ? { ...s, quotes: [...s.quotes, { material: '', price: '' }] } : s))}
                            style={{ marginTop: 6, fontSize: '0.72rem', color: '#8b5cf6', background: 'none', border: '1px dashed #8b5cf6', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                            + Thêm vật tư
                          </button>
                        )}
                        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {supplier.quotes.filter(q => q.price && Number(q.price) > 0).length}/{supplier.quotes.length} vật tư đã có giá
                          </span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1d4ed8' }}>
                            Tổng: {supplier.quotes.reduce((sum, q) => sum + (Number(q.price) || 0), 0).toLocaleString('vi-VN')} ₫
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                {/* Auto Price Comparison Table */}
                {(() => {
                  const namedSuppliers = suppliers.filter(s => s.name.trim())
                  const allMaterials = [...new Set(namedSuppliers.flatMap(s => s.quotes.filter(q => q.material.trim()).map(q => q.material.trim().toLowerCase())))]
                  if (namedSuppliers.length < 2 || allMaterials.length === 0) return null
                  return (
                    <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #0ea5e9' }}>
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0ea5e9' }}>📊 So sánh báo giá NCC</h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Vật tư</th>
                              {namedSuppliers.map((s, i) => (
                                <th key={i} style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: `hsl(${i * 60 + 200}, 60%, 40%)` }}>{s.name}</th>
                              ))}
                              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700 }}>Kết quả</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allMaterials.map((mat, mIdx) => {
                              const prices = namedSuppliers.map(s => {
                                const q = s.quotes.find(q => q.material.trim().toLowerCase() === mat)
                                return q ? Number(q.price) || 0 : 0
                              })
                              const validPrices = prices.filter(p => p > 0)
                              const minP = validPrices.length > 0 ? Math.min(...validPrices) : 0
                              const maxP = validPrices.length > 0 ? Math.max(...validPrices) : 0
                              const cheapestIdx = prices.indexOf(minP)
                              return (
                                <tr key={mIdx} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{mat}</td>
                                  {prices.map((p, pIdx) => (
                                    <td key={pIdx} style={{
                                      textAlign: 'right', padding: '6px 8px',
                                      fontWeight: 700,
                                      color: p === 0 ? 'var(--text-muted)' : p === minP ? '#16a34a' : p === maxP ? '#dc2626' : 'var(--text-primary)',
                                      background: p === minP && p > 0 ? '#f0fdf4' : p === maxP && p > 0 ? '#fef2f2' : 'transparent',
                                    }}>
                                      {p > 0 ? p.toLocaleString('vi-VN') : '—'}
                                      {p === minP && p > 0 && ' ✅'}
                                      {p === maxP && p > 0 && validPrices.length > 1 && ' ⬆️'}
                                    </td>
                                  ))}
                                  <td style={{ textAlign: 'center', padding: '6px 8px', fontSize: '0.75rem' }}>
                                    {validPrices.length > 1 ? (
                                      <span style={{ color: '#16a34a', fontWeight: 700 }}>🏆 {namedSuppliers[cheapestIdx]?.name}</span>
                                    ) : validPrices.length === 1 ? '1 giá' : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                            {/* Total row */}
                            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 700, fontSize: '0.85rem' }}>TỔNG</td>
                              {namedSuppliers.map((s, sIdx) => {
                                const total = s.quotes.reduce((sum, q) => sum + (Number(q.price) || 0), 0)
                                const allTotals = namedSuppliers.map(ns => ns.quotes.reduce((sm, q) => sm + (Number(q.price) || 0), 0)).filter(t => t > 0)
                                const minTotal = allTotals.length > 0 ? Math.min(...allTotals) : 0
                                const maxTotal = allTotals.length > 0 ? Math.max(...allTotals) : 0
                                return (
                                  <td key={sIdx} style={{
                                    textAlign: 'right', padding: '6px 8px', fontWeight: 700, fontSize: '0.85rem',
                                    color: total === 0 ? 'var(--text-muted)' : total === minTotal ? '#16a34a' : total === maxTotal ? '#dc2626' : '#1d4ed8',
                                    background: total === minTotal && total > 0 ? '#f0fdf4' : total === maxTotal && total > 0 ? '#fef2f2' : 'transparent',
                                  }}>
                                    {total > 0 ? total.toLocaleString('vi-VN') : '—'}
                                    {total === minTotal && total > 0 && ' ✅'}
                                    {total === maxTotal && total > 0 && allTotals.length > 1 && ' ⬆️'}
                                  </td>
                                )
                              })}
                              <td style={{ textAlign: 'center', padding: '6px 8px', fontSize: '0.75rem' }}>
                                {(() => {
                                  const totals = namedSuppliers.map(s => s.quotes.reduce((sm, q) => sm + (Number(q.price) || 0), 0))
                                  const validT = totals.filter(t => t > 0)
                                  if (validT.length < 2) return '—'
                                  const minT = Math.min(...validT)
                                  const cheapI = totals.indexOf(minT)
                                  return <span style={{ color: '#16a34a', fontWeight: 700 }}>🏆 {namedSuppliers[cheapI]?.name}</span>
                                })()}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ✅ = Giá thấp nhất &nbsp; ⬆️ = Giá cao nhất &nbsp; 🏆 = NCC đề xuất
                      </div>
                    </div>
                  )
                })()}
              </>
              )
            })()}

            {/* P3.6: BGĐ review supplier data from P3.5 */}
            {task.stepCode === 'P3.6' && previousStepData?.supplierData && (() => {
              const sd = previousStepData.supplierData as { suppliers?: { name: string; quotes: { material: string; price: string }[] }[]; [key: string]: unknown }
              const supplierList = sd?.suppliers || []
              if (supplierList.length === 0) return null
              // Build comparison
              const namedS = supplierList.filter(s => s.name?.trim())
              const allMats = [...new Set(namedS.flatMap(s => (s.quotes || []).filter(q => q.material?.trim()).map(q => q.material.trim().toLowerCase())))]
              return (
                <>
                  {/* Supplier list read-only */}
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #8b5cf6' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#8b5cf6' }}>🏭 Danh sách NCC đề xuất từ Thương mại ({namedS.length} NCC)</h3>
                    {namedS.map((s, sIdx) => (
                      <div key={sIdx} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem', marginBottom: 8, borderLeft: `3px solid hsl(${sIdx * 60 + 200}, 60%, 50%)` }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.9rem', marginBottom: 6, color: `hsl(${sIdx * 60 + 200}, 60%, 40%)` }}>
                          NCC {sIdx + 1}: {s.name}
                          {(s as unknown as { capabilityFile?: string; capabilityFileData?: string }).capabilityFile && (
                            <a
                              href={(s as unknown as { capabilityFileData?: string }).capabilityFileData || '#'}
                              download={(s as unknown as { capabilityFile?: string }).capabilityFile}
                              style={{ fontSize: '0.7rem', fontWeight: 500, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 4, padding: '2px 6px', textDecoration: 'none', cursor: 'pointer' }}
                              title={`Tải về: ${(s as unknown as { capabilityFile?: string }).capabilityFile}`}>
                              📎 {(s as unknown as { capabilityFile?: string }).capabilityFile}
                            </a>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '30px 1.5fr 1fr', gap: 4, padding: '2px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                          {['#', 'Vật tư', 'Giá (VND)'].map(h => (
                            <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                          ))}
                        </div>
                        {(s.quotes || []).filter(q => q.material?.trim()).map((q, qIdx) => (
                          <div key={qIdx} style={{ display: 'grid', gridTemplateColumns: '30px 1.5fr 1fr', gap: 4, padding: '2px', fontSize: '0.8rem' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{qIdx + 1}</span>
                            <span>{q.material}</span>
                            <span style={{ textAlign: 'right', fontWeight: 600 }}>{Number(q.price).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        ))}
                        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1d4ed8' }}>
                            Tổng: {(s.quotes || []).reduce((sum, q) => sum + (Number(q.price) || 0), 0).toLocaleString('vi-VN')} ₫
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Auto comparison table */}
                  {namedS.length >= 2 && allMats.length > 0 && (
                    <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #0ea5e9' }}>
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0ea5e9' }}>📊 So sánh báo giá NCC</h3>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700 }}>Vật tư</th>
                              {namedS.map((s, i) => (
                                <th key={i} style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 700, color: `hsl(${i * 60 + 200}, 60%, 40%)` }}>{s.name}</th>
                              ))}
                              <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700 }}>Kết quả</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allMats.map((mat, mIdx) => {
                              const prices = namedS.map(s => {
                                const q = (s.quotes || []).find(q => q.material?.trim().toLowerCase() === mat)
                                return q ? Number(q.price) || 0 : 0
                              })
                              const validP = prices.filter(p => p > 0)
                              const minP = validP.length > 0 ? Math.min(...validP) : 0
                              const maxP = validP.length > 0 ? Math.max(...validP) : 0
                              const cheapIdx = prices.indexOf(minP)
                              return (
                                <tr key={mIdx} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{mat}</td>
                                  {prices.map((p, pIdx) => (
                                    <td key={pIdx} style={{
                                      textAlign: 'right', padding: '6px 8px', fontWeight: 700,
                                      color: p === 0 ? 'var(--text-muted)' : p === minP ? '#16a34a' : p === maxP ? '#dc2626' : 'var(--text-primary)',
                                      background: p === minP && p > 0 ? '#f0fdf4' : p === maxP && p > 0 ? '#fef2f2' : 'transparent',
                                    }}>
                                      {p > 0 ? `${p.toLocaleString('vi-VN')} ₫` : '—'}
                                      {p === minP && p > 0 && ' ✅'}
                                      {p === maxP && p > 0 && validP.length > 1 && ' ⬆️'}
                                    </td>
                                  ))}
                                  <td style={{ textAlign: 'center', padding: '6px 8px', fontSize: '0.75rem' }}>
                                    {validP.length > 1 ? (
                                      <span style={{ color: '#16a34a', fontWeight: 700 }}>🏆 {namedS[cheapIdx]?.name}</span>
                                    ) : validP.length === 1 ? '1 giá' : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                            {/* Total row */}
                            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                              <td style={{ padding: '6px 8px', fontWeight: 700, fontSize: '0.85rem' }}>TỔNG HÓA ĐƠN</td>
                              {namedS.map((s, sIdx) => {
                                const total = (s.quotes || []).reduce((sum, q) => sum + (Number(q.price) || 0), 0)
                                const allTotals = namedS.map(ns => (ns.quotes || []).reduce((sm, q) => sm + (Number(q.price) || 0), 0)).filter(t => t > 0)
                                const minTotal = allTotals.length > 0 ? Math.min(...allTotals) : 0
                                const maxTotal = allTotals.length > 0 ? Math.max(...allTotals) : 0
                                return (
                                  <td key={sIdx} style={{
                                    textAlign: 'right', padding: '6px 8px', fontWeight: 700, fontSize: '0.9rem',
                                    color: total === 0 ? 'var(--text-muted)' : total === minTotal ? '#16a34a' : total === maxTotal ? '#dc2626' : '#1d4ed8',
                                    background: total === minTotal && total > 0 ? '#dcfce7' : total === maxTotal && total > 0 ? '#fee2e2' : 'transparent',
                                  }}>
                                    {total > 0 ? `${total.toLocaleString('vi-VN')} ₫` : '—'}
                                    {total === minTotal && total > 0 && ' ✅'}
                                    {total === maxTotal && total > 0 && allTotals.length > 1 && ' ⬆️'}
                                  </td>
                                )
                              })}
                              <td style={{ textAlign: 'center', padding: '6px 8px', fontSize: '0.78rem' }}>
                                {(() => {
                                  const totals = namedS.map(s => (s.quotes || []).reduce((sm, q) => sm + (Number(q.price) || 0), 0))
                                  const validT = totals.filter(t => t > 0)
                                  if (validT.length < 2) return '—'
                                  const minT = Math.min(...validT)
                                  const cheapI = totals.indexOf(minT)
                                  return <span style={{ color: '#16a34a', fontWeight: 700 }}>🏆 {namedS[cheapI]?.name}</span>
                                })()}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ✅ = Giá thấp nhất &nbsp; ⬆️ = Giá cao nhất &nbsp; 🏆 = NCC được đề xuất
                      </div>
                    </div>
                  )}
                </>
              )
            })()}

            {/* P3.7: PO Finalization — Payment Terms + Delivery Plan */}
            {task.stepCode === 'P3.7' && (
              <>
                {/* Best Price Summary from NCC comparison */}
                {previousStepData?.supplierData && (() => {
                  const sd = previousStepData.supplierData as { suppliers?: { name: string; quotes: { material: string; price: string }[] }[] }
                  const nccList = (sd?.suppliers || []).filter(s => s.name?.trim())
                  if (nccList.length === 0) return null
                  // Build best price per material
                  const allMats = [...new Set(nccList.flatMap(s => (s.quotes || []).filter(q => q.material?.trim()).map(q => q.material.trim())))]
                  type BestItem = { material: string; bestPrice: number; bestNCC: string; prices: { ncc: string; price: number }[] }
                  const bestItems: BestItem[] = allMats.map(mat => {
                    const prices = nccList.map(s => {
                      const q = (s.quotes || []).find(q => q.material?.trim().toLowerCase() === mat.toLowerCase())
                      return { ncc: s.name, price: q ? Number(q.price) || 0 : 0 }
                    }).filter(p => p.price > 0)
                    const best = prices.length > 0 ? prices.reduce((a, b) => a.price <= b.price ? a : b) : { ncc: '—', price: 0 }
                    return { material: mat, bestPrice: best.price, bestNCC: best.ncc, prices }
                  })
                  const grandTotal = bestItems.reduce((sum, item) => sum + item.bestPrice, 0)
                  return (
                    <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #16a34a' }}>
                      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#16a34a' }}>🏆 Tổng hợp giá tốt nhất</h3>
                      <p style={{ margin: '0 0 10px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Giá tốt nhất cho từng vật tư đã so sánh từ {nccList.length} NCC</p>
                      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-secondary)' }}>
                              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>#</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>Vật tư</th>
                              <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, borderBottom: '2px solid var(--border)', color: '#16a34a' }}>Giá tốt nhất (VND)</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>NCC</th>
                              <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>Số NCC báo giá</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bestItems.map((item, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                                <td style={{ padding: '6px 8px', fontWeight: 500 }}>{item.material}</td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: '#16a34a', fontSize: '0.85rem' }}>
                                  {item.bestPrice > 0 ? `${item.bestPrice.toLocaleString('vi-VN')} ₫` : '—'}
                                </td>
                                <td style={{ padding: '6px 8px' }}>
                                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: '#dcfce7', color: '#16a34a' }}>
                                    {item.bestNCC}
                                  </span>
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {item.prices.length}/{nccList.length}
                                </td>
                              </tr>
                            ))}
                            {/* Grand total row */}
                            <tr style={{ borderTop: '2px solid var(--border)', background: '#f0fdf4' }}>
                              <td colSpan={2} style={{ padding: '8px', fontWeight: 700, fontSize: '0.9rem', color: '#15803d' }}>TỔNG HÓA ĐƠN (giá tốt nhất)</td>
                              <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontSize: '1rem', color: '#15803d' }}>
                                {grandTotal.toLocaleString('vi-VN')} ₫
                              </td>
                              <td colSpan={2} style={{ padding: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Tổng hợp giá tốt nhất từ tất cả NCC
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })()}

                {/* Payment Terms Dropdown */}
                <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #f59e0b' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#f59e0b' }}>💰 Điều kiện thanh toán</h3>
                  <select className="input" value={paymentType} disabled={!isActive}
                    onChange={e => setPaymentType(e.target.value as 'full' | 'partial')}
                    style={{ fontSize: '0.9rem', fontWeight: 600, padding: '8px 12px', width: '100%', maxWidth: 350, cursor: 'pointer' }}>
                    <option value="full">💵 Thanh toán hết (100%)</option>
                    <option value="partial">📊 Thanh toán 1 phần (theo đợt)</option>
                  </select>

                  {paymentType === 'partial' && (
                    <div style={{ marginTop: 12, padding: '12px', borderRadius: 8, border: '1px dashed #f59e0b', background: '#fffbeb' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Mốc thanh toán</span>
                        {isActive && (
                          <button type="button" onClick={() => setPaymentMilestones(prev => [...prev, { label: `Đợt ${prev.length + 1}`, percent: '', date: '' }])}
                            style={{ fontSize: '0.75rem', color: '#f59e0b', background: 'none', border: '1px dashed #f59e0b', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                            + Thêm đợt
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.5fr 1fr 30px', gap: 6, padding: '2px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                        {['Đợt', '% thanh toán', 'Ngày dự kiến', ''].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {paymentMilestones.map((pm, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.5fr 1fr 30px', gap: 6, padding: '3px 0', alignItems: 'center' }}>
                          <input className="input" value={pm.label} disabled={!isActive}
                            onChange={e => setPaymentMilestones(prev => prev.map((p, i) => i === idx ? { ...p, label: e.target.value } : p))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                          <input className="input" type="number" placeholder="%" value={pm.percent} disabled={!isActive}
                            onChange={e => setPaymentMilestones(prev => prev.map((p, i) => i === idx ? { ...p, percent: e.target.value } : p))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px', textAlign: 'right' }} />
                          <input className="input" type="date" value={pm.date} disabled={!isActive}
                            onChange={e => setPaymentMilestones(prev => prev.map((p, i) => i === idx ? { ...p, date: e.target.value } : p))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                          {isActive && paymentMilestones.length > 1 && (
                            <button type="button" onClick={() => setPaymentMilestones(prev => prev.filter((_, i) => i !== idx))}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700 }}>−</button>
                          )}
                        </div>
                      ))}
                      {paymentMilestones.filter(p => Number(p.percent) > 0).length > 0 && (
                        <div style={{ marginTop: 6, fontSize: '0.75rem', color: paymentMilestones.reduce((s, p) => s + (Number(p.percent) || 0), 0) === 100 ? '#16a34a' : '#dc2626' }}>
                          Tổng: <strong>{paymentMilestones.reduce((s, p) => s + (Number(p.percent) || 0), 0)}%</strong>
                          {paymentMilestones.reduce((s, p) => s + (Number(p.percent) || 0), 0) !== 100 && ' ⚠️ Cần đúng 100%'}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Delivery Plan Dropdown */}
                <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #0ea5e9' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0ea5e9' }}>🚚 Kế hoạch giao hàng</h3>
                  <select className="input" value={deliveryType} disabled={!isActive}
                    onChange={e => setDeliveryType(e.target.value as 'full' | 'batch')}
                    style={{ fontSize: '0.9rem', fontWeight: 600, padding: '8px 12px', width: '100%', maxWidth: 350, cursor: 'pointer' }}>
                    <option value="full">📦 Giao hàng toàn bộ (1 lần)</option>
                    <option value="batch">📋 Giao từng lần (nhiều đợt)</option>
                  </select>

                  {deliveryType === 'batch' && (
                    <div style={{ marginTop: 12, padding: '12px', borderRadius: 8, border: '1px dashed #0ea5e9', background: '#f0f9ff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Chi tiết giao hàng từng lần</span>
                        {isActive && (
                          <button type="button" onClick={() => setDeliveryBatches(prev => [...prev, { material: '', qty: '', date: '' }])}
                            style={{ fontSize: '0.75rem', color: '#0ea5e9', background: 'none', border: '1px dashed #0ea5e9', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                            + Thêm lần giao
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '30px 1.2fr 0.6fr 1fr 30px', gap: 6, padding: '2px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                        {['#', 'Vật tư giao', 'Khối lượng', 'Ngày giao', ''].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {deliveryBatches.map((db, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 1.2fr 0.6fr 1fr 30px', gap: 6, padding: '3px 0', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>L{idx + 1}</span>
                          <input className="input" placeholder="Tên vật tư" value={db.material} disabled={!isActive}
                            onChange={e => setDeliveryBatches(prev => prev.map((d, i) => i === idx ? { ...d, material: e.target.value } : d))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                          <input className="input" type="number" placeholder="0" value={db.qty} disabled={!isActive}
                            onChange={e => setDeliveryBatches(prev => prev.map((d, i) => i === idx ? { ...d, qty: e.target.value } : d))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px', textAlign: 'right' }} />
                          <input className="input" type="date" value={db.date} disabled={!isActive}
                            onChange={e => setDeliveryBatches(prev => prev.map((d, i) => i === idx ? { ...d, date: e.target.value } : d))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                          {isActive && deliveryBatches.length > 1 && (
                            <button type="button" onClick={() => setDeliveryBatches(prev => prev.filter((_, i) => i !== idx))}
                              style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700 }}>−</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* P4.1: Kế toán — Payment milestone confirmation */}
            {task.stepCode === 'P4.1' && previousStepData?.poData && (() => {
              const pd = previousStepData.poData as { paymentType?: string; paymentMilestones?: { label: string; percent: string; date: string }[]; poNumber?: string; totalAmount?: string; [k: string]: unknown }
              const pType = pd?.paymentType || 'full'
              const milestonesList = pType === 'partial' && pd?.paymentMilestones ? pd.paymentMilestones : [{ label: 'Thanh toán toàn bộ', percent: '100', date: '' }]
              // Initialize paymentConfirmations if empty
              if (paymentConfirmations.length === 0 && milestonesList.length > 0) {
                setTimeout(() => setPaymentConfirmations(milestonesList.map(() => ({ confirmed: false, method: '' }))), 0)
              }
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b' }}>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: '#f59e0b' }}>💰 Các đợt thanh toán từ Thương mại</h3>
                  {pd?.poNumber && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 10 }}>
                      PO: <strong>{pd.poNumber as string}</strong>{pd?.totalAmount ? ` — Tổng: ${Number(pd.totalAmount).toLocaleString('vi-VN')} ₫` : ''}
                    </div>
                  )}
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 0.5fr 0.8fr 1fr 0.8fr 30px', gap: 6, padding: '8px 10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                      {['', 'Đợt', '%', 'Ngày DK', 'PT thanh toán', 'Ngày TT', '✓'].map(h => (
                        <span key={h} style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                      ))}
                    </div>
                    {/* Rows */}
                    {milestonesList.map((ms, idx) => {
                      const conf = paymentConfirmations[idx] || { confirmed: false, method: '', paidDate: '' }
                      return (
                        <div key={idx} style={{
                          display: 'grid', gridTemplateColumns: '30px 1fr 0.5fr 0.8fr 1fr 0.8fr 30px', gap: 6, padding: '8px 10px',
                          alignItems: 'center', borderBottom: idx < milestonesList.length - 1 ? '1px solid var(--border)' : 'none',
                          background: conf.confirmed ? '#f0fdf4' : 'transparent'
                        }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{idx + 1}</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{ms.label}</span>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b' }}>{ms.percent}%</span>
                          <span style={{ fontSize: '0.8rem' }}>{ms.date || '—'}</span>
                          <select className="input" value={conf.method} disabled={!isActive}
                            onChange={e => setPaymentConfirmations(prev => prev.map((c, i) => i === idx ? { ...c, method: e.target.value } : c))}
                            style={{ fontSize: '0.8rem', padding: '4px 6px', cursor: 'pointer' }}>
                            <option value="">-- Chọn --</option>
                            <option value="transfer">Chuyển khoản</option>
                            <option value="cash">Tiền mặt</option>
                            <option value="lc">LC</option>
                          </select>
                          <input className="input" type="date" value={(conf as unknown as { paidDate?: string }).paidDate || ''} disabled={!isActive}
                            onChange={e => setPaymentConfirmations(prev => prev.map((c, i) => i === idx ? { ...c, paidDate: e.target.value } : c))}
                            style={{ fontSize: '0.75rem', padding: '4px 4px' }} />
                          <input type="checkbox" checked={conf.confirmed} disabled={!isActive}
                            onChange={e => setPaymentConfirmations(prev => prev.map((c, i) => i === idx ? { ...c, confirmed: e.target.checked } : c))}
                            style={{ width: 18, height: 18, cursor: isActive ? 'pointer' : 'default' }} />
                        </div>
                      )
                    })}
                  </div>
                  {/* Summary */}
                  <div style={{ marginTop: 8, fontSize: '0.8rem', display: 'flex', gap: 16 }}>
                    <span>Đã xác nhận: <strong style={{ color: '#16a34a' }}>{paymentConfirmations.filter(c => c.confirmed).length}/{milestonesList.length}</strong> đợt</span>
                    <span>Tổng %: <strong>{milestonesList.filter((_, i) => paymentConfirmations[i]?.confirmed).reduce((s, m) => s + (Number(m.percent) || 0), 0)}%</strong></span>
                  </div>
                </div>
              )
            })()}

            {/* P4.2: Delivery tracking — materials + NCC + received qty */}
            {task.stepCode === 'P4.2' && previousStepData && (() => {
              const sd = previousStepData.supplierData as { suppliers?: { name: string; quotes: { material: string; price: string }[] }[] } | null
              const nccList = (sd?.suppliers || []).filter(s => s.name?.trim())
              if (nccList.length === 0) return null
              // Build materials list with best NCC
              const allMats = [...new Set(nccList.flatMap(s => (s.quotes || []).filter(q => q.material?.trim()).map(q => q.material.trim())))]
              const matItems = allMats.map(mat => {
                const prices = nccList.map(s => {
                  const q = (s.quotes || []).find(q => q.material?.trim().toLowerCase() === mat.toLowerCase())
                  return { ncc: s.name, price: q ? Number(q.price) || 0 : 0 }
                }).filter(p => p.price > 0)
                const best = prices.length > 0 ? prices.reduce((a, b) => a.price <= b.price ? a : b) : { ncc: '—', price: 0 }
                return { material: mat, ncc: best.ncc }
              })
              // receivedQty stored in formData as receivedQty_0, receivedQty_1, etc.
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #16a34a' }}>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#16a34a' }}>📦 Danh sách vật tư theo dõi giao hàng</h3>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)', width: 30 }}>#</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>Vật tư</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>NCC cung cấp</th>
                          <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, borderBottom: '2px solid var(--border)', color: '#f59e0b' }}>SL thực nhận</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matItems.map((item, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                            <td style={{ padding: '6px 8px', fontWeight: 500 }}>{item.material}</td>
                            <td style={{ padding: '6px 8px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: '#dbeafe', color: '#1d4ed8' }}>{item.ncc}</span>
                            </td>
                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                              <input
                                className="input"
                                type="text"
                                placeholder="Nhập SL"
                                disabled={!isActive}
                                value={(formData[`receivedQty_${idx}`] as string) || ''}
                                onChange={e => setFormData(prev => ({ ...prev, [`receivedQty_${idx}`]: e.target.value }))}
                                style={{ width: 90, fontSize: '0.8rem', padding: '4px 6px', textAlign: 'center' }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}

            {/* P4.3: QC inspection — show approved PO (best price per material) */}
            {task.stepCode === 'P4.3' && previousStepData && (() => {
              const pd = previousStepData.poData as { poNumber?: string; totalAmount?: string; [k: string]: unknown } | null
              const sd = previousStepData.supplierData as { suppliers?: { name: string; quotes: { material: string; price: string }[] }[] } | null
              const nccList = (sd?.suppliers || []).filter(s => s.name?.trim())
              if (!pd && nccList.length === 0) return null
              // Build best-price materials (approved PO)
              const allMats = [...new Set(nccList.flatMap(s => (s.quotes || []).filter(q => q.material?.trim()).map(q => q.material.trim())))]
              const bestItems = allMats.map(mat => {
                const prices = nccList.map(s => {
                  const q = (s.quotes || []).find(q => q.material?.trim().toLowerCase() === mat.toLowerCase())
                  return { ncc: s.name, price: q ? Number(q.price) || 0 : 0 }
                }).filter(p => p.price > 0)
                const best = prices.length > 0 ? prices.reduce((a, b) => a.price <= b.price ? a : b) : { ncc: '—', price: 0 }
                return { material: mat, bestPrice: best.price, bestNCC: best.ncc }
              })
              const grandTotal = bestItems.reduce((sum, item) => sum + item.bestPrice, 0)
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #0ea5e9' }}>
                  <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#0ea5e9' }}>📦 Vật tư cần nghiệm thu</h3>
                  {pd?.poNumber && (
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '8px 14px', marginBottom: 10, fontSize: '0.85rem' }}>
                      📋 PO: <strong>{pd.poNumber as string}</strong>
                      {pd?.totalAmount && <> — 💰 Tổng PO: <strong>{Number(pd.totalAmount).toLocaleString('vi-VN')} ₫</strong></>}
                    </div>
                  )}
                  {bestItems.length > 0 && (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-secondary)' }}>
                            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)', width: 30 }}>#</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>Vật tư</th>
                            <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>NCC</th>
                            <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, borderBottom: '2px solid var(--border)' }}>Giá (VND)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bestItems.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{idx + 1}</td>
                              <td style={{ padding: '6px 8px', fontWeight: 500 }}>{item.material}</td>
                              <td style={{ padding: '6px 8px' }}>
                                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: '#dbeafe', color: '#1d4ed8' }}>{item.bestNCC}</span>
                              </td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{item.bestPrice > 0 ? `${item.bestPrice.toLocaleString('vi-VN')} ₫` : '—'}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: '2px solid var(--border)', background: '#f0f9ff' }}>
                            <td colSpan={3} style={{ padding: '8px', fontWeight: 700, fontSize: '0.85rem', color: '#0369a1' }}>TỔNG GIÁ TRỊ PO</td>
                            <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, fontSize: '0.9rem', color: '#0369a1' }}>{grandTotal.toLocaleString('vi-VN')} ₫</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* P4.4: Warehouse receipt — per-material qty + storage location */}
            {task.stepCode === 'P4.4' && previousStepData && (() => {
              const qd = previousStepData.qcData as { inspectionResult?: string; [k: string]: unknown } | null
              const sd = previousStepData.supplierData as { suppliers?: { name: string; quotes: { material: string; price: string }[] }[] } | null
              const prItems = (previousStepData.prItems as { name: string; quantity: string; unit: string }[]) || []
              const qcResult = qd?.inspectionResult || 'N/A'
              const nccList = (sd?.suppliers || []).filter(s => s.name?.trim())
              // Build best-price materials (QAQC approved)
              const allMats = [...new Set(nccList.flatMap(s => (s.quotes || []).filter(q => q.material?.trim()).map(q => q.material.trim())))]
              const materials = allMats.map(mat => {
                const prices = nccList.map(s => {
                  const q = (s.quotes || []).find(q => q.material?.trim().toLowerCase() === mat.toLowerCase())
                  return { ncc: s.name, price: q ? Number(q.price) || 0 : 0 }
                }).filter(p => p.price > 0)
                const best = prices.length > 0 ? prices.reduce((a, b) => a.price <= b.price ? a : b) : { ncc: '—', price: 0 }
                // Find PR qty for this material (fuzzy match: exact, then includes)
                const matLower = mat.toLowerCase()
                const prItem = prItems.find(p => p.name?.trim().toLowerCase() === matLower)
                  || prItems.find(p => p.name?.trim().toLowerCase().includes(matLower) || matLower.includes(p.name?.trim().toLowerCase()))
                const prQty = prItem ? Number(prItem.quantity) || 0 : 0
                return { material: mat, ncc: best.ncc, price: String(best.price), prQty }
              })
              // Init warehouseItems if empty
              if (warehouseItems.length === 0 && materials.length > 0) {
                setTimeout(() => setWarehouseItems(materials.map(m => ({ ...m, receivedQty: '', storageLocation: '' }))), 0)
              }
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: `4px solid ${qcResult === 'PASS' ? '#16a34a' : qcResult === 'CONDITIONAL' ? '#f59e0b' : '#dc2626'}` }}>
                  <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', color: qcResult === 'PASS' ? '#16a34a' : '#f59e0b' }}>
                    📦 Vật tư cần nghiệm thu — <span style={{ background: qcResult === 'PASS' ? '#dcfce7' : '#fef3c7', padding: '2px 10px', borderRadius: 6, fontSize: '0.8rem' }}>{qcResult}</span>
                  </h3>
                  {materials.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Chưa có dữ liệu vật tư.</div>
                  ) : (
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
                      {/* Header */}
                      <div style={{ display: 'grid', gridTemplateColumns: '30px 1fr 0.8fr 0.6fr 0.7fr 1fr', gap: 6, padding: '8px 10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        {['#', 'Vật tư', 'NCC', 'Giá', 'SL thực nhận', 'Vị trí lưu trữ'].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {/* Rows */}
                      {materials.map((m, idx) => {
                        const wi = warehouseItems[idx] || { receivedQty: '', storageLocation: '' }
                        const receivedNum = Number(wi.receivedQty) || 0
                        const isOverQty = m.prQty > 0 && receivedNum > m.prQty
                        return (
                          <div key={idx}>
                            <div style={{
                              display: 'grid', gridTemplateColumns: '30px 1fr 0.8fr 0.6fr 0.7fr 1fr', gap: 6, padding: '8px 10px',
                              alignItems: 'center', borderBottom: isOverQty ? 'none' : (idx < materials.length - 1 ? '1px solid var(--border)' : 'none'),
                              background: isOverQty ? '#fef2f2' : (wi.receivedQty && wi.storageLocation ? '#f0fdf4' : 'transparent')
                            }}>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{idx + 1}</span>
                              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{m.material}</span>
                              <span style={{ fontSize: '0.8rem' }}>
                                <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 600, background: '#dbeafe', color: '#1d4ed8' }}>{m.ncc}</span>
                              </span>
                              <span style={{ fontSize: '0.8rem', textAlign: 'right' }}>{Number(m.price).toLocaleString('vi-VN')} ₫</span>

                              <input className="input" type="number" placeholder="SL" disabled={!isActive}
                                value={wi.receivedQty}
                                onChange={e => setWarehouseItems(prev => prev.map((w, i) => i === idx ? { ...w, receivedQty: e.target.value } : w))}
                                style={{ fontSize: '0.8rem', padding: '4px 6px', width: '100%', borderColor: isOverQty ? '#dc2626' : undefined }} />
                              <input className="input" type="text" placeholder="Vị trí..." disabled={!isActive}
                                value={wi.storageLocation}
                                onChange={e => setWarehouseItems(prev => prev.map((w, i) => i === idx ? { ...w, storageLocation: e.target.value } : w))}
                                style={{ fontSize: '0.8rem', padding: '4px 6px', width: '100%' }} />
                            </div>
                            {isOverQty && (
                              <div style={{ padding: '2px 10px 6px 36px', fontSize: '0.72rem', color: '#dc2626', fontWeight: 600, background: '#fef2f2', borderBottom: idx < materials.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                ⚠️ SL thực nhận ({receivedNum}) vượt quá SL PR đã chốt ({m.prQty})
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {/* Summary */}
                  <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Đã nhập: <strong style={{ color: '#16a34a' }}>{warehouseItems.filter(w => w.receivedQty && w.storageLocation).length}/{materials.length}</strong> vật tư
                  </div>
                </div>
              )
            })()}

            {/* P4.5: Material Issue — WO items from P3.4 + inventory */}
            {task.stepCode === 'P4.5' && previousStepData && (() => {
              const wd = previousStepData.woData as { woItems?: { costCode: string; content: string; jobCode: string; typeCode: string; unit: string; qty1: string; qty2: string; totalQty: string; startDate: string; endDate: string }[]; [k: string]: unknown } | null
              const inv = (previousStepData.inventory as { code: string; name: string; spec: string | null; stock: number; unit: string; category: string }[]) || []
              const woItems = wd?.woItems?.filter((w: { content?: string }) => w.content?.trim()) || []
              // Parse issueItems from formData
              const issueItemsRaw = formData.issueItems as string | undefined
              let issueItems: { name: string; code: string; spec: string; qty: string; unit: string }[] = []
              try { issueItems = issueItemsRaw ? JSON.parse(issueItemsRaw as string) : [] } catch { issueItems = [] }
              if (issueItems.length === 0) issueItems = [{ name: '', code: '', spec: '', qty: '', unit: '' }]
              const updateIssueItems = (items: typeof issueItems) => {
                handleFieldChange('issueItems', JSON.stringify(items))
              }
              const ld = previousStepData.lsxData as { subconTeam?: string; jobName?: string; jobCode?: string; assignedQty?: string; startDate?: string; endDate?: string; [k: string]: unknown } | null
              return (
                <>
                  {/* Inventory overview — collapsible */}
                  <details className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #16a34a' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '1rem', fontWeight: 700, color: '#16a34a', listStyle: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ transition: 'transform 0.2s' }}>▶</span> 📦 Tồn kho hiện tại ({inv.length} vật tư)
                      <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 'auto' }}>Nhấn để xem</span>
                    </summary>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginTop: 10 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '30px 0.7fr 1.2fr 0.8fr 0.6fr 0.5fr', gap: 4, padding: '6px 10px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        {['#', 'Mã VT', 'Tên', 'Quy chuẩn', 'Tồn kho', 'ĐVT'].map(h => (
                          <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                        ))}
                      </div>
                      {inv.map((m, idx) => (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 0.7fr 1.2fr 0.8fr 0.6fr 0.5fr', gap: 4, padding: '5px 10px', fontSize: '0.8rem', borderBottom: idx < inv.length - 1 ? '1px solid var(--border)' : 'none', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent' }}>
                          <span style={{ color: 'var(--text-muted)' }}>{idx + 1}</span>
                          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{m.code}</span>
                          <span style={{ fontWeight: 600 }}>{m.name}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{m.spec || '—'}</span>
                          <span style={{ fontWeight: 700, color: m.stock > 0 ? '#16a34a' : '#dc2626' }}>{m.stock.toLocaleString('vi-VN')}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{m.unit}</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  {/* P3.3 LSX thầu phụ */}
                  {ld && (ld.subconTeam || ld.jobName) && (
                    <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #8b5cf6' }}>
                      <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#8b5cf6' }}>📑 Lệnh Sản Xuất — Thầu phụ (P3.3)</h3>
                      <div className="card" style={{ padding: '0.75rem', borderLeft: '3px solid #8b5cf6' }}>
                        {ld.subconTeam && <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>🏗️ Tổ thầu phụ: {ld.subconTeam}</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {ld.jobName && <span>Công việc: <strong style={{ color: 'var(--text-primary)' }}>{ld.jobName}</strong></span>}
                          {ld.jobCode && <span>Mã CV: <strong style={{ color: 'var(--text-primary)' }}>{ld.jobCode}</strong></span>}
                          {ld.assignedQty && <span>KL giao: <strong style={{ color: 'var(--text-primary)' }}>{ld.assignedQty}</strong></span>}
                          {ld.startDate && <span>Bắt đầu: <strong style={{ color: 'var(--text-primary)' }}>{ld.startDate}</strong></span>}
                          {ld.endDate && <span>Kết thúc: <strong style={{ color: 'var(--text-primary)' }}>{ld.endDate}</strong></span>}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* P3.4 LSX nội bộ */}
                  {woItems.length > 0 && (
                    <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #f59e0b' }}>
                      <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#f59e0b' }}>📋 Lệnh Sản Xuất (P3.4)</h3>
                      {woItems.map((wo: { costCode: string; content: string; jobCode: string; typeCode: string; unit: string; totalQty: string }, wIdx: number) => (
                        <div key={wIdx} className="card" style={{ padding: '0.75rem', marginBottom: 8, borderLeft: `3px solid hsl(${wIdx * 40 + 30}, 70%, 50%)` }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 6 }}>Công việc {wIdx + 1}: {wo.content}</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <span>Mã CP: <strong style={{ color: 'var(--text-primary)' }}>{wo.costCode || '—'}</strong></span>
                            <span>Mã CV: <strong style={{ color: 'var(--text-primary)' }}>{wo.jobCode || '—'}</strong></span>
                            <span>Tổng KL: <strong style={{ color: 'var(--text-primary)' }}>{wo.totalQty || '—'} {wo.unit}</strong></span>
                            <span>Mã CL: <strong style={{ color: 'var(--text-primary)' }}>{wo.typeCode || '—'}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* P4.5 Custom Request UI */}
                  {(() => {
                    const reqs = ((task.resultData as Record<string, any>)?.materialIssueRequests as Record<string, any>[]) || []
                    if (reqs.length === 0) return null
                    return (
                      <div className="card" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid #0ea5e9' }}>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#0ea5e9' }}>
                          🧾 Đề nghị cấp ({reqs.length})
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1.2fr', gap: 10, padding: '8px 12px', background: 'var(--bg-secondary)', borderBottom: '2px solid var(--border)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          <span>Mã & Tên VT</span>
                          <span style={{ textAlign: 'center' }}>Quy chuẩn</span>
                          <span style={{ textAlign: 'center' }}>SL Đề nghị</span>
                          <span style={{ textAlign: 'center' }}>Thực xuất / Tồn kho</span>
                        </div>
                        {reqs.map((req, idx) => {
                          const stockItem = inventoryMaterials.find(m => m.materialCode === req.code)
                          const currentStock = stockItem ? Number(stockItem.currentStock) : 0
                          const reqQty = Number(req.quantity) || 0
                          const sufficientStock = currentStock >= reqQty
                          
                          // Add 'Thực xuất' input logic
                          const txKey = `actualQty_${req.code}_${idx}`
                          const actualQtyStr = formData[txKey] as string
                          const updateTx = (val: string) => handleFieldChange(txKey, val)
                          
                          return (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1.2fr', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', alignItems: 'center' }}>
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--accent)' }}>{req.code}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{req.name}</div>
                              </div>
                              <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{req.spec || '—'}</div>
                              <div style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.9rem' }}>{reqQty.toLocaleString('vi-VN')} <span style={{fontSize:'0.75rem', color: 'var(--text-muted)'}}>{req.unit}</span></div>
                              
                              {stockItem ? (
                                <div style={{ textAlign: 'center' }}>
                                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: sufficientStock ? '#16a34a' : '#dc2626' }}>
                                    (Tồn: {currentStock.toLocaleString('vi-VN')} {stockItem.unit})
                                  </div>
                                  {!sufficientStock && <div style={{ fontSize: '0.7rem', color: '#dc2626', marginTop: 4, fontWeight: 600 }}>Tồn kho KHÔNG ĐỦ!</div>}
                                  {sufficientStock && isActive && (
                                     <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center' }}>
                                        <input className="input" type="number" placeholder="Số lượng thực xuất" value={actualQtyStr || ''} onChange={e => updateTx(e.target.value)} disabled={!isActive} style={{ fontSize:'0.8rem', padding: '6px 8px', textAlign: 'center', width: '130px', border: '1px solid #16a34a', background: '#f0fdf4' }} />
                                     </div>
                                  )}
                                  {isDone && (
                                     <div style={{ marginTop: 6, fontSize: '0.85rem', fontWeight: 700, color: '#16a34a' }}>
                                        Thực xuất: {actualQtyStr || 0}
                                     </div>
                                  )}
                                </div>
                              ) : (
                                <div style={{ textAlign: 'center', color: '#dc2626', fontWeight: 600, fontSize: '0.8rem' }}>Kho chưa có VT này</div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </>
              )
            })()}

            {/* P5.1: QR Scan section for viewing latest drawing */}
            {task.stepCode === 'P5.1' && (() => {
              const jcCode = formData.jobCardCode as string || ''
              const projectCode = task.project.projectCode || ''
              const qrContent = jcCode ? `https://erp.ibshi.com/drawing/${projectCode}/${jcCode}` : ''
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #8b5cf6' }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#8b5cf6' }}>📱 Scan QR — Xem bản vẽ mới nhất</h3>
                  {jcCode ? (
                    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                      <div style={{ background: '#fff', border: '2px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrContent)}`}
                          alt={`QR Code for ${jcCode}`}
                          width={160} height={160}
                          style={{ borderRadius: 8 }}
                        />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>{jcCode}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                          Quét mã QR bằng điện thoại để xem bản vẽ sản xuất mới nhất cho Job Card <strong style={{ color: 'var(--text-primary)' }}>{jcCode}</strong>
                        </div>
                        <div style={{ fontSize: '0.8rem', marginBottom: 6 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Dự án:</span> <strong>{projectCode}</strong>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                          🔗 <a href={qrContent} target="_blank" rel="noopener noreferrer" style={{ color: '#8b5cf6' }}>{qrContent}</a>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '1.5rem', textAlign: 'center', border: '2px dashed var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      ⬆️ Nhập <strong>Mã Job Card</strong> ở trên để tạo mã QR
                    </div>
                  )}
                </div>
              )
            })()}

            {/* P5.2: Multi Job Card form with nested stages */}
            {task.stepCode === 'P5.2' && (() => {
              const SX_TEAMS = [
                { value: 'TSX-01', label: 'Tổ 01 — Pha cắt' },
                { value: 'TSX-02', label: 'Tổ 02 — Gá lắp' },
                { value: 'TSX-03', label: 'Tổ 03 — Hàn' },
                { value: 'TSX-04', label: 'Tổ 04 — Gia công CK' },
                { value: 'TSX-05', label: 'Tổ 05 — Xử lý bề mặt' },
                { value: 'TSX-06', label: 'Tổ 06 — Sơn phủ' },
                { value: 'TSX-07', label: 'Tổ 07 — Đóng kiện' },
              ]
              type Stage = { hangMuc: string; volume: string; unit: string; team: string }
              type JobCard = { code: string; stages: Stage[] }
              const raw = formData.jobCards as string | undefined
              let jobCards: JobCard[] = []
              try { jobCards = raw ? JSON.parse(raw) : [] } catch { jobCards = [] }
              if (jobCards.length === 0) jobCards = [{ code: '', stages: [{ hangMuc: '', volume: '', unit: '', team: '' }] }]
              const save = (cards: JobCard[]) => handleFieldChange('jobCards', JSON.stringify(cards))
              const updateCard = (ci: number, field: string, val: string) => {
                const next = jobCards.map((c, i) => i === ci ? { ...c, [field]: val } : c)
                save(next)
              }
              const addStage = (ci: number) => {
                const next = jobCards.map((c, i) => i === ci ? { ...c, stages: [...c.stages, { hangMuc: '', volume: '', unit: '', team: '' }] } : c)
                save(next)
              }
              const removeStage = (ci: number, si: number) => {
                const next = jobCards.map((c, i) => i === ci ? { ...c, stages: c.stages.filter((_, j) => j !== si) } : c)
                save(next)
              }
              const updateStage = (ci: number, si: number, field: string, val: string) => {
                const next = jobCards.map((c, i) => i === ci ? { ...c, stages: c.stages.map((s, j) => j === si ? { ...s, [field]: val } : s) } : c)
                save(next)
              }
              const addCard = () => save([...jobCards, { code: '', stages: [{ hangMuc: '', volume: '', unit: '', team: '' }] }])
              const removeCard = (ci: number) => save(jobCards.filter((_, i) => i !== ci))
              const cardColors = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899']
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #3b82f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#3b82f6' }}>📋 Danh sách Job Card ({jobCards.length})</h3>
                    {isActive && (
                      <button type="button" onClick={addCard}
                        style={{ fontSize: '0.75rem', color: '#3b82f6', background: 'none', border: '1px dashed #3b82f6', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 600 }}>
                        + Thêm Job Card
                      </button>
                    )}
                  </div>
                  {jobCards.map((card, ci) => (
                    <div key={ci} style={{ border: `2px solid ${cardColors[ci % cardColors.length]}25`, borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
                      {/* Card header — just JC code */}
                      <div style={{ background: `${cardColors[ci % cardColors.length]}10`, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${cardColors[ci % cardColors.length]}25` }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: cardColors[ci % cardColors.length] }}>JC #{ci + 1}</span>
                        <input className="input" placeholder="Mã Job Card *" value={card.code} disabled={!isActive}
                          onChange={e => updateCard(ci, 'code', e.target.value)}
                          style={{ fontSize: '0.85rem', padding: '5px 8px', flex: 1, maxWidth: 200, fontWeight: 600 }} />
                        <div style={{ flex: 1 }} />
                        {isActive && jobCards.length > 1 && (
                          <button type="button" onClick={() => removeCard(ci)}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>✕ Xóa</button>
                        )}
                      </div>
                      {/* Stages table with Tổ SX per row */}
                      <div style={{ padding: '8px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Công đoạn ({card.stages.length})</span>
                          {isActive && (
                            <button type="button" onClick={() => addStage(ci)}
                              style={{ fontSize: '0.7rem', color: cardColors[ci % cardColors.length], background: 'none', border: `1px dashed ${cardColors[ci % cardColors.length]}`, borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
                              + Thêm
                            </button>
                          )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 1.2fr 1fr 0.8fr 0.7fr 28px', gap: 4, padding: '3px 0', borderBottom: '1px solid var(--border)', marginBottom: 3 }}>
                          {['#', 'Hạng mục', 'Tổ SX', 'KL hoàn thành', 'ĐVT', ''].map(h => (
                            <span key={h} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>{h}</span>
                          ))}
                        </div>
                        {card.stages.map((stage, si) => (
                          <div key={si} style={{ display: 'grid', gridTemplateColumns: '28px 1.2fr 1fr 0.8fr 0.7fr 28px', gap: 4, padding: '2px 0', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{si + 1}</span>
                            <input className="input" placeholder="Hạng mục" value={stage.hangMuc} disabled={!isActive}
                              onChange={e => updateStage(ci, si, 'hangMuc', e.target.value)}
                              style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                            <select className="input" value={stage.team || ''} disabled={!isActive}
                              onChange={e => updateStage(ci, si, 'team', e.target.value)}
                              style={{ fontSize: '0.78rem', padding: '4px 6px' }}>
                              <option value="">-- Tổ SX --</option>
                              {SX_TEAMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            <input className="input" type="number" placeholder="0" value={stage.volume} disabled={!isActive}
                              onChange={e => updateStage(ci, si, 'volume', e.target.value)}
                              style={{ fontSize: '0.8rem', padding: '4px 6px', textAlign: 'right' }} />
                            <input className="input" placeholder="ĐVT" value={stage.unit} disabled={!isActive}
                              onChange={e => updateStage(ci, si, 'unit', e.target.value)}
                              style={{ fontSize: '0.8rem', padding: '4px 6px' }} />
                            {isActive && card.stages.length > 1 && (
                              <button type="button" onClick={() => removeStage(ci, si)}
                                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, padding: 0 }}>−</button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* P5.3: Multi-item QC inspection form */}
            {task.stepCode === 'P5.3' && (() => {
              type QcItem = { task: string; result: string }
              const raw = formData.qcItems as string | undefined
              let qcItems: QcItem[] = []
              try { qcItems = raw ? JSON.parse(raw) : [] } catch { qcItems = [] }
              if (qcItems.length === 0) qcItems = [{ task: '', result: '' }]
              const saveQc = (items: QcItem[]) => handleFieldChange('qcItems', JSON.stringify(items))
              const hasFail = qcItems.some(q => q.result === 'FAIL')
              const resultColors: Record<string, { bg: string; color: string; border: string }> = {
                PASS: { bg: '#dcfce7', color: '#16a34a', border: '#bbf7d0' },
                FAIL: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
                CONDITIONAL: { bg: '#fef3c7', color: '#d97706', border: '#fde68a' },
              }
              return (
                <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: `4px solid ${hasFail ? '#dc2626' : '#8b5cf6'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: hasFail ? '#dc2626' : '#8b5cf6' }}>
                      🔍 Danh sách công việc nghiệm thu ({qcItems.length})
                    </h3>
                    {isActive && (
                      <button type="button" onClick={() => saveQc([...qcItems, { task: '', result: '' }])}
                        style={{ fontSize: '0.75rem', color: '#8b5cf6', background: 'none', border: '1px dashed #8b5cf6', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                        + Thêm
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '30px 1.5fr 1fr 30px', gap: 6, padding: '4px 0', borderBottom: '2px solid var(--border)', marginBottom: 4 }}>
                    {['#', 'Công việc kiểm tra', 'Kết quả', ''].map(h => (
                      <span key={h} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{h}</span>
                    ))}
                  </div>
                  {qcItems.map((item, idx) => {
                    const rc = resultColors[item.result]
                    return (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '30px 1.5fr 1fr 30px', gap: 6, padding: '4px 0', alignItems: 'center', background: rc?.bg || 'transparent', borderRadius: 6, marginBottom: 2, paddingLeft: 4, paddingRight: 4 }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{idx + 1}</span>
                        <input className="input" placeholder="Mô tả công việc cần kiểm tra" value={item.task} disabled={!isActive}
                          onChange={e => { const next = [...qcItems]; next[idx] = { ...next[idx], task: e.target.value }; saveQc(next) }}
                          style={{ fontSize: '0.8rem', padding: '5px 8px' }} />
                        <select className="input" value={item.result} disabled={!isActive}
                          onChange={e => { const next = [...qcItems]; next[idx] = { ...next[idx], result: e.target.value }; saveQc(next) }}
                          style={{ fontSize: '0.8rem', padding: '5px 8px', fontWeight: 700, color: rc?.color, background: rc?.bg, border: rc ? `1px solid ${rc.border}` : undefined }}>
                          <option value="">-- Chọn --</option>
                          <option value="PASS">✅ PASS</option>
                          <option value="FAIL">❌ FAIL</option>
                          <option value="CONDITIONAL">⚠️ CONDITIONAL</option>
                        </select>
                        {isActive && qcItems.length > 1 && (
                          <button type="button" onClick={() => saveQc(qcItems.filter((_, i) => i !== idx))}
                            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700, padding: 0 }}>−</button>
                        )}
                      </div>
                    )
                  })}
                  {/* Summary */}
                  <div style={{ marginTop: 10, padding: '8px 12px', background: hasFail ? '#fef2f2' : '#f0fdf4', borderRadius: 8, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {hasFail ? (
                      <>
                        <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ Có {qcItems.filter(q => q.result === 'FAIL').length} hạng mục FAIL</span>
                        <span style={{ color: '#dc2626' }}>— Chỉ có thể Từ chối → trả về P5.1</span>
                      </>
                    ) : (
                      <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ {qcItems.filter(q => q.result === 'PASS').length} PASS, {qcItems.filter(q => q.result === 'CONDITIONAL').length} CONDITIONAL</span>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* P5.4: Show SX report from P5.1 + P5.2 for PM review */}
            {task.stepCode === 'P5.4' && previousStepData && (() => {
              const jd = previousStepData.jobCardData as Record<string, unknown> | null
              const vd = previousStepData.volumeData as Record<string, unknown> | null
              if (!jd && !vd) return null

              // P5.1 data
              const jobCardCode = jd?.jobCardCode as string || ''
              const jobCardStatus = jd?.jobCardStatus as string || ''
              const fabricationProgress = jd?.fabricationProgress as number || 0
              const completedTasks = jd?.completedTasks as string || ''
              const issues = jd?.issues as string || ''

              // P5.2 data — multi job cards
              const weekNumber = vd?.weekNumber as string || ''
              type Stage = { hangMuc: string; volume: string; unit: string; team: string }
              type JobCard = { code: string; stages: Stage[] }
              let jobCards: JobCard[] = []
              try { jobCards = vd?.jobCards ? JSON.parse(vd.jobCards as string) : [] } catch { jobCards = [] }
              const cardColors = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444']
              const statusLabel: Record<string, { label: string; bg: string; color: string }> = {
                in_progress: { label: 'Đang thực hiện', bg: '#fef3c7', color: '#d97706' },
                done: { label: 'Hoàn thành', bg: '#dcfce7', color: '#16a34a' },
                paused: { label: 'Tạm dừng', bg: '#fee2e2', color: '#dc2626' },
                issue: { label: 'Vấn đề phát sinh', bg: '#fef2f2', color: '#dc2626' },
              }
              const st = statusLabel[jobCardStatus]
              return (
                <>
                  {/* P5.1: Job Card Status */}
                  {jd && (
                    <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid #10b981' }}>
                      <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#10b981' }}>🔧 Trạng thái SX (P5.1)</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, fontSize: '0.85rem' }}>
                        <div>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>Mã Job Card</span>
                          <div style={{ fontWeight: 700, color: '#10b981' }}>{jobCardCode || '—'}</div>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>Trạng thái</span>
                          <div>{st ? <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span> : '—'}</div>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>Tiến độ SX</span>
                          <div style={{ fontWeight: 700 }}>{fabricationProgress}%</div>
                        </div>
                      </div>
                      {completedTasks && (
                        <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          <strong>Công đoạn đã hoàn thành:</strong> {completedTasks}
                        </div>
                      )}
                      {issues && (
                        <div style={{ marginTop: 4, fontSize: '0.8rem', color: '#dc2626' }}>
                          <strong>⚠️ Vấn đề:</strong> {issues}
                        </div>
                      )}
                    </div>
                  )}

                  {/* P5.2: Volume Report — Job Cards */}
                  {vd && (
                    <div className="card" style={{ padding: '1.25rem', marginTop: '1rem', borderLeft: '4px solid #f59e0b' }}>
                      <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', color: '#f59e0b' }}>📊 Báo cáo khối lượng SX — Tuần {weekNumber || '—'} (P5.2)</h3>
                      {jobCards.length === 0 ? (
                        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 8, fontSize: '0.85rem' }}>
                          Chưa có dữ liệu báo cáo
                        </div>
                      ) : (
                        jobCards.map((card, ci) => (
                          <div key={ci} style={{ border: `1px solid ${cardColors[ci % cardColors.length]}30`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
                            <div style={{ background: `${cardColors[ci % cardColors.length]}10`, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${cardColors[ci % cardColors.length]}25` }}>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: cardColors[ci % cardColors.length] }}>JC #{ci + 1}</span>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{card.code || '—'}</span>
                            </div>
                            <div style={{ padding: '6px 12px' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '30px 2fr 1.2fr 100px 80px', gap: 8, padding: '3px 0', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
                                {['#', 'Hạng mục', 'Tổ SX', 'KL', 'ĐVT'].map(h => (
                                  <span key={h} style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)' }}>{h}</span>
                                ))}
                              </div>
                              {card.stages.map((stage, si) => (
                                <div key={si} style={{ display: 'grid', gridTemplateColumns: '30px 2fr 1.2fr 100px 80px', gap: 8, padding: '3px 0', fontSize: '0.8rem' }}>
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{si + 1}</span>
                                  <span style={{ fontWeight: 600 }}>{stage.hangMuc || '—'}</span>
                                  <span style={{ color: 'var(--text-secondary)' }}>{stage.team || '—'}</span>
                                  <span style={{ fontWeight: 700 }}>{stage.volume || '—'}</span>
                                  <span style={{ color: 'var(--text-muted)' }}>{stage.unit || '—'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )
            })()}

            {/* P5.4: Job Card summary + Pass/Fail + Form Fields */}
            {task.stepCode === 'P5.4' && (() => {
              const jd = previousStepData?.jobCardData as Record<string, string> | null
              const FAB_KEYS = ['CUT','FIT','WLD','MCH','TRF','FAT','BLS','FPC','PCK']
              const FAB_LABELS: Record<string, string> = { CUT:'Pha cắt', FIT:'Gá lắp', WLD:'Hàn', MCH:'Gia công CK', TRF:'Xử lý BM', FAT:'FAT', BLS:'Bắn bi', FPC:'Sơn phủ', PCK:'Đóng kiện' }
              const totalProgress = Number(jd?.fabricationProgress || 0)
              const allQty = jd ? FAB_KEYS.map(k => jd[`fab_${k}_qty`] || '').filter(Boolean) : []
              const acceptResult = (formData.acceptanceResult as string) || ''
              const resultColors: Record<string, { bg: string; border: string }> = {
                PASS: { bg: '#f0fdf4', border: '#bbf7d0' },
                FAIL: { bg: '#fef2f2', border: '#fecaca' },
                CONDITIONAL: { bg: '#fffbeb', border: '#fde68a' },
              }
              const rc = resultColors[acceptResult] || { bg: 'var(--bg-secondary)', border: 'var(--border)' }
              return (
                <>
                  {/* Job Card Summary */}
                  <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid #10b981', background: rc.bg, border: `1px solid ${rc.border}` }}>
                    <h3 style={{ marginTop: 0, fontSize: '1.1rem', color: '#10b981', marginBottom: 12 }}>
                      📋 Nghiệm thu Job Card: {jd?.jobCardCode || '—'}
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 16, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>Tiến độ SX</div>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: totalProgress >= 100 ? '#16a34a' : '#f59e0b' }}>{totalProgress}%</div>
                        <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', marginTop: 4 }}>
                          <div style={{ height: '100%', width: `${Math.min(totalProgress, 100)}%`, background: totalProgress >= 100 ? '#16a34a' : '#f59e0b', borderRadius: 3 }} />
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>KL hoàn thành</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, marginTop: 2 }}>{allQty.length > 0 ? allQty.join(', ') : '—'}</div>
                      </div>
                      <div>
                        <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Kết quả nghiệm thu *</label>
                        <select
                          className="input"
                          value={acceptResult}
                          disabled={!isActive}
                          onChange={e => handleFieldChange('acceptanceResult', e.target.value)}
                          style={{ width: '100%', padding: '8px 12px', fontSize: '0.9rem', fontWeight: 700, borderRadius: 8, border: `2px solid ${acceptResult === 'PASS' ? '#16a34a' : acceptResult === 'FAIL' ? '#dc2626' : acceptResult === 'CONDITIONAL' ? '#f59e0b' : 'var(--border)'}`, color: acceptResult === 'PASS' ? '#16a34a' : acceptResult === 'FAIL' ? '#dc2626' : acceptResult === 'CONDITIONAL' ? '#d97706' : undefined }}
                        >
                          <option value="">-- Chọn --</option>
                          <option value="PASS">✅ PASS — Đạt</option>
                          <option value="FAIL">❌ FAIL — Không đạt</option>
                          <option value="CONDITIONAL">⚠️ CONDITIONAL — Đạt có điều kiện</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  {/* Original form fields below — hidden for P3.3/P3.4 which use WBS-only workflow */}
                  {(task.stepCode as string) !== 'P3.3' && (task.stepCode as string) !== 'P3.4' && (
                  <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                    <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, marginBottom: 16 }}>
                      📝 Thông tin nhập liệu
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                      {config.fields.map(field => (
                        field.type === 'section' ? (
                          <div key={field.key} style={{ gridColumn: '1 / -1', marginTop: 12, paddingBottom: 6, borderBottom: '2px solid var(--accent-light, #c7d2fe)' }}>
                            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--accent)' }}>{field.label}</span>
                          </div>
                        ) : (
                          <div key={field.key} style={{ gridColumn: field.fullWidth ? '1 / -1' : undefined }}>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4, color: 'var(--text-secondary)' }}>
                              {field.label} {field.required && <span style={{ color: '#e74c3c' }}>*</span>}
                            </label>
                            {renderField(field, formData[field.key] ?? '', (v) => handleFieldChange(field.key, v), isActive)}
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                  )}
                </>
              )
            })()}

            {['P2.1', 'P2.2', 'P2.3'].includes(task.stepCode) && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem', borderLeft: '4px solid #0ea5e9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#0ea5e9' }}>
                    📋 Vật tư tồn kho hiện trường (Tất cả)
                  </h3>
                  <div style={{ position: 'relative', width: 280 }}>
                    <input type="text" className="input" placeholder="🔍 Tìm kiếm mã/tên VT..." 
                      value={inventorySearch} onChange={e => setInventorySearch(e.target.value)}
                      style={{ width: '100%', fontSize: '0.85rem', padding: '6px 12px 6px 30px', borderRadius: 20, border: '1px solid var(--border)' }} />
                    <span style={{ position: 'absolute', left: 10, top: 7, fontSize: '0.8rem' }}>🔍</span>
                  </div>
                </div>
                {inventoryLoading ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>⏳ Đang tải dữ liệu tồn kho...</div>
                ) : (() => {
                  const searchLower = inventorySearch.toLowerCase().trim()
                  const filtered = inventoryMaterials.filter(m => {
                    if (!searchLower) return true
                    return m.name.toLowerCase().includes(searchLower) ||
                      m.materialCode.toLowerCase().includes(searchLower) ||
                      (m.specification || '').toLowerCase().includes(searchLower) ||
                      m.category.toLowerCase().includes(searchLower) ||
                      m.unit.toLowerCase().includes(searchLower)
                  })

                  if (filtered.length === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', border: '2px dashed var(--border)', borderRadius: 10 }}>Chưa có vật tư nào phù hợp trong kho.</div>

                  return (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '40px 100px 1.5fr 1.2fr 80px 60px 50px', gap: 6, padding: '8px 4px', borderBottom: '2px solid var(--border)', background: 'var(--bg-secondary)' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên vật tư</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'right' }}>Tồn kho</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>ĐVT</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>Thêm</span>
                      </div>
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {filtered.map((m, idx) => (
                          <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '40px 100px 1.5fr 1.2fr 80px 60px 50px', gap: 6, padding: '5px 4px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.75rem' }}>{idx + 1}</span>
                            <span style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.75rem' }}>{m.materialCode}</span>
                            <span style={{ fontWeight: 600 }}>{m.name}</span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{m.specification || '—'}</span>
                            <span style={{ fontWeight: 700, color: m.currentStock > 100 ? '#16a34a' : '#dc2626', textAlign: 'right' }}>{m.currentStock.toLocaleString()}</span>
                            <span style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: '0.75rem' }}>{m.unit}</span>
                            <button type="button" onClick={() => {
                              if (task.stepCode === 'P2.1' || task.stepCode === 'P2.2' || task.stepCode === 'P2.3') {
                                setBomItems(prev => {
                                  // Find first empty row to replace, or append if none
                                  const idx = prev.findIndex(r => !r.name.trim() && !r.code.trim())
                                  if (idx >= 0) {
                                    const next = [...prev]
                                    next[idx] = { ...next[idx], name: m.name, code: m.materialCode, spec: m.specification || '', unit: m.unit }
                                    return next
                                  }
                                  return [...prev, { name: m.name, code: m.materialCode, spec: m.specification || '', quantity: '', unit: m.unit }]
                                })
                                setSuccessMsg('Đã thêm ' + m.materialCode + ' vào danh sách dưới.')
                                setTimeout(() => setSuccessMsg(''), 2000)
                              }
                            }}
                              disabled={!isActive}
                              title="Thêm vào BOM bên dưới"
                              style={{ background: '#0ea5e9', border: 'none', color: '#fff', borderRadius: 6, padding: '3px 0', width: '100%', cursor: isActive ? 'pointer' : 'not-allowed', fontSize: '0.85rem', fontWeight: 700, opacity: isActive ? 1 : 0.5 }}>
                              +
                            </button>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)', paddingTop: 8 }}>
                        Hiển thị <strong>{filtered.length}</strong> / {inventoryMaterials.length} vật tư tham khảo.
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* P3.3 & P3.4: WBS with LSX action buttons */}
            {(task.stepCode === 'P3.3' || task.stepCode === 'P3.4') && previousStepData?.plan?.wbsItems && (
              <div style={{ width: '100%', marginTop: '1rem' }}>
                <WbsTableUI
                  isWbsEditable={false}
                  wbsItemsData={(previousStepData.plan as Record<string, unknown>).wbsItems}
                  mode="lsx"
                  lsxStatus={(() => {
                    const rd = formData as Record<string, unknown>
                    return (rd.lsxStatus as Record<number, { lsx?: boolean; vt?: boolean }>) || {}
                  })()}
                  cellAssignments={(() => {
                    const rd = formData as Record<string, unknown>
                    try { return rd.cellAssignments ? (typeof rd.cellAssignments === 'string' ? JSON.parse(rd.cellAssignments as string) : rd.cellAssignments) as CellAssignMap : {} } catch { return {} }
                  })()}
                  onAssign={(ri, colKey, assigns) => {
                    const rd = formData as Record<string, unknown>
                    let existing: CellAssignMap = {}
                    try { existing = rd.cellAssignments ? (typeof rd.cellAssignments === 'string' ? JSON.parse(rd.cellAssignments as string) : rd.cellAssignments) as CellAssignMap : {} } catch { /* */ }
                    const updated = { ...existing, [ri]: { ...(existing[ri] || {}), [colKey]: assigns } }
                    handleFieldChange('cellAssignments', JSON.stringify(updated))
                    setSuccessMsg(`✅ Đã lưu phân giao ${assigns.length} tổ cho cột ${colKey}`)
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }}
                  onIssueLSX={(ri, row) => {
                    const existing = (formData as Record<string, unknown>).lsxStatus as Record<number, { lsx?: boolean; vt?: boolean }> || {}
                    const newStatus = { ...existing, [ri]: { ...existing[ri], lsx: true } }
                    handleFieldChange('lsxStatus', JSON.stringify(newStatus))
                    setSuccessMsg(`✅ Đã phát hành LSX cho: ${row.hangMuc || 'Hạng mục #' + (ri + 1)}`)
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }}
                  onRequestMaterial={(ri, row) => {
                    const existing = (formData as Record<string, unknown>).lsxStatus as Record<number, { lsx?: boolean; vt?: boolean }> || {}
                    const newStatus = { ...existing, [ri]: { ...existing[ri], vt: true } }
                    handleFieldChange('lsxStatus', JSON.stringify(newStatus))
                    setSuccessMsg(`✅ Đã đề nghị cấp VT cho: ${row.hangMuc || 'Hạng mục #' + (ri + 1)}`)
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }}
                  lsxIssuedDetails={(() => {
                    const rd = formData as Record<string, unknown>
                    try { return rd.lsxIssuedDetails ? (typeof rd.lsxIssuedDetails === 'string' ? JSON.parse(rd.lsxIssuedDetails as string) : rd.lsxIssuedDetails) as LsxIssuedMap : {} } catch { return {} }
                  })()}
                  onIssueSingleTeam={(ri, colKey, teamIdx) => {
                    const rd = formData as Record<string, unknown>
                    let existing: LsxIssuedMap = {}
                    try { existing = rd.lsxIssuedDetails ? (typeof rd.lsxIssuedDetails === 'string' ? JSON.parse(rd.lsxIssuedDetails as string) : rd.lsxIssuedDetails) as LsxIssuedMap : {} } catch { /* */ }
                    const updated = { ...existing, [ri]: { ...(existing[ri] || {}), [colKey]: { ...(existing[ri]?.[colKey] || {}), [teamIdx]: true } } }
                    handleFieldChange('lsxIssuedDetails', JSON.stringify(updated))
                    setSuccessMsg(`✅ Đã phát hành LSX cho tổ #${teamIdx + 1} - ${colKey}`)
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }}
                  materialRequests={(() => {
                    const rd = formData as Record<string, unknown>
                    try { return rd.materialRequests ? (typeof rd.materialRequests === 'string' ? JSON.parse(rd.materialRequests as string) : rd.materialRequests) as MaterialReqMap : {} } catch { return {} }
                  })()}
                  onUpdateMaterials={(ri, stageKey, teamIdx, items) => {
                    const rd = formData as Record<string, unknown>
                    let existing: MaterialReqMap = {}
                    try { existing = rd.materialRequests ? (typeof rd.materialRequests === 'string' ? JSON.parse(rd.materialRequests as string) : rd.materialRequests) as MaterialReqMap : {} } catch { /* */ }
                    const updated = {
                      ...existing,
                      [ri]: {
                        ...(existing[ri] || {}),
                        [stageKey]: {
                          ...((existing[ri] || {})[stageKey] || {}),
                          [teamIdx]: items
                        }
                      }
                    }
                    handleFieldChange('materialRequests', JSON.stringify(updated))
                    setSuccessMsg(`✅ Đã lưu ${items.length} vật tư cho đợt DNC`)
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }}
                  onRequestIssue={async (ri, stageKey, teamIdx, matIdx, material) => {
                    try {
                      // 1. Mark material as requested in state
                      const rd = formData as Record<string, unknown>
                      let existing: MaterialReqMap = {}
                      try { existing = rd.materialRequests ? (typeof rd.materialRequests === 'string' ? JSON.parse(rd.materialRequests as string) : rd.materialRequests) as MaterialReqMap : {} } catch { /* */ }
                      const currentItems = existing[ri]?.[stageKey]?.[teamIdx] || []
                      const updatedItems = currentItems.map((item, i) => i === matIdx ? { ...item, requested: true } : item)
                      const updatedMR = {
                        ...existing,
                        [ri]: {
                          ...(existing[ri] || {}),
                          [stageKey]: {
                            ...((existing[ri] || {})[stageKey] || {}),
                            [teamIdx]: updatedItems
                          }
                        }
                      }
                      handleFieldChange('materialRequests', JSON.stringify(updatedMR))

                      // 2. Activate P4.5 task via API
                      const res = await apiFetch('/api/tasks/activate', {
                        method: 'POST',
                        body: JSON.stringify({
                          projectId: task.projectId,
                          stepCode: 'P4.5',
                          materialInfo: {
                            name: material.name,
                            code: material.code,
                            spec: material.spec,
                            quantity: material.quantity,
                            unit: material.unit,
                            sourceStep: task.stepCode,
                            sourceRow: ri,
                            stageKey,
                            teamIdx,
                          }
                        })
                      })
                      if (res.ok) {
                        setSuccessMsg(`✅ Đã tạo đề nghị cấp P4.5 cho: ${material.name} (${material.quantity} ${material.unit})`)
                      } else {
                        setSuccessMsg(`✅ Đã đánh dấu đề nghị cấp: ${material.name} (${material.quantity} ${material.unit})`)
                      }
                    } catch {
                      setSuccessMsg(`✅ Đã đánh dấu đề nghị cấp: ${material.name}`)
                    }
                    setTimeout(() => setSuccessMsg(''), 4000)
                  }}
                  onSave={async () => {
                    try {
                      const res = await apiFetch(`/api/tasks/${task.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                          action: 'save',
                          resultData: formData,
                        }),
                      })
                      if (res.success !== false) {
                        setSuccessMsg('💾 Đã lưu trạng thái thành công!')
                      } else {
                        setError('Lỗi khi lưu. Vui lòng thử lại.')
                      }
                    } catch {
                      setError('Lỗi kết nối. Vui lòng thử lại.')
                    }
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }}
                />
              </div>
            )}

            {/* BOM Table — Editable for P2.1 (VT chính), P2.2 (VT hàn & sơn), P2.3 (VT phụ) */}
            {(task.stepCode === 'P2.1' || task.stepCode === 'P2.2' || task.stepCode === 'P2.3') && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', borderBottom: `2px solid ${(task.stepCode as string) === 'P3.3' ? '#f59e0b' : 'var(--accent)'}`, paddingBottom: 8, flex: 1 }}>
                    {(task.stepCode as string) === 'P3.3' ? '📋 Đề nghị cấp VT cho thầu phụ' : task.stepCode === 'P2.3' ? '📦 Đề xuất vật tư' : `📦 Danh sách vật tư ${task.stepCode === 'P2.1' ? '(BOM)' : '(Hàn & Sơn)'}`} {task.stepCode === 'P2.1' ? <span style={{ color: '#e74c3c', fontSize: '0.85rem' }}>* (tối thiểu 3 mục)</span> : <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>(không bắt buộc)</span>}
                  </h3>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={exportBomExcel}
                      style={{ padding: '8px 12px', fontSize: '0.85rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                      📥 Export Excel
                    </button>
                    {isActive && (
                      <button type="button" onClick={importBomExcel}
                        style={{ padding: '8px 12px', fontSize: '0.85rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
                        📤 Import Excel
                      </button>
                    )}
                    {isActive && (
                      <button type="button" onClick={addBomItem}
                        style={{
                          background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6,
                          padding: '8px 16px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                        ➕ Thêm VT
                      </button>
                    )}
                  </div>
                </div>
                {/* Table Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr 40px', gap: 8, marginBottom: 6, padding: '0 4px' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên VT *</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT *</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Số lượng</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                  <span></span>
                </div>
                {/* Table Rows */}
                {bomItems.map((item, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr 40px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{idx + 1}</span>
                    <input className="input" placeholder="Tên vật tư" value={item.name} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'name', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    <input className="input" placeholder="Mã VT" value={item.code} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'code', e.target.value)} style={{ fontSize: '0.85rem', fontFamily: 'monospace' }} />
                    <input className="input" placeholder="Quy chuẩn" value={item.spec} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'spec', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    <input className="input" type="number" placeholder="0" value={item.quantity} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'quantity', e.target.value)} style={{ fontSize: '0.85rem' }} />
                    <select className="input" value={item.unit} disabled={!isActive}
                      onChange={e => updateBomItem(idx, 'unit', e.target.value)} style={{ fontSize: '0.85rem', padding: '3px 2px' }}>
                      <option value="">-ĐVT-</option>
                      <option value="kg">kg</option>
                      <option value="tấn">tấn</option>
                      <option value="m">m</option>
                      <option value="m2">m2</option>
                      <option value="m3">m3</option>
                      <option value="cái">cái</option>
                      <option value="bộ">bộ</option>
                      <option value="lít">lít</option>
                      <option value="tháng">tháng</option>
                      <option value="giờ">giờ</option>
                    </select>
                    {isActive && (
                      <button type="button" onClick={() => removeBomItem(idx)}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1.1rem', fontWeight: 700, padding: 0 }}
                        title="Xóa dòng">−</button>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  Đã nhập: <strong>{bomItems.filter(b => b.name.trim()).length}</strong> / {bomItems.length} mục
                  {task.stepCode === 'P2.1' && bomItems.filter(b => b.name.trim() && b.code.trim()).length < 3 && (
                    <span style={{ color: '#dc2626', marginLeft: 10 }}>⚠️ Cần ít nhất 3 mục có tên + mã VT</span>
                  )}
                </div>
              </div>
            )}

            {/* P2.4: Show read-only BOM data from P2.1 */}
            {task.stepCode === 'P2.4' && previousStepData?.bom && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '2px solid var(--accent)', paddingBottom: 8, marginBottom: 16 }}>
                  📦 Danh sách vật tư BOM <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>(từ P2.1 - Thiết kế)</span>
                </h3>
                {previousStepData.bom.bomNotes && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: '0.85rem' }}>
                    <strong>Ghi chú BOM:</strong> {String(previousStepData.bom.bomNotes)}
                  </div>
                )}
                {previousStepData.bom.bomItems && (previousStepData.bom.bomItems as Array<{name: string; code: string; spec: string; quantity: string; unit: string}>).length > 0 ? (
                  <>
                    {/* Table Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr', gap: 8, marginBottom: 6, padding: '0 4px' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>#</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Tên VT</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Mã VT</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Quy chuẩn</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Số lượng</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐVT</span>
                    </div>
                    {/* Table Rows */}
                    {(previousStepData.bom.bomItems as Array<{name: string; code: string; spec: string; quantity: string; unit: string}>).map((item: {name: string; code: string; spec: string; quantity: string; unit: string}, idx: number) => (
                      <div key={idx} style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 1fr 1fr 0.7fr 0.7fr', gap: 8, padding: '8px 4px', background: idx % 2 === 0 ? 'var(--bg-secondary)' : 'transparent', borderRadius: 6, fontSize: '0.85rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{idx + 1}</span>
                        <span>{item.name}</span>
                        <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{item.code}</span>
                        <span>{item.spec || '—'}</span>
                        <span style={{ fontWeight: 600 }}>{item.quantity || '—'}</span>
                        <span>{item.unit || '—'}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      Tổng: <strong>{(previousStepData.bom.bomItems as Array<{name: string}>).length}</strong> mục vật tư
                    </div>
                  </>
                ) : (
                  <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Chưa có dữ liệu BOM</div>
                )}
              </div>
            )}

            {/* P3.4: Production Order - now handled via WBS LSX workflow */}

            {/* Milestones Section removed for P1.2A — MOM sections now handle project planning */}

            {/* Notes */}
            <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
              <h3 style={{ marginTop: 0, fontSize: '1rem' }}>💬 Ghi chú bổ sung</h3>
              <textarea
                value={submitNotes}
                onChange={e => setSubmitNotes(e.target.value)}
                disabled={!isActive}
                placeholder="Nhập ghi chú thêm nếu cần..."
                style={{
                  width: '100%', minHeight: 80, borderRadius: 8, border: '1px solid var(--border)',
                  padding: '0.75rem', fontSize: '0.9rem', resize: 'vertical',
                  background: 'var(--bg-secondary)',
                }}
              />
            </div>

            </>
            )}



            {/* P1.1B: Inline action buttons */}
            {task.stepCode === 'P1.1B' && isActive && (
              <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>🚀 Hành động</h3>
                <div style={{ display: 'flex', gap: 12, marginBottom: showRejectForm ? 16 : 0 }}>
                  <button
                    className="btn-accent"
                    onClick={() => handleSubmit('complete')}
                    disabled={submitting}
                    style={{ flex: 1, padding: '12px 20px', fontSize: '1rem' }}
                  >
                    {submitting ? '⏳ Đang xử lý...' : '✅ Phê duyệt triển khai'}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(!showRejectForm)}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: '12px 20px', fontSize: '1rem',
                      border: '2px solid #e74c3c', borderRadius: 10, background: showRejectForm ? '#fef2f2' : 'transparent',
                      color: '#e74c3c', cursor: 'pointer', fontWeight: 600,
                    }}
                  >
                    ❌ Từ chối / Yêu cầu chỉnh sửa
                  </button>
                </div>
                {showRejectForm && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '1.25rem', animation: 'fadeIn 0.3s ease' }}>
                    <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: 8, color: '#991b1b' }}>
                      📝 Lý do từ chối / Yêu cầu chỉnh sửa *
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Nhập lý do từ chối hoặc yêu cầu PM chỉnh sửa thông tin dự án..."
                      style={{
                        width: '100%', minHeight: 100, borderRadius: 8, border: '1px solid #fca5a5',
                        padding: '0.75rem', fontSize: '0.9rem', resize: 'vertical',
                        background: '#fff',
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (!rejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return }
                        setSubmitting(true)
                        setError('')
                        const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
                          method: 'POST',
                          body: JSON.stringify({ reason: rejectReason }),
                        })
                        if (res.success) {
                          setSuccessMsg(`✅ Đã từ chối. Quay về bước ${res.returnedTo}: ${res.returnedToName || ''}`)
                          setTimeout(() => router.push('/dashboard/tasks'), 2000)
                        } else {
                          setError(res.error || 'Lỗi khi từ chối')
                        }
                        setSubmitting(false)
                      }}
                      disabled={submitting}
                      style={{
                        marginTop: 12, padding: '10px 24px', fontSize: '0.95rem',
                        border: 'none', borderRadius: 8, background: '#dc2626',
                        color: '#fff', cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      {submitting ? '⏳...' : '⚠️ Xác nhận từ chối → Đẩy về PM chỉnh sửa'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div>
            {/* Checklist */}
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                ☑️ Checklist
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                  ({Object.values(checklistState).filter(Boolean).length}/{config.checklist.length})
                </span>
              </h3>
              {config.checklist
                .filter(item => !(task.stepCode === 'P5.1' && item.key.startsWith('fab_')))
                .map(item => (
                <label key={item.key} style={{
                  display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)',
                  cursor: isActive ? 'pointer' : 'default', fontSize: '0.85rem', alignItems: 'flex-start',
                }}>
                  <input
                    type="checkbox"
                    checked={checklistState[item.key] || false}
                    onChange={() => isActive && handleChecklistToggle(item.key)}
                    disabled={!isActive}
                    style={{ marginTop: 2, accentColor: 'var(--accent)' }}
                  />
                  <span>
                    {item.label}
                    {item.required && <span style={{ color: '#e74c3c', fontSize: '0.75rem' }}> *</span>}
                  </span>
                </label>
              ))}
            </div>

            {/* Previous Step Documents */}
            {previousStepFiles.length > 0 && (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>📂 Tài liệu từ các bước trước</h3>
                {previousStepFiles.map(step => (
                  <div key={step.stepCode} style={{ marginBottom: 12 }}>
                    <p style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      {step.stepCode} — {step.stepName}
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {step.files.map(f => (
                        <a
                          key={f.id}
                          href={f.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '6px 10px', borderRadius: 8,
                            background: 'var(--bg-secondary)', textDecoration: 'none',
                            color: 'var(--text-primary)', fontSize: '0.85rem',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span style={{ fontSize: '1rem' }}>
                            {f.mimeType?.includes('pdf') ? '📄' : f.mimeType?.includes('image') ? '🖼️' : f.mimeType?.includes('sheet') || f.fileName.match(/\.xlsx?$/) ? '📊' : '📎'}
                          </span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {f.fileName}
                          </span>
                          {f.fileSize && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                              {f.fileSize > 1048576 ? `${(f.fileSize / 1048576).toFixed(1)} MB` : `${Math.round(f.fileSize / 1024)} KB`}
                            </span>
                          )}
                          <span style={{ color: '#3b82f6', fontSize: '0.8rem', fontWeight: 600, flexShrink: 0 }}>⬇ Tải</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Attachments */}
            {config.attachments.length > 0 && (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>📎 Tài liệu đính kèm</h3>
                {config.attachments.map(att => (
                  <div key={att.key} style={{ paddingBottom: '10px', borderBottom: '1px solid var(--border)', marginBottom: '10px' }}>
                    <MultiFileUpload
                      label={att.label + (att.required ? ' *' : '')}
                      entityType="Task"
                      entityId={`${task.id}_${att.key}`}
                      accept={att.accept || undefined}
                      disabled={!isActive}
                      compact
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Import/Export */}
            {config.excelTemplate && (
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>📥 Excel Import/Export</h3>
                <button className="btn-accent" style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem', padding: '8px 12px' }}
                  onClick={() => {
                    const fields = config.fields.filter(f => f.type !== 'section' && f.type !== 'readonly')
                    const headers = fields.map(f => f.label)
                    const keys = fields.map(f => f.key)
                    const values = keys.map(k => formData[k] ?? '')
                    const ws = XLSX.utils.aoa_to_sheet([headers, values])
                    // Auto-size columns
                    ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 16) }))
                    const wb = XLSX.utils.book_new()
                    XLSX.utils.book_append_sheet(wb, ws, 'DuToan')
                    XLSX.writeFile(wb, `${config.excelTemplate}_template.xlsx`)
                  }}>
                  ⬇️ Tải template: {config.excelTemplate}
                </button>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Tải template → Nhập dữ liệu → Upload lại
                </div>
                <input type="file" accept=".xlsx,.xls,.csv"
                  disabled={!isActive}
                  style={{ fontSize: '0.8rem', width: '100%' }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      const buf = await file.arrayBuffer()
                      const wb = XLSX.read(buf, { type: 'array' })
                      const ws = wb.Sheets[wb.SheetNames[0]]
                      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
                      if (rows.length < 2) { setError('File không có dữ liệu'); return }
                      const headers = rows[0].map(h => String(h).trim())
                      const fields = config.fields.filter(f => f.type !== 'section' && f.type !== 'readonly')
                      const newData: Record<string, string | number> = {}
                      // Try all data rows (not just the first)
                      for (let r = 1; r < rows.length; r++) {
                        const vals = rows[r]
                        if (!vals || vals.length === 0) continue
                        fields.forEach(f => {
                          // Match by label (Vietnamese) or labelEn (English)
                          const colIdx = headers.findIndex(h =>
                            h === f.label || h === f.labelEn || h.toLowerCase() === f.label.toLowerCase()
                          )
                          if (colIdx >= 0 && vals[colIdx] != null && String(vals[colIdx]).trim()) {
                            const raw = String(vals[colIdx]).trim()
                            newData[f.key] = f.type === 'currency' || f.type === 'number'
                              ? Number(raw.replace(/[^\d.-]/g, '')) || raw
                              : raw
                          }
                        })
                      }
                      if (Object.keys(newData).length === 0) {
                        setError('Không tìm thấy trường dữ liệu nào khớp. Kiểm tra tên cột trong Excel.')
                        return
                      }
                      setFormData(prev => {
                        const next = { ...prev, ...newData }
                        // Recalculate total
                        if (config.fields.some(f => f.key === 'totalEstimate')) {
                          const currencyKeys = config.fields.filter(f => f.type === 'currency').map(f => f.key)
                          next.totalEstimate = currencyKeys.reduce((sum, k) => sum + (Number(next[k]) || 0), 0)
                        }
                        return next
                      })
                      setSuccessMsg(`✅ Đã import ${Object.keys(newData).length} trường từ Excel`)
                      setTimeout(() => setSuccessMsg(''), 3000)
                    } catch (err) {
                      setError('Lỗi khi đọc file. Vui lòng kiểm tra định dạng.')
                    }
                  }}
                />
              </div>
            )}

            {/* Actions — hidden for P1.1B and P1.3 since they have inline actions in main area */}
            {isActive && task.stepCode !== 'P1.1B' && task.stepCode !== 'P1.3' && task.stepCode !== 'P3.3' && task.stepCode !== 'P3.4' && (
              <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>🚀 Hành động</h3>
                {/* P4.3 + P5.3 + P5.4: Conditional buttons based on inspection/acceptance result, and P4.5 invalid stock */}
                {(task.stepCode !== 'P4.3' || !formData.inspectionResult || formData.inspectionResult === 'PASS' || formData.inspectionResult === 'CONDITIONAL') && (task.stepCode !== 'P5.3' || !(() => { try { const items = JSON.parse(formData.qcItems as string || '[]'); return items.some((q: {result: string}) => q.result === 'FAIL') } catch { return false } })()) && (task.stepCode !== 'P5.4' || !formData.acceptanceResult || formData.acceptanceResult === 'PASS' || formData.acceptanceResult === 'CONDITIONAL') && isP45Valid && (
                <button
                  className="btn-accent"
                  onClick={() => handleSubmit('complete')}
                  disabled={submitting}
                  style={{ width: '100%', padding: '10px', fontSize: '0.95rem', marginBottom: 8 }}
                >
                  {submitting ? '⏳ Đang xử lý...' : '✅ Hoàn thành bước này'}
                </button>
                )}
                {rule?.rejectTo && (task.stepCode !== 'P4.3' || !formData.inspectionResult || formData.inspectionResult === 'FAIL' || formData.inspectionResult === 'CONDITIONAL') && (task.stepCode !== 'P5.4' || !formData.acceptanceResult || formData.acceptanceResult === 'FAIL' || formData.acceptanceResult === 'CONDITIONAL') && (
                  <div>
                    <button
                      onClick={() => setShowRejectForm(!showRejectForm)}
                      disabled={submitting}
                      style={{
                        width: '100%', padding: '10px', fontSize: '0.85rem',
                        border: '1px solid #e74c3c', borderRadius: 8, background: showRejectForm ? '#fef2f2' : 'transparent',
                        color: '#e74c3c', cursor: 'pointer',
                      }}
                    >
                      ❌ Từ chối → {rule.rejectTo}
                    </button>
                    {showRejectForm && (
                      <div style={{ marginTop: 8 }}>
                        <textarea
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="Nhập lý do từ chối..."
                          rows={2}
                          style={{
                            width: '100%', borderRadius: 8, border: '1px solid #dc2626',
                            padding: '0.5rem', fontSize: '0.85rem', resize: 'vertical',
                            background: 'var(--bg-secondary)',
                          }}
                        />
                        <button
                          disabled={submitting}
                          onClick={async () => {
                            if (!rejectReason.trim()) { setError('Vui lòng nhập lý do từ chối'); return }
                            setSubmitting(true)
                            setError('')
                            // P5.3: Save QC items result data before rejecting
                            if (task.stepCode === 'P5.3' && formData.qcItems) {
                              await apiFetch(`/api/tasks/${taskId}`, {
                                method: 'PUT',
                                body: JSON.stringify({ action: 'save', resultData: { ...formData, checklist: checklistState } }),
                              })
                            }
                            const res = await apiFetch(`/api/tasks/${taskId}/reject`, {
                              method: 'POST',
                              body: JSON.stringify({ reason: rejectReason }),
                            })
                            if (res.success) {
                              setSuccessMsg(`✅ Đã từ chối → ${rule.rejectTo}`)
                              setTimeout(() => router.push('/dashboard/tasks'), 2000)
                            } else {
                              setError(res.error || 'Lỗi khi từ chối')
                            }
                            setSubmitting(false)
                          }}
                          style={{
                            marginTop: 6, width: '100%', padding: '8px', fontSize: '0.85rem',
                            background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8,
                            cursor: 'pointer', fontWeight: 600,
                          }}
                        >
                          {submitting ? '⏳ Đang xử lý...' : '⚠️ Xác nhận từ chối'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Back button */}
            <button
              onClick={() => router.push('/dashboard/tasks')}
              style={{
                width: '100%', padding: '10px', marginTop: 8, fontSize: '0.85rem',
                border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary)',
                cursor: 'pointer', color: 'var(--text-secondary)',
              }}
            >
              ← Quay lại danh sách công việc
            </button>
          </div>
        </div>
      ) : (
        /* Fallback for steps without config */
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)' }}>
            Bước <strong>{task.stepCode}</strong> chưa có form chi tiết. Bạn có thể ghi chú và hoàn thành.
          </p>
          <textarea
            value={submitNotes}
            onChange={e => setSubmitNotes(e.target.value)}
            disabled={!isActive}
            placeholder="Nhập ghi chú..."
            style={{
              width: '100%', minHeight: 100, borderRadius: 8, border: '1px solid var(--border)',
              padding: '0.75rem', marginBottom: '1rem',
            }}
          />
          {isActive && (
            <button className="btn-accent" onClick={() => handleSubmit('complete')} disabled={submitting}>
              {submitting ? '⏳...' : '✅ Hoàn thành'}
            </button>
          )}
        </div>
      )}

      {/* Assign Task Modal */}
      {showAssignModal && task && (
        <TaskAssignModal
          task={task}
          userList={userList}
          onClose={() => setShowAssignModal(false)}
          onSubmit={handleAssignTask}
        />
      )}
    </div>
  )
}

function TaskAssignModal({ task, userList, onClose, onSubmit }: {
  task: TaskData
  userList: { id: string; fullName: string; roleCode: string }[]
  onClose: () => void
  onSubmit: (userId: string) => void
}) {
  const [selectedUser, setSelectedUser] = useState('')
  const baseRole = task.assignedRole.replace(/[a-zA-Z]$/, '')
  const relevantUsers = userList.filter(u => u.roleCode.startsWith(baseRole))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="card w-full max-w-md rounded-2xl p-6 shadow-2xl relative" style={{ background: 'var(--bg-card, #fff)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-heading)' }}>👤 Phân công công việc</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-secondary)]" style={{ color: 'var(--text-muted)', fontSize: 20, lineHeight: 1 }}>&times;</button>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
          Bước <strong>{task.stepCode} — {task.stepName}</strong><br />
          Vai trò phụ trách: <span className="font-mono px-1 rounded" style={{ background: 'var(--bg-secondary)' }}>{task.assignedRole}</span>
        </p>

        {relevantUsers.length === 0 ? (
          <div className="py-8 text-center text-red-500">Không tìm thấy nhân viên nào thuộc {task.assignedRole}.</div>
        ) : (
          <div className="mb-6">
            <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>CHỌN NHÂN SỰ</label>
            <select
              className="w-full p-2.5 rounded-xl border"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)', outline: 'none' }}
              value={selectedUser}
              onChange={e => setSelectedUser(e.target.value)}
            >
              <option value="">-- Click để chọn --</option>
              {relevantUsers.map(u => (
                <option key={u.id} value={u.id}>{u.fullName} ({u.roleCode})</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-3 mt-4">
          <button onClick={onClose} className="px-4 py-2 font-semibold rounded-lg hover:opacity-80 transition" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>Hủy</button>
          <button
            onClick={() => { if (selectedUser) onSubmit(selectedUser) }}
            className="px-5 py-2 font-bold rounded-lg transition hover:opacity-90 disabled:opacity-50"
            style={{ background: '#3b82f6', color: 'white' }}
            disabled={relevantUsers.length === 0 || !selectedUser}
          >
            Lưu / Giao việc
          </button>
        </div>
      </div>
    </div>
  )
}

function renderField(
  field: FormField,
  value: string | number,
  onChange: (v: string | number) => void,
  enabled: boolean
) {
  const baseStyle = {
    width: '100%', borderRadius: 8, border: '1px solid var(--border)',
    padding: '0.6rem 0.75rem', fontSize: '0.9rem',
    background: field.type === 'readonly' ? 'var(--bg-tertiary, #f5f5f5)' : 'var(--bg-secondary)',
  }

  switch (field.type) {
    case 'readonly': {
      const display = typeof value === 'number' && value > 0
        ? value.toLocaleString('vi-VN') + (field.unit ? ` ${field.unit}` : '')
        : value || '—'
      const isTotalRow = field.key === 'totalEstimate'
      return <div style={{
        ...baseStyle, color: isTotalRow ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: isTotalRow ? 700 : 400, fontSize: isTotalRow ? '1.1rem' : undefined,
      }}>{display}</div>
    }

    case 'textarea':
      return (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          placeholder={field.placeholder}
          style={{ ...baseStyle, minHeight: 80, resize: 'vertical' }}
        />
      )

    case 'select':
      return (
        <select value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} style={baseStyle}>
          <option value="">-- Chọn --</option>
          {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )

    case 'radio':
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '4px 0' }}>
          {field.options?.map(o => (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.9rem', cursor: enabled ? 'pointer' : 'default' }}>
              <input type="radio" name={field.key} value={o.value}
                checked={value === o.value}
                onChange={() => onChange(o.value)}
                disabled={!enabled}
                style={{ accentColor: 'var(--accent)' }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )

    case 'date':
      return <input type="date" value={value} onChange={e => onChange(e.target.value)} disabled={!enabled} style={baseStyle} />

    case 'number':
    case 'currency':
      return (
        <input
          type="number"
          value={value === 0 ? '0' : (value || '')}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          disabled={!enabled}
          min={field.min}
          max={field.max}
          placeholder={field.placeholder}
          style={baseStyle}
        />
      )

    default:
      return (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          disabled={!enabled}
          placeholder={field.placeholder}
          style={baseStyle}
        />
      )
  }
}
