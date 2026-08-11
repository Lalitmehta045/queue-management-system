// Usage: node booking-test.js
// Environment variables required: BASE_URL, BRANCH_ID, SERVICE_ID, DATE (YYYY-MM-DD), START_TIME (HH:MM), PATIENT_IDS (comma-separated), ORG_HEADER (optional x-organization-id header)

const BASE = process.env.BASE_URL || 'http://localhost:4000';
const BRANCH = process.env.BRANCH_ID;
const SERVICE = process.env.SERVICE_ID;
const DATE = process.env.DATE;
const START = process.env.START_TIME;
const PATIENT_IDS = (process.env.PATIENT_IDS || '').split(',').filter(Boolean);
const ORG = process.env.ORG_HEADER;

if (!BRANCH || !SERVICE || !DATE || !START || PATIENT_IDS.length === 0) {
  console.error('Missing required env vars: BRANCH_ID, SERVICE_ID, DATE, START_TIME, PATIENT_IDS');
  process.exit(2);
}

async function book(patientId) {
  const url = `${BASE}/api/branches/${BRANCH}/appointments`;
  const body = { patientId, serviceId: SERVICE, appointmentDate: DATE, startTime: START };
  const headers = { 'Content-Type': 'application/json' };
  if (ORG) headers['x-organization-id'] = ORG;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), credentials: 'include' });
  const text = await res.text();
  return { status: res.status, body: text };
}

(async () => {
  console.log('Starting concurrent booking test with', PATIENT_IDS.length, 'requests');
  const promises = PATIENT_IDS.map((pid) => book(pid));
  const results = await Promise.all(promises.map(p => p.catch(e => ({ status: 'ERR', body: String(e) }))));
  console.log('Results:');
  results.forEach((r, i) => console.log(i, PATIENT_IDS[i], r.status));
  const success = results.filter(r => r.status === 200 || r.status === 201).length;
  const conflict = results.filter(r => r.status === 409).length;
  console.log('Success:', success, 'Conflicts:', conflict);
})();