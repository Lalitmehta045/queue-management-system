

async function run() {
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Admin123!' })
  });
  
  const cookies = loginRes.headers.getSetCookie();
  console.log('Login status:', loginRes.status);
  
  // Find a service
  const reqHeaders = {
    'cookie': cookies?.join(';') || '',
    'x-organization-id': 'b10294e6-8141-482f-8d99-5bb1a49902dd', // assuming org 1
  };
  
  const branchesRes = await fetch('http://localhost:3000/api/branches', { headers: reqHeaders });
  const branches = await branchesRes.json();
  const branchId = branches[0].id;
  
  const servicesRes = await fetch(`http://localhost:3000/api/branches/${branchId}/services`, { headers: reqHeaders });
  const services = await servicesRes.json();
  const serviceId = services[0].id;
  
  // Create Queue Entry
  const qRes = await fetch(`http://localhost:3000/api/branches/${branchId}/queue-entries`, {
    method: 'POST',
    headers: { ...reqHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceId, priority: 'NORMAL' })
  });
  const qEntry = await qRes.json();
  console.log('Queue entry:', qEntry.id);
  
  // Create Token
  const tRes = await fetch(`http://localhost:3000/api/branches/${branchId}/queue-entries/${qEntry.id}/token`, {
    method: 'POST',
    headers: { ...reqHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' })
  });
  const token = await tRes.json();
  console.log('Token:', token);
}

run().catch(console.error);
