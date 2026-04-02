import React, { useState, useEffect, useRef } from "react";
import {  } from "lucide-react";
// Type definitions

export type TeamAssign = {
  teamName: string;
  startDate: string;
  endDate: string;
  notes: string;
};
export type CellAssignMap = Record<number, Record<string, TeamAssign[]>>;
export type LsxIssuedMap = Record<number, Record<string, { status: "pending" | "approved" | "rejected"; details: any }>>;
export type MaterialReqItem = {
  name: string;
  qty: string;
  spec: string;
  status?: string;
};
export type MaterialReqMap = Record<number, Record<string, Record<number, MaterialReqItem[]>>>;


function WbsTableUI({ isWbsEditable, wbsItemsData, onChange, mode, onIssueLSX, onRequestMaterial, lsxStatus, cellAssignments, onAssign, lsxIssuedDetails, onIssueSingleTeam, materialRequests, onUpdateMaterials, onRequestIssue, onSave }: { isWbsEditable: boolean; wbsItemsData: any; onChange?: (val: string) => void; mode?: 'default' | 'lsx'; onIssueLSX?: (rowIndex: number, row: Record<string, string>) => void; onRequestMaterial?: (rowIndex: number, row: Record<string, string>) => void; lsxStatus?: Record<number, { lsx?: boolean; vt?: boolean }>; cellAssignments?: CellAssignMap; onAssign?: (rowIdx: number, colKey: string, assigns: TeamAssign[]) => void; lsxIssuedDetails?: LsxIssuedMap; onIssueSingleTeam?: (rowIdx: number, colKey: string, teamIdx: number) => void; materialRequests?: MaterialReqMap; onUpdateMaterials?: (rowIdx: number, stageKey: string, teamIdx: number, items: MaterialReqItem[]) => void; onRequestIssue?: (rowIdx: number, stageKey: string, teamIdx: number, matIdx: number, material: MaterialReqItem) => Promise<void>; onSave?: () => void }) {
  type WbsRow = Record<string, string>;
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

  const subCols = [
    { key: 'cutting', label: 'Cắt' }, { key: 'machining', label: 'GCCK' },
    { key: 'fitup', label: 'Gá' }, { key: 'welding', label: 'Hàn' },
    { key: 'tryAssembly', label: 'Tổ hợp' }, { key: 'dismantle', label: 'Tháo dỡ' },
    { key: 'blasting', label: 'Làm sạch' }, { key: 'painting', label: 'Sơn' },
    { key: 'insulation', label: 'Bảo ôn' }, { key: 'commissioning', label: 'Chạy thử' },
    { key: 'packing', label: 'Đóng kiện' }, { key: 'delivery', label: 'Giao hàng' },
  ];
  
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

          const colIndices = {
            stt: findColIndex(['stt', 'no.', 'số tt']),
            hangMuc: findColIndex(['hạng mục', 'công trình', 'description', 'tên']),
            dvt: findColIndex(['đvt', 'unit']),
            khoiLuong: findColIndex(['khối lượng', 'volume']),
            phamVi: findColIndex(['ibs hi', 'phạm vi', 'scope']),
            thauPhu: findColIndex(['thầu phụ', 'sub-contractor', 'name']),
            batDau: findColIndex(['bắt đầu', 'start']),
            ketThuc: findColIndex(['kết thúc', 'finish']),
            trangThai: findColIndex(['trạng thái', 'status']),
            cutting: findColIndex(['cắt', 'cutting']),
            machining: findColIndex(['gcck', 'machining']),
            fitup: findColIndex(['gá', 'fitup']),
            welding: findColIndex(['hàn', 'welding']),
            tryAssembly: findColIndex(['tổ hợp', 'try-assembly', 'tổ hợp']),
            dismantle: findColIndex(['tháo dỡ', 'dismantle']),
            blasting: findColIndex(['làm sạch', 'blasting']),
            painting: findColIndex(['sơn', 'painting']),
            insulation: findColIndex(['bảo ôn', 'insulation']),
            commissioning: findColIndex(['chạy thử', 'commissioning']),
            packing: findColIndex(['đóng kiện', 'packing']),
            delivery: findColIndex(['giao hàng', 'delivery']),
            khuVuc: findColIndex(['khu vực', 'area']),
            ghiChu: findColIndex(['ghi chú', 'remark', 'ghi chú'])
          };

          const imported: WbsRow[] = [];
          for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
            const rowData = jsonData[i];
            if (!rowData || rowData.length === 0) continue;
            
            const sttVal = colIndices.stt >= 0 && rowData[colIndices.stt] != null ? String(rowData[colIndices.stt]).trim() : '';
            const hangMucVal = colIndices.hangMuc >= 0 && rowData[colIndices.hangMuc] != null ? String(rowData[colIndices.hangMuc]).trim() : '';
            
            if (!hangMucVal && !sttVal) continue;
            
            const sttLower = sttVal.toLowerCase();
            const hangMucLower = hangMucVal.toLowerCase();
            
            if (sttLower === '(a)' || sttLower === 'stt' || sttLower.includes('sub-contractor') || sttLower === '(i-1)' || sttLower.includes('d-')) continue;
            if (hangMucLower.includes('dự kiến nhà máy') || hangMucLower.includes('dự kiến') || hangMucLower.includes('ghi chú') || hangMucLower.includes('bcth-ibshi-qlda-01') || hangMucLower.includes('kế hoạch tổng thể')) continue;
            if (hangMucLower === 'tổng nhân lực cần cho các dự án') continue;

            const newRow = emptyRow();
            Object.keys(colIndices).forEach(key => {
              const idx = colIndices[key as keyof typeof colIndices];
              if (idx >= 0 && rowData[idx] !== undefined && rowData[idx] !== null && rowData[idx] !== '') {
                newRow[key as keyof WbsRow] = String(rowData[idx]).trim();
              }
            });
            
            if (!newRow.stt) newRow.stt = String(imported.length + 1);
            if (newRow.phamVi === '' && newRow.thauPhu !== '') {
               newRow.phamVi = 'TP';
            }

            imported.push(newRow);
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

  const totalKL = rows.reduce((s, r) => s + (Number(r.khoiLuong) || 0), 0);
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
              <table style={{ borderCollapse: 'collapse', minWidth: 2400 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...thS, position: 'sticky', left: 0, zIndex: 5, width: 40, background: '#c7e2ef' }}>STT</th>
                    <th rowSpan={2} style={{ ...thS, position: 'sticky', left: 40, zIndex: 5, width: 220, background: '#c7e2ef', textAlign: 'left' }}>TÊN HẠNG MỤC</th>
                    <th rowSpan={2} style={{ ...thS, width: 50 }}>ĐVT</th>
                    <th rowSpan={2} style={{ ...thS, width: 80 }}>KL</th>
                    <th colSpan={2} style={{ ...thS, background: '#d0e8d0' }}>PHẠM VI</th>
                    <th colSpan={2} style={{ ...thS, background: '#e8ddd0' }}>TIẾN ĐỘ</th>
                    <th colSpan={12} style={{ ...thS, background: '#fde7e7' }}>CHI TIẾT</th>
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
                    <input className="input" placeholder="Mã VT" value={m.code} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], code: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }} />
                    <input className="input" placeholder="Quy chuẩn" value={m.spec} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], spec: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }} />
                    <input className="input" type="number" placeholder="0" value={m.quantity} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], quantity: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.85rem', padding: '8px 10px', borderRadius: 6, textAlign: 'right', opacity: m.requested ? 0.7 : 1 }} />
                    <select className="input" value={m.unit} disabled={m.requested}
                      onChange={e => { const n = [...tempMaterials]; n[mi] = { ...n[mi], unit: e.target.value }; setTempMaterials(n); }}
                      style={{ fontSize: '0.8rem', padding: '8px 4px', borderRadius: 6, opacity: m.requested ? 0.7 : 1 }}>
                      <option value="kg">kg</option><option value="tấn">tấn</option><option value="m">m</option><option value="m2">m²</option><option value="cái">cái</option><option value="bộ">bộ</option><option value="lít">lít</option><option value="hộp">hộp</option><option value="cuộn">cuộn</option>
                    </select>
                    <div style={{ textAlign: 'center' }}>
                      {m.name.trim() && m.code.trim() && Number(m.quantity) > 0 ? (
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
