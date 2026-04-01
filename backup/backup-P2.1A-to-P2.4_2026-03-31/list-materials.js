require('dotenv').config();
const pg = require('pg');
const fs = require('fs');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query('SELECT material_code, name, category, specification, current_stock, unit FROM materials ORDER BY category, name')
  .then(r => {
    let out = '| Ma VT | Ten | Loai | Quy chuan | Ton kho | DVT |\n';
    out += '|-------|-----|------|-----------|---------|-----|\n';
    r.rows.forEach(m => {
      out += '| ' + m.material_code + ' | ' + m.name + ' | ' + m.category + ' | ' + (m.specification || '-') + ' | ' + m.current_stock + ' | ' + m.unit + ' |\n';
    });
    out += '\nTotal: ' + r.rows.length;
    fs.writeFileSync('materials-output.txt', out, 'utf8');
    console.log('Written to materials-output.txt');
    pool.end();
  })
  .catch(e => { console.error('Error:', e.message); pool.end(); });
