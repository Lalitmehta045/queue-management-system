// Quick script to validate walk-in flow: create queue entry and generate token
// ENV: BASE_URL, BRANCH_ID, PATIENT_ID, SERVICE_ID, ORG_HEADER
const BASE = process.env.BASE_URL || 'http://localhost:4000';
const BRANCH = process.env.BRANCH_ID;
const PATIENT = process.env.PATIENT_ID;
const SERVICE = process.env.SERVICE_ID;
const ORG = process.env.ORG_HEADER;
if (!BRANCH || !PATIENT || !SERVICE) { console.error('BRANCH_ID, PATIENT_ID, SERVICE_ID required'); process.exit(2); }

async function run() {
  const headers = { 'Content-Type': 'application/json' };
  if (ORG) headers['x-organization-id'] = ORG;
  const entryRes = await fetch(`${BASE}/api/branches/${BRANCH}/queue-entries`, { method: 'POST', headers, body: JSON.stringify({ patientId: PATIENT, serviceId: SERVICE }), credentials: 'include' });
  console.log('Queue entry status', entryRes.status);
  const entry = entryRes.ok ? await entryRes.json() : null;
  if (!entry) return;
  const tokenRes = await fetch(`${BASE}/api/branches/${BRANCH}/queue-entries/${entry.id}/token`, { method: 'POST', headers, body: JSON.stringify({}), credentials: 'include' });
  console.log('Token generation status', tokenRes.status);
  if (tokenRes.ok) console.log(await tokenRes.json()); else console.log(await tokenRes.text());
}

run().catch(e => { console.error(e); process.exit(2); });
