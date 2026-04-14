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
  
  console.log('Calling /api/debug-bom...');
  const res = await request('GET', '/api/debug-bom', null, { 'Authorization': `Bearer ${token}` });
  console.log(JSON.stringify(res.data, null, 2));
}
run();
