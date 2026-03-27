process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const { Client } = require('pg')
const client = new Client({
  connectionString: 'postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi',
  ssl: { rejectUnauthorized: false }
})

client.connect()
  .then(() => {
    return client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'projects' ORDER BY ordinal_position")
  })
  .then(res => {
    console.log('Project cols:', res.rows.map(r => r.column_name).join(', '))
    return client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'workflow_tasks' ORDER BY ordinal_position")
  })
  .then(res => {
    console.log('Task cols:', res.rows.map(r => r.column_name).join(', '))
    // Now do the actual update using snake_case column names
    return client.query(
      `UPDATE workflow_tasks SET status = 'OPEN', completed_at = NULL, completed_by = NULL
       WHERE step_code = 'P1.2A'
       AND project_id = (SELECT id FROM projects WHERE project_code = 'DA-26-199' LIMIT 1)
       RETURNING id, step_code, status`
    )
  })
  .then(res => {
    console.log('Updated:', res.rowCount, 'rows')
    if (res.rows.length > 0) console.log('Result:', JSON.stringify(res.rows[0]))
    else console.log('No matching task found')
  })
  .catch(err => console.error('ERROR:', err.message))
  .finally(() => client.end())
