const http = require('http');

const loginData = JSON.stringify({
  email: 'admin@example.com',
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
  const orgId = "fb070282-4a17-4ae9-9537-e3a1098d249f";
  const branchId = "cd9d7d0e-a5ff-47fc-bae1-9cb428c7ffcb";
  const serviceId = "59bb9c83-2c00-42ba-bd52-7bb7d1dc30ed";

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
