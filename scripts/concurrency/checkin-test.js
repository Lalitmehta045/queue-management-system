// Usage: node checkin-test.js
// ENV: BASE_URL, BRANCH_ID, APPOINTMENT_ID, ORG_HEADER
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const BRANCH = process.env.BRANCH_ID;
const APPT = process.env.APPOINTMENT_ID;
const ORG = process.env.ORG_HEADER;
if (!BRANCH || !APPT) { console.error('BRANCH_ID and APPOINTMENT_ID required'); process.exit(2); }

async function checkin() {
  const url = `${BASE}/api/branches/${BRANCH}/appointments/${APPT}/check-in`;
  const headers = { 'Content-Type': 'application/json' };
  if (ORG) headers['x-organization-id'] = ORG;
  const res = await fetch(url, { method: 'POST', headers, credentials: 'include' });
  const body = await res.text();
  return { status: res.status, body };
}

(async () => {
  const N = 6;
  console.log('Dispatching', N, 'concurrent check-ins');
  const promises = Array.from({ length: N }).map(() => checkin());
  const results = await Promise.all(promises.map(p => p.catch(e => ({ status: 'ERR', body: String(e) }))));
  console.log(results.map(r => r.status));
})();
