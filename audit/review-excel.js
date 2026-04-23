const XLSX = require('xlsx');
const path = require('path');

const wb = XLSX.readFile(path.join(__dirname, 'DA-26-Test_Data-Mapping-Audit.xlsx'));

console.log('=== SHEETS ===');
console.log(wb.SheetNames.join('\n'));

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const data = XLSX.utils.sheet_to_json(ws);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`SHEET: ${name} (${data.length} rows)`);
  console.log('═'.repeat(60));

  if (data.length === 0) { console.log('(empty)'); continue; }

  // Show headers
  console.log('Columns:', Object.keys(data[0]).join(' | '));
  console.log('-'.repeat(60));

  // Show first 5 rows (truncated)
  const showRows = Math.min(data.length, 5);
  for (let i = 0; i < showRows; i++) {
    const row = data[i];
    const vals = Object.values(row).map(v => {
      const s = String(v || '');
      return s.length > 50 ? s.substring(0, 50) + '...' : s;
    });
    console.log(vals.join(' | '));
  }
  if (data.length > 5) console.log(`... and ${data.length - 5} more rows`);
}
