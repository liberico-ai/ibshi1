const http = require('http');
const loginData = JSON.stringify({ username: 'giangdd', password: '123456' });
const loginReq = http.request({ hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length } }, loginRes => {
  let body = '';
  loginRes.on('data', c => body += c);
  loginRes.on('end', () => {
    const token = JSON.parse(body).token;
    const req = http.request({ hostname: 'localhost', port: 3000, path: '/api/materials', method: 'GET', headers: { 'Authorization': 'Bearer ' + token } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const data = JSON.parse(d);
        if (data.materials) {
          console.log(JSON.stringify(data.materials.map((m,i) => ({
            stt: i+1,
            code: m.materialCode,
            name: m.name,
            spec: m.specification,
            stock: m.currentStock,
            unit: m.unit,
            cat: m.category
          })), null, 2));
        }
      });
    });
    req.end();
  });
});
loginReq.write(loginData);
loginReq.end();
