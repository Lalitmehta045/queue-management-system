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
    console.log('Login Status:', res.statusCode);
    if (res.statusCode === 200) {
      console.log('Proceeding to fetch /auth/me');
      fetchAuthMe(cookie);
    } else {
        console.log('Login failed:', data);
    }
  });
});

req.on('error', (err) => console.log('Login Req Error:', err));
req.write(loginData);
req.end();

function fetchAuthMe(cookie) {
  http.get('http://localhost:4000/auth/me', { headers: { Cookie: cookie } }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('AuthMe Status:', res.statusCode);
      if (res.statusCode === 200) {
          const user = JSON.parse(data);
          const orgId = user.memberships[0].organization.id;
          fetchBranches(cookie, orgId);
      } else {
          console.log('AuthMe Failed:', data);
      }
    });
  }).on('error', (err) => console.log('AuthMe Req Error:', err));
}

function fetchBranches(cookie, orgId) {
    http.get('http://localhost:4000/organizations/current/branches?page=1&limit=100', {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('Branches Status:', res.statusCode);
            const branches = JSON.parse(data).data;
            console.log('Branches count:', branches?.length);
            if (branches && branches.length > 0) {
                const branchId = branches[0].id;
                fetchPatients(cookie, orgId, branchId);
                fetchDepartments(cookie, orgId, branchId);
                fetchQueueEntries(cookie, orgId, branchId);
            }
        });
    }).on('error', (err) => console.log('Branches Req Error:', err));
}

function fetchPatients(cookie, orgId, branchId) {
    http.get(`http://localhost:4000/branches/${branchId}/patients?page=1&limit=100`, {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Patients Status:', res.statusCode, 'Data:', data.substring(0, 100)));
    }).on('error', (err) => console.log('Patients Req Error:', err));
}

function fetchDepartments(cookie, orgId, branchId) {
    http.get(`http://localhost:4000/branches/${branchId}/departments?page=1&limit=100`, {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('Departments Status:', res.statusCode);
            const depts = JSON.parse(data).data;
            if (depts && depts.length > 0) {
                fetchServices(cookie, orgId, depts[0].id);
                fetchTokens(cookie, orgId, branchId);
            }
        });
    }).on('error', (err) => console.log('Departments Req Error:', err));
}

function fetchServices(cookie, orgId, deptId) {
    http.get(`http://localhost:4000/departments/${deptId}/services?page=1&limit=100`, {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Services Status:', res.statusCode, 'Data:', data.substring(0, 100)));
    }).on('error', (err) => console.log('Services Req Error:', err));
}

function fetchTokens(cookie, orgId, branchId) {
    http.get(`http://localhost:4000/branches/${branchId}/tokens?page=1&limit=100`, {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Tokens Status:', res.statusCode, 'Data:', data.substring(0, 200)));
    }).on('error', (err) => console.log('Tokens Req Error:', err));
}

function fetchQueueEntries(cookie, orgId, branchId) {
    http.get(`http://localhost:4000/branches/${branchId}/queue-entries?page=1&limit=100`, {
        headers: { Cookie: cookie, 'x-organization-id': orgId }
    }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('QueueEntries Status:', res.statusCode, 'Data:', data.substring(0, 200)));
    }).on('error', (err) => console.log('QueueEntries Req Error:', err));
}
