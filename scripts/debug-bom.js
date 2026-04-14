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
  const loginRes = await request('POST', '/api/auth/login', { username: 'haitq', password: '123456' });
  const token = loginRes.data.token;
  if (!token) return console.log('Login failed');
  const auth = { 'Authorization': `Bearer ${token}` };
  
  // Get the newest test project
  const projRes = await request('GET', '/api/projects', null, auth);
  const projects = projRes.data.projects || [];
  const testProj = projects.find(p => !p.projectCode.includes('104') && !p.projectCode.includes('109'));
  if (!testProj) return console.log('No test project found');
  console.log(`Project: ${testProj.projectCode} (${testProj.id})`);
  
  // Get all tasks
  const taskRes = await request('GET', `/api/tasks?projectId=${testProj.id}`, null, auth);
  const tasks = taskRes.data.tasks || taskRes.data || [];
  
  // Find P2.1, P2.2, P2.3 tasks
  for (const stepCode of ['P2.1', 'P2.2', 'P2.3']) {
    const t = tasks.find(t => t.stepCode === stepCode);
    if (t) {
      console.log(`\n=== ${stepCode} (status: ${t.status}) ===`);
      if (t.resultData) {
        const keys = Object.keys(t.resultData);
        console.log('  resultData keys:', keys.join(', '));
        
        // Check bomItems
        const bomItems = t.resultData.bomItems;
        if (bomItems) {
          const parsed = typeof bomItems === 'string' ? JSON.parse(bomItems) : bomItems;
          console.log(`  bomItems count: ${Array.isArray(parsed) ? parsed.length : 'NOT ARRAY'}`);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log('  Sample item:', JSON.stringify(parsed[0]).substring(0, 200));
          }
        } else {
          console.log('  ❌ NO bomItems key found!');
        }
      } else {
        console.log('  ❌ NO resultData');
      }
    } else {
      console.log(`\n=== ${stepCode}: NOT FOUND ===`);
    }
  }
}

run();
