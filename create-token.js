const http = require('http');

const loginData = JSON.stringify({
  email: 'admin2@example.com',
  password: 'Admin@1234'
});

const req = http.request('http://localhost:4000/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
}, (res) => {
  let cookie = res.headers['set-cookie'] ? res.headers['set-cookie'].join(';') : '';
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fetchBranches(cookie, JSON.parse(data).accessToken);
  });
});
req.write(loginData);
req.end();

function fetchBranches(cookie) {
  const orgId = "e99d4352-7f15-41ee-b88e-938046117c4c";
  const branchId = "0b3ed104-c610-419f-98b4-f2729d644d10";
  const serviceId = "04564613-cac6-4854-b076-bd83dfd5670a";

  const tokenData = JSON.stringify({
    serviceId: serviceId,
    priority: "SENIOR_CITIZEN"
  });

  const req = http.request(`http://localhost:4000/branches/${branchId}/queue-entries`, {
    method: 'POST',
    headers: {
      'Cookie': cookie,
      'x-organization-id': orgId,
      'Content-Type': 'application/json',
      'Content-Length': tokenData.length
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Created queue entry:', data);
      const queueEntry = JSON.parse(data);
      
      const tokenGenData = JSON.stringify({ type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' });
      const req2 = http.request(`http://localhost:4000/branches/${branchId}/queue-entries/${queueEntry.id}/token`, {
        method: 'POST',
        headers: {
          'Cookie': cookie,
          'x-organization-id': orgId,
          'Content-Type': 'application/json',
          'Content-Length': tokenGenData.length
        }
      }, (res2) => {
        let data2 = '';
        res2.on('data', chunk => data2 += chunk);
        res2.on('end', () => {
           console.log('Created token:', data2);
           fetchTokens(cookie, orgId, branchId);
        });
      });
      req2.write(tokenGenData);
      req2.end();
    });
  });
  req.write(tokenData);
  req.end();
}

function fetchTokens(cookie, orgId, branchId) {
    http.get(`http://localhost:4000/branches/${branchId}/tokens?page=1&limit=100`, {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Tokens Status:', res.statusCode, 'Data:', data.substring(0, 500)));
    });
}
