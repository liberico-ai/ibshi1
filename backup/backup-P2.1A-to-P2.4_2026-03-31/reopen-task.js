require('dotenv').config();
const pg = require('pg');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("UPDATE workflow_tasks SET status = 'IN_PROGRESS', completed_at = NULL, result_data = NULL WHERE step_code = 'P5.1' RETURNING id, step_code, status, project_id")
  .then(r => {
    console.log('Updated: ' + r.rowCount + ' rows');
    r.rows.forEach(row => console.log(row.id + ' | ' + row.step_code + ' | ' + row.status));
    pool.end();
  })
  .catch(e => { console.error(e.message); pool.end(); });
