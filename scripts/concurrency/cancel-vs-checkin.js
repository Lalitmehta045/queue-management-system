// Usage: node cancel-vs-checkin.js
// ENV: BASE_URL, BRANCH_ID, APPOINTMENT_ID, ORG_HEADER
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const BRANCH = process.env.BRANCH_ID;
const APPT = process.env.APPOINTMENT_ID;
const ORG = process.env.ORG_HEADER;
if (!BRANCH || !APPT) { console.error('BRANCH_ID and APPOINTMENT_ID required'); process.exit(2); }

async function cancel() {
  const url = `${BASE}/api/branches/${BRANCH}/appointments/${APPT}/cancel`;
  const headers = { 'Content-Type': 'application/json' };
  if (ORG) headers['x-organization-id'] = ORG;
  const res = await fetch(url, { method: 'POST', headers, credentials: 'include' });
  const body = await res.text();
  return { op: 'cancel', status: res.status, body };
}

async function checkin() {
  const url = `${BASE}/api/branches/${BRANCH}/appointments/${APPT}/check-in`;
  const headers = { 'Content-Type': 'application/json' };
  if (ORG) headers['x-organization-id'] = ORG;
  const res = await fetch(url, { method: 'POST', headers, credentials: 'include' });
  const body = await res.text();
  return { op: 'checkin', status: res.status, body };
}

(async () => {
  console.log('Running cancel vs check-in concurrently');
  const [r1, r2] = await Promise.all([cancel(), checkin()]);
  console.log(r1, r2);
})();
