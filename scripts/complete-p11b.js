const http = require('http');

const delay = ms => new Promise(res => setTimeout(res, ms));

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function main() {
  console.log('Logging in as toandv...');
  const loginRes = await request('POST', '/api/auth/login', { username: 'toandv', password: '123456' });
  if (!loginRes.data.ok) {
    console.error('Login failed. Res:', JSON.stringify(loginRes.data, null, 2));
    return;
  }
  // Use token from JSON response
  const token = loginRes.data.token;
  const authHeader = token ? { 'Authorization': `Bearer ${token}` } : {};
  console.log('Login successful');

  const p11bId = 'cmny3hwf4002qrww1cfj2s0ak';
  const completeRes = await request('PUT', `/api/tasks/${p11bId}`, {
    action: 'complete',
    notes: 'Quyết định triển khai dự án (API test)',
    resultData: {
      checklist: {
        rfq_checked: true,
        spec_checked: true,
        contract_reviewed: true,
        kickoff_agreed: true
      }
    }
  }, authHeader);

  console.log('Complete Response Status:', completeRes.status);
  console.log('Complete Response Body:', JSON.stringify(completeRes.data, null, 2));
}

main().catch(console.error);
