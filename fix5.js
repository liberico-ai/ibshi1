const fs = require('fs');

let content = fs.readFileSync('src/app/dashboard/tasks/[id]/page.tsx', 'utf8');

const wbsFuncCode = `
  const renderWbsTableUI = (isWbsEditable: boolean, wbsItemsData: any) => {
    type WbsRow = Record<string, string>;
    const emptyRow = (): WbsRow => ({ stt: '', hangMuc: '', dvt: 'kg', khoiLuong: '', phamVi: 'IBS', thauPhu: '', batDau: '', ketThuc: '', trangThai: '', cutting: '', machining: '', fitup: '', welding: '', tryAssembly: '', dismantle: '', blasting: '', painting: '', insulation: '', commissioning: '', packing: '', delivery: '', khuVuc: '', ghiChu: '' });
    
    let rows: WbsRow[] = [];
    try {
      const p = wbsItemsData ? (typeof wbsItemsData === 'string' ? JSON.parse(wbsItemsData) : wbsItemsData) : null;
      rows = (Array.isArray(p) && p.length > 0) ? p : [{ ...emptyRow(), stt: '1' }];
    } catch {
      rows = [{ ...emptyRow(), stt: '1' }];
    }
    
    const [wbsModalOpen, setWbsModalOpen] = React.useState(false);

    const save = (next: WbsRow[]) => {
      if (!isWbsEditable) return;
      handleFieldChange('wbsItems', JSON.stringify(next));
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
      XLSX.writeFile(wb, \`WBS_export.xlsx\`);
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
          const wb = XLSX.read(evt.target.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
          if (jsonData.length < 2) return;
          const headerRow = jsonData[0].map(h => String(h || '').trim().toLowerCase());
          const keyMap: Record<string, string> = {
            'stt': 'stt', 'tên hạng mục': 'hangMuc', 'đvt': 'dvt', 'khối lượng': 'khoiLuong', 'phạm vi': 'phamVi', 'thầu phụ': 'thauPhu',
            'bắt đầu': 'batDau', 'kết thúc': 'ketThuc', 'trạng thái': 'trangThai', 'cắt': 'cutting', 'gcck': 'machining', 'gá': 'fitup',
            'hàn': 'welding', 'tổ hợp': 'tryAssembly', 'tháo dỡ': 'dismantle', 'làm sạch': 'blasting', 'sơn': 'painting', 'bảo ôn': 'insulation',
            'chạy thử': 'commissioning', 'đóng kiện': 'packing', 'giao hàng': 'delivery', 'khu vực tc': 'khuVuc', 'ghi chú': 'ghiChu'
          };
          const colMapping = headerRow.map(h => keyMap[h] || '');
          const imported: WbsRow[] = [];
          for (let i = 1; i < jsonData.length; i++) {
            const rowData = jsonData[i];
            if (!rowData || rowData.every(c => !c)) continue;
            const newRow = emptyRow();
            colMapping.forEach((key, ci) => { if (key && rowData[ci] != null) newRow[key] = String(rowData[ci]); });
            if (!newRow.stt) newRow.stt = String(imported.length + 1);
            imported.push(newRow);
          }
          if (imported.length > 0) save(imported);
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
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{totalKL > 1000 ? \`\${(totalKL / 1000).toFixed(1)}t\` : \`\${totalKL.toLocaleString('vi-VN')}\`}</div>
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
                    {rows.map((row, ri) => (
                      <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f8fafc' }}>
                        <td style={{ ...tdS, position: 'sticky', left: 0, zIndex: 2, background: ri % 2 === 0 ? frozenBg : '#eef4f8', textAlign: 'center' }}><input className="input" value={row.stt || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'stt', e.target.value)} style={{ ...inputS, width: 32, textAlign: 'center' }} /></td>
                        <td style={{ ...tdS, position: 'sticky', left: 40, zIndex: 2, background: ri % 2 === 0 ? frozenBg : '#eef4f8' }}><input className="input" value={row.hangMuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'hangMuc', e.target.value)} placeholder="Tên" style={{ ...inputS, fontWeight: 500 }} /></td>
                        <td style={tdS}><select className="input" value={row.dvt || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'dvt', e.target.value)} style={{ ...inputS, width: 50 }}>{['kg','tấn','m','m2','m3','cái','bộ','lít','tháng','ngày','giờ','lóng','tấm','thanh','ống'].map(u => <option key={u} value={u}>{u}</option>)}</select></td>
                        <td style={tdS}><input type="number" className="input" value={row.khoiLuong || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'khoiLuong', e.target.value)} style={{ ...inputS, textAlign: 'right' }} /></td>
                        <td style={tdS}><select className="input" value={row.phamVi || 'IBS'} disabled={!isWbsEditable} onChange={e => update(ri, 'phamVi', e.target.value)} style={inputS}><option value="IBS">IBS</option><option value="TP">TP</option><option value="">—</option></select></td>
                        <td style={tdS}><input className="input" value={row.thauPhu || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'thauPhu', e.target.value)} style={inputS} /></td>
                        <td style={tdS}><input type="date" className="input" value={row.batDau || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'batDau', e.target.value)} style={inputS} /></td>
                        <td style={tdS}><input type="date" className="input" value={row.ketThuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'ketThuc', e.target.value)} style={inputS} /></td>
                        {subCols.map(c => <td key={c.key} style={tdS}><select className="input" value={row[c.key] || ''} disabled={!isWbsEditable} onChange={e => update(ri, c.key, e.target.value)} style={inputS}><option value="">-</option><option value="X">X</option></select></td>)}
                        <td style={tdS}><input className="input" value={row.khuVuc || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'khuVuc', e.target.value)} style={inputS} /></td>
                        <td style={tdS}><input className="input" value={row.ghiChu || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'ghiChu', e.target.value)} style={inputS} /></td>
                        <td style={tdS}><select className="input" value={row.trangThai || ''} disabled={!isWbsEditable} onChange={e => update(ri, 'trangThai', e.target.value)} style={{ ...inputS, background: (row.trangThai||'').toLowerCase().includes('done')?'#d1fae5':'#fff' }}><option value="">-</option><option value="Done">Done</option><option value="Ongoing">Ongoing</option></select></td>
                        {isWbsEditable && <td style={tdS}><button type="button" onClick={() => removeRow(ri)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 700 }}>×</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };
`;

const lines = content.split('\n');
const hookIdx = lines.findIndex(l => l.trim() === "return (") - 1; // Before return (

lines.splice(hookIdx, 0, wbsFuncCode);

const newContent = lines.join('\n');

const p12Start = newContent.indexOf("{/* P1.2A: Dynamic WBS Table — based on BCTH-IBSHI-QLDA-095 */}");
const p12End = newContent.indexOf("            })()}", p12Start) + 17; // include '})()}' length

const clean1 = newContent.slice(0, p12Start) + 
  "            {/* P1.2A: Dynamic WBS Table UI */}\n" +
  "            {task.stepCode === 'P1.2A' && renderWbsTableUI(isActive, formData['wbsItems'])}\n" +
  newContent.slice(p12End);

const p13Start = clean1.indexOf("{/* WBS Readonly */}");
const p13End = clean1.indexOf("{/* Long-lead items form */}");

const finalContent = clean1.slice(0, p13Start) +
  "{/* P3.1: Unified WBS Table UI */}\n" +
  "                  <div style={{ width: '100%', marginTop: '1rem' }}>\n" +
  "                    {renderWbsTableUI(false, wbsRows)}\n" +
  "                  </div>\n\n                  " +
  clean1.slice(p13End);

fs.writeFileSync('src/app/dashboard/tasks/[id]/page.tsx', finalContent, 'utf8');
