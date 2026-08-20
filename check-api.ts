import fetch from 'node-fetch';

async function main() {
  const displayId = 'c597f6d4-fbba-43a9-995c-d8c4be12bcdd';
  console.log(`Fetching snapshot for display ${displayId}...`);
  try {
    const res = await fetch(`http://localhost:3000/api/public/displays/${displayId}/snapshot`);
    if (!res.ok) {
      console.log('Error status:', res.status, res.statusText);
      const text = await res.text();
      console.log('Error text:', text);
      return;
    }
    const data = await res.json();
    console.log(`Returned ${data.counters?.length} counters.`);
    for (const c of data.counters || []) {
      console.log(`- ${c.code} (${c.tokenType})`);
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}
main();
