const { PrismaClient } = require('@prisma/client');
const http = require('http');

const prisma = new PrismaClient();

async function main() {
    const user = await prisma.user.findFirst({
        where: { email: 'admin@example.com' }
    });
    const membership = await prisma.membership.findFirst({
        where: { userId: user.id }
    });
    let branch = await prisma.branch.findFirst({
        where: { organizationId: membership.organizationId }
    });
    
    if (!branch) {
        branch = await prisma.branch.create({
            data: {
                organizationId: membership.organizationId,
                name: 'Test Branch',
            }
        });
    }

    let dept = await prisma.department.findFirst({
        where: { branchId: branch.id }
    });
    if (!dept) {
        dept = await prisma.department.create({
            data: {
                branchId: branch.id,
                name: 'Test Dept',
            }
        });
    }

    let service = await prisma.service.findFirst({
        where: { departmentId: dept.id }
    });
    if (!service) {
        service = await prisma.service.create({
            data: {
                departmentId: dept.id,
                name: 'Test Service',
            }
        });
    }
    
    // Now hit the endpoints
    const loginData = JSON.stringify({
      email: 'admin@example.com',
      password: 'Admin@1234'
    });

    const req = http.request('http://localhost:4000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': loginData.length }
    }, (res) => {
      let cookie = res.headers['set-cookie'] ? res.headers['set-cookie'].join(';') : '';
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
          console.log('Login Status:', res.statusCode);
          testEndpoints(cookie, membership.organizationId, branch.id, dept.id);
      });
    });
    req.write(loginData);
    req.end();
}

function testEndpoints(cookie, orgId, branchId, deptId) {
    const urls = [
        `http://localhost:4000/branches/${branchId}/patients?page=1&limit=100`,
        `http://localhost:4000/branches/${branchId}/departments?page=1&limit=100`,
        `http://localhost:4000/departments/${deptId}/services?page=1&limit=100`,
        `http://localhost:4000/priority-configurations?departmentId=${deptId}`,
        `http://localhost:4000/branches/${branchId}/tokens?page=1&limit=100`,
        `http://localhost:4000/branches/${branchId}/queue-entries?page=1&limit=100`
    ];

    urls.forEach(url => {
        const req = http.get(url, { headers: { Cookie: cookie, 'x-organization-id': orgId } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => console.log('GET', url.split('4000')[1], 'Status:', res.statusCode));
        });
        req.on('error', err => console.log('Error GET', url, err.message));
        
        // Add a timeout
        req.setTimeout(3000, () => {
            console.log('TIMEOUT', url.split('4000')[1]);
            req.destroy();
        });
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
