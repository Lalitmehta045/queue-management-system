const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4000,
  path: '/auth/login',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const loginData = JSON.parse(data);
    const token = loginData.accessToken;
    const orgId = loginData.user.memberships[0].organizationId;

    http.get('http://localhost:4000/organizations/current/branches', { headers: { 'Authorization': 'Bearer ' + token, 'x-organization-id': orgId } }, (res2) => {
      let data2 = '';
      res2.on('data', (chunk) => { data2 += chunk; });
      res2.on('end', () => {
        const branches = JSON.parse(data2);
        const branchId = branches.data[0].id;
        
        http.get('http://localhost:4000/branches/' + branchId + '/departments', { headers: { 'Authorization': 'Bearer ' + token, 'x-organization-id': orgId } }, (res3) => {
          let data3 = '';
          res3.on('data', (chunk) => { data3 += chunk; });
          res3.on('end', () => {
            const depts = JSON.parse(data3);
            const deptId = depts.data[0].id;
            
            http.get('http://localhost:4000/departments/' + deptId + '/services', { headers: { 'Authorization': 'Bearer ' + token, 'x-organization-id': orgId } }, (res4) => {
              let data4 = '';
              res4.on('data', (chunk) => { data4 += chunk; });
              res4.on('end', () => {
                const svcs = JSON.parse(data4);
                const serviceId = svcs.data[0].id;

                const postData = JSON.stringify({ serviceId, priority: 'NORMAL' });
                const req5 = http.request({
                  hostname: 'localhost',
                  port: 4000,
                  path: '/branches/' + branchId + '/queue-entries',
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'x-organization-id': orgId, 'Content-Length': postData.length }
                }, (res5) => {
                  let data5 = '';
                  res5.on('data', (chunk) => { data5 += chunk; });
                  res5.on('end', () => {
                    const qEntry = JSON.parse(data5);
                    console.log('QueueEntry:', qEntry.id);
                    
                    const postData2 = JSON.stringify({});
                    const req6 = http.request({
                      hostname: 'localhost',
                      port: 4000,
                      path: '/branches/' + branchId + '/queue-entries/' + qEntry.id + '/token',
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'x-organization-id': orgId, 'Content-Length': postData2.length }
                    }, (res6) => {
                      let data6 = '';
                      res6.on('data', (chunk) => { data6 += chunk; });
                      res6.on('end', () => {
                        console.log('STATUS:', res6.statusCode);
                        console.log('BODY:', data6);
                      });
                    });
                    req6.write(postData2);
                    req6.end();
                  });
                });
                req5.write(postData);
                req5.end();
              });
            });
          });
        });
      });
    });
  });
});
req.write(JSON.stringify({ email: 'admin@organization.com', password: 'Password123!' }));
req.end();
