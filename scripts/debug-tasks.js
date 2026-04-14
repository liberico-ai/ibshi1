const http = require('http');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost', port: 3000, path: path, method: method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(options, res => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } 
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  // Login as admin
  const loginRes = await request('POST', '/api/auth/login', { username: 'haitq', password: '123456' });
  const token = loginRes.data.token;
  if (!token) return console.log('Login failed');
  const auth = { 'Authorization': `Bearer ${token}` };
  
  // Get all projects
  const projRes = await request('GET', '/api/projects', null, auth);
  console.log('=== PROJECTS ===');
  if (projRes.data.projects) {
    for (const p of projRes.data.projects) {
      console.log(`  ${p.projectCode} (ID: ${p.id})`);
    }
  }
  
  // For each project that is NOT 104/109, get all tasks
  const projects = projRes.data.projects || [];
  for (const p of projects) {
    if (p.projectCode.includes('104') || p.projectCode.includes('109')) continue;
    
    console.log(`\n=== TASKS for ${p.projectCode} ===`);
    const taskRes = await request('GET', `/api/projects/${p.id}/tasks`, null, auth);
    if (taskRes.data.tasks) {
      for (const t of taskRes.data.tasks) {
        console.log(`  ${t.stepCode} | ${t.status} | assigned: ${t.assignedTo || '-'} | ${t.stepName}`);
      }
    }
  }
}

run();
