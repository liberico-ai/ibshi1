import React, { useState, useEffect, useRef } from "react";
import * as XLSX from 'xlsx';
import {  } from "lucide-react";
import type { TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, WbsRow } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { parseWbsExcel } from '@/lib/wbs-parser'
import { notify, confirmDialog } from '@/components/ui/Toast'
export type { TeamAssign, CellAssignMap, LsxIssuedMap, MaterialReqItem, MaterialReqMap, WbsRow }


export default function WbsTableUI({ isWbsEditable, wbsItemsData, onChange, mode, onIssueLSX, onRequestMaterial, lsxStatus, cellAssignments, onAssign, lsxIssuedDetails, onIssueSingleTeam, materialRequests, onUpdateMaterials, onRequestIssue, onSave, stepFilter, qcFailedAssignments, onCloneRework }: { isWbsEditable: boolean; wbsItemsData: any; onChange?: (val: string) => void; mode?: 'default' | 'lsx'; onIssueLSX?: (rowIndex: number, row: Record<string, string>) => void; onRequestMaterial?: (rowIndex: number, row: Record<string, string>) => void; lsxStatus?: Record<number, { lsx?: boolean; vt?: boolean }>; cellAssignments?: CellAssignMap; onAssign?: (rowIdx: number, colKey: string, assigns: TeamAssign[]) => void; lsxIssuedDetails?: LsxIssuedMap; onIssueSingleTeam?: (rowIdx: number, colKey: string, teamIdx: number) => void; materialRequests?: MaterialReqMap; onUpdateMaterials?: (rowIdx: number, stageKey: string, teamIdx: number, items: MaterialReqItem[]) => void; onRequestIssue?: (rowIdx: number, stageKey: string, teamIdx: number, matIdx: number, material: MaterialReqItem) => Promise<void>; onSave?: () => void; stepFilter?: string; qcFailedAssignments?: any[]; onCloneRework?: (rowIdx: number, stageKey: string, teamIdx: number) => void }) {
  const emptyRow = (): WbsRow => ({ stt: '', hangMuc: '', dvt: 'kg', khoiLuong: '', dienTich: '', baoOn: '', tongNhanLuc: '', phamVi: 'IBS', thauPhu: '', batDau: '', ketThuc: '', trangThai: '', cutting: '', machining: '', fitup: '', welding: '', tryAssembly: '', dismantle: '', blasting: '', galvanize: '', repairAfterGalv: '', painting: '', commissioning: '', insulation: '', linerPainting: '', shippingAssembly: '', khungKien: '', packing: '', delivery: '', khuVuc: '', ghiChu: '' });

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

  const [assignCell, setAssignCell] = useState<{ ri: number; col: string; savedFull?: boolean } | null>(null);
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

  // Cơ cấu 5/2026: gán công đoạn WBS theo XƯỞNG (bỏ tổ cũ).
  //  Cắt/GCCK → Xưởng Pha cắt · Gá lắp/Tổ hợp → Xưởng Chế tạo 1/2 · Hàn → Xưởng Hàn
  //  Làm sạch/Sơn/Bảo ôn/Đóng kiện/Giao hàng → Xưởng Hoàn thiện
  const teamsByStage: Record<string, string[]> = {
    cutting: ['Xưởng Pha cắt'],
    machining: ['Xưởng Pha cắt'],
    fitup: ['Xưởng Chế tạo số 1', 'Xưởng Chế tạo số 2'],
    welding: ['Xưởng Hàn'],
    tryAssembly: ['Xưởng Chế tạo số 1', 'Xưởng Chế tạo số 2'],
    dismantle: ['Xưởng Chế tạo số 1', 'Xưởng Chế tạo số 2'],
    blasting: ['Xưởng Hoàn thiện'],
    painting: ['Xưởng Hoàn thiện'],
    insulation: ['Xưởng Hoàn thiện'],
    commissioning: ['Xưởng Hoàn thiện'],
    packing: ['Xưởng Hoàn thiện'],
    delivery: ['Xưởng Hoàn thiện'],
  };

  const openAssignPanel = (ri: number, colKey: string) => {
    const existing = cellAssignments?.[ri]?.[colKey];
    // Khoá "Lưu phân giao" nếu ô ĐÃ lưu đủ khối lượng (≥ KL hạng mục). Chốt tại lúc MỞ panel để
    // lần lưu đầu/lưu thiếu vẫn sửa được; chỉ ô đã phân giao đủ 100% mới khoá.
    const savedKL = (existing || []).reduce((s, a) => s + (Number(a.volume) || 0), 0);
    const rowKL = Number(rows[ri]?.khoiLuong) || 0;
    const savedFull = !!(existing && existing.length > 0 && rowKL > 0 && savedKL >= rowKL);
    setTempAssigns(existing && existing.length > 0 ? JSON.parse(JSON.stringify(existing)) : [{ teamName: '', volume: '', startDate: '', endDate: '' }]);
    setAssignCell({ ri, col: colKey, savedFull });
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

  // 17 công đoạn theo Form BCTH-IBSHI-QLDA-01 (đúng thứ tự file)
  const subCols = [
    { key: 'cutting', label: 'Cắt' }, { key: 'machining', label: 'GCCK' },
    { key: 'fitup', label: 'Gá' }, { key: 'welding', label: 'Hàn' },
    { key: 'tryAssembly', label: 'Tổ hợp' }, { key: 'dismantle', label: 'Tháo dỡ' },
    { key: 'blasting', label: 'Làm sạch' }, { key: 'galvanize', label: 'Mạ' },
    { key: 'repairAfterGalv', label: 'Sửa sau mạ' }, { key: 'painting', label: 'Sơn' },
    { key: 'commissioning', label: 'Chạy thử' }, { key: 'insulation', label: 'Bảo ôn' },
    { key: 'linerPainting', label: 'Sơn liner' }, { key: 'shippingAssembly', label: 'Lắp GH' },
    { key: 'khungKien', label: 'Khung kiện' }, { key: 'packing', label: 'Đóng kiện' },
    { key: 'delivery', label: 'Giao hàng' },
  ];

  // ── Định tuyến P3.3 vs P3.4 theo giá trị ô công đoạn (nơi làm việc) ──
  // Ô chứa "IBS" (kể cả "IBS TP Giang Sơn" = thầu phụ làm TẠI xưởng IBS) → thuộc P3.4;
  // ô ghi tên thầu phụ khác (mang ra ngoài làm) → thuộc P3.3. "N/A" = công đoạn không áp dụng.
  // (Quy tắc này trước đây còn dùng cho báo cáo ngày P5.1/P5.1A — hai bước đó đã gỡ 2026-08.)
  const _isIBS = (val: string) => (val || '').trim().toUpperCase().includes('IBS');
  const _isEmpty = (val: string) => !(val || '').trim();
  const _isNA = (val: string) => (val || '').trim().toUpperCase() === 'N/A';
  const isRowVisibleForStep = (row: WbsRow): boolean => {
    if (!stepFilter || (stepFilter !== 'P3.3' && stepFilter !== 'P3.4')) return true;
    const nonEmptyCells = subCols.filter(c => !_isEmpty(row[c.key] || ''));
    if (nonEmptyCells.length === 0) return true;
    if (stepFilter === 'P3.4') return nonEmptyCells.some(c => _isIBS(row[c.key] || ''));
    return nonEmptyCells.some(c => !_isIBS(row[c.key] || ''));
  };
  const isCellActiveForStep = (cellVal: string): boolean => {
    if (!stepFilter || (stepFilter !== 'P3.3' && stepFilter !== 'P3.4')) return true;
    if (_isEmpty(cellVal)) return true;
    if (_isNA(cellVal)) return false;
    if (stepFilter === 'P3.4') return _isIBS(cellVal);
    return !_isIBS(cellVal);
  };

  const exportExcel = () => {
    const headers = ['STT', 'Tên hạng mục', 'ĐVT', 'Khối lượng', 'Phạm vi', 'Thầu phụ', 'Bắt đầu', 'Kết thúc', 'Trạng thái', ...subCols.map(c => c.label), 'Khu vực TC', 'Ghi chú'];
    const data = rows.map(r => [
      r.stt, r.hangMuc, r.dvt, r.khoiLuong, r.phamVi, r.thauPhu, r.batDau, r.ketThuc, r.trangThai,
      ...subCols.map(c => r[c.key] || ''), r.khuVuc, r.ghiChu
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [{ wch: 5 }, { wch: 35 }, { wch: 6 }, { wch: 12 }, { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, ...subCols.map(() => ({ wch: 8 })), { wch: 15 }, { wch: 20 }];
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

          // Parser thống nhất (lib/wbs-parser): nhận Form BCTH-IBSHI-QLDA-01 ĐẦY ĐỦ — header đa tầng,
          // 16 công đoạn (mỗi cái Đơn vị + Start + Finish), Diện tích/Bảo ôn/Nhân lực — VÀ form cũ 9 cột.
          // Ngày để dạng SERIAL (raw:true) cho parser tự chuẩn hoá. Merge lên emptyRow để đủ mọi key.
          const imported: WbsRow[] = parseWbsExcel(jsonData).map((r, i) => ({ ...emptyRow(), ...r, stt: String(r.stt || i + 1) }));
          if (imported.length > 0) {
            save(imported);
          } else {
            notify('Không có dữ liệu hợp lệ trong file!');
          }
        } catch(err) {
          console.error(err);
          notify('Lỗi đọc file Excel!');
        }
      };
      reader.readAsBinaryString(file);
    };
    input.click();
  };

  // Tổng lấy Ở DÒNG DỰ ÁN (số lớn nhất = dòng tổng đầu bảng), KHÔNG cộng dồn unit/item → tránh nhân đôi.
  // Phân biệt rõ: KL (kg) vs Diện tích/Bảo ôn (m²) — không gộp m² vào kg.
  const maxOf = (k: string) => rows.reduce((m, r) => Math.max(m, Number((r as Record<string, unknown>)[k]) || 0), 0);
  const totalKL = maxOf('khoiLuong');
  const totalDT = maxOf('dienTich');
  const totalBaoOn = maxOf('baoOn');
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
            <h3 style={{ margin: 0, fontSize: '1rem', color: '#0ea5e9' }}>Bảng kế hoạch tổng thể triển khai (WBS)</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Biểu mẫu BCTH-IBSHI-QLDA-095</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {mode === 'lsx' && onSave && <button type="button" onClick={onSave} style={{ padding: '5px 12px', fontSize: '0.75rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Lưu</button>}
            <button type="button" onClick={exportExcel} style={{ padding: '5px 12px', fontSize: '0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Export</button>
            {isWbsEditable && <button type="button" onClick={importExcel} style={{ padding: '5px 12px', fontSize: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Import</button>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 16, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0ea5e9' }}>{rows.length}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Hạng mục</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{totalKL > 1000 ? `${(totalKL / 1000).toFixed(1)}t` : `${formatNumber(totalKL)}`}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tổng KL (kg)</div>
          </div>
          {totalDT > 0 && <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0891b2' }}>{formatNumber(totalDT)}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Diện tích (m²)</div>
          </div>}
          {totalBaoOn > 0 && <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#7c3aed' }}>{formatNumber(totalBaoOn)}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>Bảo ôn (m²)</div>
          </div>}
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
          {isWbsEditable ? 'Xem & Sửa chi tiết' : 'XEM'}
        </button>
      </div>

      {wbsModalOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setWbsModalOpen(false); }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '12px 20px', borderBottom: '2px solid #0ea5e9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: '#f0f9ff' }}>
              <div><h2 style={{ margin: 0, fontSize: '1.05rem', color: '#0c4a6e' }}>WBS</h2><span style={{ fontSize: '0.72rem', color: '#64748b' }}>{rows.length} hạng mục</span></div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {isWbsEditable && <button type="button" onClick={addRow} style={{ padding: '5px 14px', fontSize: '0.75rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>+ Thêm</button>}
                <button type="button" onClick={exportExcel} style={{ padding: '5px 14px', fontSize: '0.75rem', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Export</button>
                {isWbsEditable && <button type="button" onClick={importExcel} style={{ padding: '5px 14px', fontSize: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>Import</button>}
                <button type="button" onClick={() => setWbsModalOpen(false)} style={{ padding: '5px 14px', fontSize: '0.85rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>✕ Đóng</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 2400 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...thS, position: 'sticky', left: 0, zIndex: 5, width: 40, background: '#c7e2ef' }}>STT</th>
                    <th rowSpan={2} style={{ ...thS, position: 'sticky', left: 40, zIndex: 5, width: 220, background: '#c7e2ef', textAlign: 'left' }}>TÊN HẠNG MỤC</th>
                    <th rowSpan={2} style={{ ...thS, width: 50 }}>ĐVT</th>
                    <th rowSpan={2} style={{ ...thS, width: 80 }}>KL</th>
                    <th rowSpan={2} style={{ ...thS, width: 70 }}>DT (m²)</th>
                    <th rowSpan={2} style={{ ...thS, width: 70 }}>Bảo ôn (m²)</th>
                    <th colSpan={2} style={{ ...thS, background: '#d0e8d0' }}>PHẠM VI</th>
                    <th colSpan={2} style={{ ...thS, background: '#e8ddd0' }}>TIẾN ĐỘ</th>
                    <th colSpan={subCols.length} style={{ ...thS, background: '#fde7e7' }}>CHI TIẾT CÔNG ĐOẠN (đơn vị + tiến độ)</th>
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
                    if (!isRowVisibleForStep(row)) return null;
                    const rowComplete = mode === 'lsx' && isRowComplete(ri, row);
                    return (
                    <tr key={ri} style={{ background: rowComplete ? '#dcfce7' : ri % 2 === 0 ? '#fff' : '#f8fafc' }}>
                      <td style={{ ...tdS, position: 'sticky', left: 0, zIndex: 2, background: rowComplete ? '#bbf7d0' : ri % 2 === 0 ? frozenBg : '#eef4f8', textAlign: 'center' }}><input className="input" value={row.stt || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'stt', e.target.value)} style={{ ...inputS, width: 32, textAlign: 'center' }} /></td>
                      <td style={{ ...tdS, position: 'sticky', left: 40, zIndex: 2, background: rowComplete ? '#bbf7d0' : ri % 2 === 0 ? frozenBg : '#eef4f8' }}><input className="input" value={row.hangMuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'hangMuc', e.target.value)} placeholder="Tên" style={{ ...inputS, fontWeight: 500 }} /></td>
                      <td style={tdS}><input className="input" value={row.dvt || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'dvt', e.target.value)} style={{ ...inputS, width: 50 }} /></td>
                      <td style={tdS}><input type="number" className="input" value={row.khoiLuong || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'khoiLuong', e.target.value)} style={{ ...inputS, textAlign: 'right' }} /></td>
                      <td style={tdS}><input className="input" value={row.dienTich || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'dienTich', e.target.value)} style={{ ...inputS, textAlign: 'right' }} /></td>
                      <td style={tdS}><input className="input" value={row.baoOn || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'baoOn', e.target.value)} style={{ ...inputS, textAlign: 'right' }} /></td>
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
                          // Ô thuộc bước KHÁC (vd đang ở P3.4 mà ô ghi tên thầu phụ ngoài) hoặc "N/A"
                          // → hiện mờ, gạch ngang, không bấm được. Vẫn cho THẤY để PM biết ai làm.
                          if (!isCellActiveForStep(cellVal)) {
                            return (
                              <td key={c.key} style={{ ...tdS }}>
                                <div style={{ ...inputS, textAlign: 'center', color: '#9ca3af', cursor: 'not-allowed', background: '#e5e7eb', fontWeight: 600, border: '1px solid #d1d5db', borderRadius: 5, padding: '3px 5px', textDecoration: 'line-through', opacity: 0.7 }}>{cellVal}</div>
                              </td>
                            );
                          }
                          // 3 states: full (green), partial (blue), none (yellow)
                          const isFull = assignCount > 0 && assignedKL >= totalKL;
                          const isPartial = assignCount > 0 && assignedKL < totalKL;
                          const isFailed = qcFailedAssignments?.some(q => q.rowIdx === ri && q.stageKey === c.key);
                          const borderColor = isFailed ? '#dc2626' : isFull ? '#16a34a' : isPartial ? '#2563eb' : '#fde68a';
                          const bgColor = isFailed ? '#fef2f2' : isFull ? '#d1fae5' : isPartial ? '#dbeafe' : '#fef3c7';
                          const badgeColor = isFailed ? '#dc2626' : isFull ? '#16a34a' : '#2563eb';
                          const tooltipText = isFailed ? 'Bị QC TỪ CHỐI — Click để Xử lý' :
                            isFull
                            ? `Đã phân giao đủ (${formatNumber(assignedKL)}/${formatNumber(totalKL)} ${row.dvt || 'kg'} • ${assignCount} tổ)`
                            : isPartial
                            ? `Chưa phân giao đủ (${formatNumber(assignedKL)}/${formatNumber(totalKL)} ${row.dvt || 'kg'} • còn ${formatNumber(totalKL - assignedKL)})`
                            : 'Chưa phân giao — Click để phân giao tổ';
                          return (
                            <td key={c.key} style={tdS}>
                              <button type="button" onClick={() => openAssignPanel(ri, c.key)}
                                title={tooltipText}
                                style={{ ...inputS, cursor: 'pointer', border: `2px solid ${borderColor}`, background: bgColor, fontWeight: 600, textAlign: 'center', borderRadius: 5, position: 'relative' }}>
                                {isFailed ? 'LỖI' : cellVal}
                                {assignCount > 0 && !isFailed && <span style={{ position: 'absolute', top: -6, right: -6, background: badgeColor, color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{assignCount}</span>}
                              </button>
                            </td>
                          );
                        }
                        const sStart = row[`${c.key}Start`] || '', sFinish = row[`${c.key}Finish`] || '';
                        return <td key={c.key} style={tdS}>
                          <input className="input" value={cellVal} disabled={!isWbsEditable} onChange={e => update(ri, c.key, e.target.value)} style={inputS} placeholder="đơn vị" />
                          {(sStart || sFinish) && <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textAlign: 'center', whiteSpace: 'nowrap', marginTop: 1 }} title={`${sStart} → ${sFinish}`}>{fmtDate(sStart)}→{fmtDate(sFinish)}</div>}
                        </td>;
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
                              {lsxStatus?.[ri]?.lsx ? 'Đã LSX' : 'LSX'}
                            </button>
                            {(() => {
                              const allMats = getAllMaterialsForRow(ri);
                              const hasMats = allMats.length > 0;
                              return (
                                <button type="button" onClick={() => setLsxConfirmRow({ idx: ri, row, type: 'vt' })}
                                  style={{ padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700, borderRadius: 5, border: 'none', cursor: 'pointer', background: hasMats ? '#d1fae5' : '#8b5cf6', color: hasMats ? '#16a34a' : '#fff', opacity: 1, position: 'relative' }}>
                                  {hasMats ? 'Vật tư' : 'Vật tư'}
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
                    <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>LỆNH SẢN XUẤT</div>
                    <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem' }}>{row.stt}. {row.hangMuc || 'Hạng mục'}</h3>
                    <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.9 }}>
                      KL: <strong>{formatNumber(totalKL)} {row.dvt || 'kg'}</strong>
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
                      <div style={{ fontSize: '2rem', marginBottom: 8 }}></div>
                      <div style={{ fontSize: '0.95rem' }}>Chưa có phân giao nào cho hạng mục này.</div>
                      <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Hãy click vào các ô IBS/TP trong cột Chi tiết để phân giao tổ trước.</div>
                    </div>
                  ) : activeStages.map(stage => {
                    const teams = rowAssigns[stage.key] || [];
                    return (
                      <div key={stage.key} style={{ marginBottom: 16 }}>
                        <div style={{ padding: '8px 12px', background: '#fef3c7', borderRadius: '8px 8px 0 0', borderBottom: '2px solid #f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#92400e' }}>{stage.label}</span>
                          <span style={{ fontSize: '0.75rem', color: '#b45309' }}>{teams.length} tổ</span>
                        </div>
                        {/* Table header */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 0.5fr 0.5fr 140px 100px', gap: 8, padding: '8px 12px 4px', background: '#fafafa' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>XƯỞNG THỰC HIỆN</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>KHỐI LƯỢNG</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>TỪ NGÀY</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>ĐẾN NGÀY</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>NGHIỆP VỤ QC/PM</span>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>DNC VẬT TƯ</span>
                        </div>
                        {/* Team rows */}
                        {teams.map((team, ti) => {
                          const issued = lsxIssuedDetails?.[idx]?.[stage.key]?.[ti] || false;
                          const qcFailed = qcFailedAssignments?.find(q => q.rowIdx === idx && q.stageKey === stage.key && q.teamIdx === ti);
                          const isCloned = team.rework_cloned;
                          const teamVol = Number(team.volume || 0);
                          const teamMatTotal = getTeamMaterialTotal(idx, stage.key, ti);
                          const teamMatCount = (materialRequests?.[idx]?.[stage.key]?.[ti] || []).length;
                          const limitPct = 110;
                          const maxAllowed = teamVol * (limitPct / 100);
                          const atLimit = teamMatTotal >= maxAllowed && teamVol > 0;
                          const hasMats = teamMatCount > 0;
                          // Không bắt buộc phải lập DNC vật tư mới được phát hành LSX — công đoạn
                          // không cần cấp VT (vd thuê ngoài trọn gói) vẫn phát hành được.
                          const canIssue = !issued && !qcFailed && !isCloned;
                          return (
                            <div key={ti} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 0.5fr 0.5fr 140px 100px', gap: 8, padding: '8px 12px', alignItems: 'center', background: qcFailed ? '#fef2f2' : isCloned ? '#f1f5f9' : ti % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #f1f5f9', opacity: isCloned ? 0.6 : 1 }}>
                              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{team.teamName || `Tổ ${ti + 1}`} {isCloned ? '(Đã Rework)' : ''}</span>
                              <span style={{ fontWeight: 700, color: '#0ea5e9', fontSize: '0.88rem' }}>{formatNumber(teamVol)} {row.dvt || 'kg'}</span>
                              <span style={{ fontSize: '0.82rem' }}>{fmtDate(team.startDate) || '—'}</span>
                              <span style={{ fontSize: '0.82rem' }}>{fmtDate(team.endDate) || '—'}</span>
                              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {!qcFailed ? (
                                  <button type="button" disabled={!canIssue || isCloned}
                                    title={issued ? 'Đã phát hành' : hasMats ? 'Phát hành LSX' : 'Phát hành LSX (chưa lập DNC vật tư)'}
                                    onClick={() => onIssueSingleTeam?.(idx, stage.key, ti)}
                                    style={{ padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: (canIssue && !isCloned) ? 'pointer' : 'default', background: issued ? '#d1fae5' : canIssue ? '#f59e0b' : '#e2e8f0', color: issued ? '#16a34a' : canIssue ? '#fff' : '#94a3b8', transition: 'all 0.2s' }}>
                                    {issued ? 'Đã PH' : 'Phát hành'}
                                  </button>
                                ) : (
                                  <>
                                    <div style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 800 }}>FAIL</div>
                                    {!isCloned ? (
                                      <button type="button" onClick={async () => { if(await confirmDialog('Tạo LSX bù (Rework)? Thao tác này sẽ tự động copy VT và KL sang 1 hạng mục mới.')) onCloneRework?.(idx, stage.key, ti); }}
                                        style={{ padding: '4px 8px', fontSize: '0.7rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
                                        Tạo Rework
                                      </button>
                                    ) : (
                                      <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>Đã tạo Rework bù</div>
                                    )}
                                  </>
                                )}
                              </div>
                              <div style={{ textAlign: 'center' }}>
                                <button type="button" disabled={atLimit}
                                  title={atLimit ? `Đã đạt ${limitPct}% KL (${formatNumber(teamMatTotal)}/${formatNumber(maxAllowed)})` : `DNC: ${formatNumber(teamMatTotal)}/${formatNumber(maxAllowed)} (${teamVol > 0 ? Math.round(teamMatTotal / teamVol * 100) : 0}%)`}
                                  onClick={() => {
                                    const existing = materialRequests?.[idx]?.[stage.key]?.[ti] || [];
                                    setTempMaterials(existing.length > 0 ? JSON.parse(JSON.stringify(existing)) : [{ name: '', code: '', spec: '', quantity: '', unit: 'kg' }]);
                                    setDncRow({ idx, row, stageKey: stage.key, teamIdx: ti, teamVolume: teamVol });
                                  }}
                                  style={{ padding: '6px 12px', fontSize: '0.8rem', fontWeight: 700, borderRadius: 6, border: 'none', cursor: atLimit ? 'default' : 'pointer', background: atLimit ? '#d1fae5' : hasMats ? '#0ea5e9' : '#64748b', color: atLimit ? '#16a34a' : '#fff', opacity: atLimit ? 0.9 : 1, transition: 'all 0.2s', position: 'relative' }}>
                                  {atLimit ? 'Đủ VT' : 'DNC VT'}
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
                <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>VẬT TƯ HẠNG MỤC</div>
                <h3 style={{ margin: '2px 0 0', fontSize: '1.15rem' }}>{row.stt}. {row.hangMuc || 'Hạng mục'}</h3>
                <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.9 }}>
                  KL: <strong>{formatNumber(totalKL)} {row.dvt || 'kg'}</strong>
                  {' \u2022 '}{row.phamVi}{row.thauPhu ? ` \u2022 ${row.thauPhu}` : ''}
                </div>
              </div>
              {/* Material list — read only (aggregate all teams) */}
              {(() => {
                const allMats = getAllMaterialsForRow(idx);
                return (
                  <div style={{ padding: '16px 24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0, fontSize: '1rem', color: '#6d28d9' }}>Tổng hợp vật tư đã yêu cầu</h4>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{allMats.length} mục</span>
                    </div>
                    {allMats.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: 6 }}></div>
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
                            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0ea5e9', textAlign: 'right' }}>{formatNumber(m.quantity || 0)}</span>
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
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>DNC Vật tư — {stageLabel}</h3>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {row.hangMuc || `Hạng mục #${idx + 1}`} • KL tổ: {formatNumber(teamVolume)} {row.dvt || 'kg'} • Giới hạn: {formatNumber(maxAllowed)} (110%)
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: overLimit ? '#dc2626' : pctUsed > 100 ? '#f59e0b' : '#16a34a', background: overLimit ? '#fef2f2' : pctUsed > 100 ? '#fef3c7' : '#f0fdf4', padding: '4px 10px', borderRadius: 20 }}>
                    {formatNumber(tempTotal)} / {formatNumber(maxAllowed)} ({pctUsed}%)
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
                  Tổng vật tư vượt 110% khối lượng tổ. Vui lòng giảm số lượng.
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
                            // Trim tên/mã trước khi gửi: mã VT có khoảng trắng thừa sẽ không khớp
                            // tồn kho ở bước Kho cấp phát (so khớp materialCode chính xác).
                            const trimmedItem = { ...m, name: m.name.trim(), code: (m.code || '').trim(), requested: true };
                            const n = [...tempMaterials]; n[mi] = trimmedItem; setTempMaterials(n);
                            await onRequestIssue?.(idx, stageKey, teamIdx, mi, trimmedItem);
                          }}
                          style={{ padding: '4px 8px', fontSize: '0.72rem', fontWeight: 700, borderRadius: 5, border: 'none', cursor: m.requested ? 'default' : 'pointer', background: m.requested ? '#d1fae5' : '#f59e0b', color: m.requested ? '#16a34a' : '#fff', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
                          {m.requested ? 'Đã ĐNC' : 'Đề nghị cấp'}
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
                    const valid = tempMaterials.filter(m => m.name.trim()).map(m => ({ ...m, name: m.name.trim(), code: (m.code || '').trim() }));
                    onUpdateMaterials?.(idx, stageKey, teamIdx, valid);
                    setDncRow(null);
                  }}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: overLimit || filledCount === 0 ? '#e2e8f0' : '#16a34a', color: overLimit || filledCount === 0 ? '#94a3b8' : '#fff', border: 'none', borderRadius: 8, cursor: overLimit || filledCount === 0 ? 'default' : 'pointer', fontWeight: 700 }}>
                  Lưu ({filledCount} mục)
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
        const teams = teamsByStage[assignCell.col] || [`Xưởng ${stageCol?.label || ''}`];
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 10002, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '40px 24px', overflowY: 'auto' }} onClick={() => setAssignCell(null)}>
            <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 800, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: '16px 24px', background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', color: '#fff' }}>
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginBottom: 2 }}>PHÂN GIAO CÔNG ĐOẠN</div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{stageCol?.label || assignCell.col}</h3>
              </div>
              {/* Row info reference */}
              <div style={{ padding: '16px 24px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '0.3fr 2fr 0.5fr 0.5fr 0.5fr', gap: 12, fontSize: '0.85rem' }}>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>STT</div><div style={{ fontWeight: 700 }}>{row.stt}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>HẠNG MỤC</div><div style={{ fontWeight: 700 }}>{row.hangMuc || '—'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>KHỐI LƯỢNG</div><div style={{ fontWeight: 700, color: '#0ea5e9' }}>{formatNumber(totalKL)} {row.dvt || 'kg'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>BẮT ĐẦU</div><div style={{ fontWeight: 600 }}>{fmtDate(row.batDau) || '—'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>KẾT THÚC</div><div style={{ fontWeight: 600 }}>{fmtDate(row.ketThuc) || '—'}</div></div>
                </div>
              </div>
              {/* Assignment form */}
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h4 style={{ margin: 0, fontSize: '1rem', color: '#0c4a6e' }}>Thực hiện phân giao</h4>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    Đã giao: <span style={{ color: assignedKL >= totalKL ? '#16a34a' : '#f59e0b', fontWeight: 800 }}>{formatNumber(assignedKL)}</span> / {formatNumber(totalKL)} {row.dvt || 'kg'}
                    {remaining > 0 && <span style={{ color: '#dc2626', marginLeft: 8, fontSize: '0.8rem' }}>Còn lại: {formatNumber(remaining)}</span>}
                    {remaining < 0 && <span style={{ color: '#dc2626', marginLeft: 8, fontSize: '0.8rem' }}>Vượt {formatNumber(Math.abs(remaining))}</span>}
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
                      <option value="">-- Chọn xưởng --</option>
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
                    Thêm tổ ({formatNumber(remaining)} {row.dvt || 'kg'} chưa giao)
                  </button>
                )}
                {remaining <= 0 && tempAssigns.length > 0 && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: '#d1fae5', borderRadius: 8, fontSize: '0.85rem', color: '#16a34a', fontWeight: 600 }}>
                    Đã phân giao đủ khối lượng
                  </div>
                )}
              </div>
              {/* Footer */}
              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#fafafa' }}>
                <button type="button" onClick={() => setAssignCell(null)}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: '#f1f5f9', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Hủy</button>
                <button type="button" onClick={saveAssign} disabled={assignCell.savedFull}
                  title={assignCell.savedFull ? 'Hạng mục đã phân giao đủ khối lượng — đã khóa' : 'Lưu phân giao'}
                  style={{ padding: '10px 24px', fontSize: '0.9rem', background: assignCell.savedFull ? '#e2e8f0' : '#0ea5e9', color: assignCell.savedFull ? '#94a3b8' : '#fff', border: 'none', borderRadius: 8, cursor: assignCell.savedFull ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
                  {assignCell.savedFull ? 'Đã phân giao đủ' : 'Lưu phân giao'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
