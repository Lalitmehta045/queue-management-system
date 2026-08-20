async function main() {
  console.log('Testing token generation against running server...');
  
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Admin123!' })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed', await loginRes.text());
    return;
  }
  
  const cookie = loginRes.headers.get('set-cookie');
  console.log('Login successful');

  const meRes = await fetch('http://localhost:3000/api/auth/me', { headers: { cookie: cookie! } });
  const me = await meRes.json();
  const orgId = me.memberships[0].organization.id;
  const branchId = me.memberships[0].branchId || (await (await fetch('http://localhost:3000/api/organizations/current/branches?page=1&limit=1', { headers: { cookie: cookie!, 'x-organization-id': orgId } })).json()).data[0].id;
  
  const deptsRes = await fetch(`http://localhost:3000/api/branches/${branchId}/departments?page=1&limit=1`, { headers: { cookie: cookie!, 'x-organization-id': orgId } });
  const deptId = (await deptsRes.json()).data[0].id;
  
  const svcsRes = await fetch(`http://localhost:3000/api/departments/${deptId}/services?page=1&limit=1`, { headers: { cookie: cookie!, 'x-organization-id': orgId } });
  const serviceId = (await svcsRes.json()).data[0].id;

  console.log('Generating 2 NORMAL tokens via Bulk API');
  const bulkNormRes = await fetch(`http://localhost:3000/api/branches/${branchId}/tokens/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookie!, 'x-organization-id': orgId },
    body: JSON.stringify({
      serviceId,
      priority: 'NORMAL',
      quantity: 2,
      type: 'NORMAL'
    })
  });
  console.log('NORMAL Bulk response:', await bulkNormRes.json());

  console.log('Generating 2 SPECIAL tokens via Bulk API');
  const bulkSpecRes = await fetch(`http://localhost:3000/api/branches/${branchId}/tokens/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: cookie!, 'x-organization-id': orgId },
    body: JSON.stringify({
      serviceId,
      priority: 'SENIOR_CITIZEN',
      quantity: 2,
      type: 'SPECIAL',
      specialCategory: 'SENIOR_CITIZEN'
    })
  });
  console.log('SPECIAL Bulk response:', await bulkSpecRes.json());
}
main().catch(console.error);
