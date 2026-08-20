async function main() {
  const displayId = '42c115a410479750e1d1d188e495cedf6d49c85d70f0aa75';
  console.log(`Fetching snapshot directly from backend for display ${displayId}...`);
  try {
    const res = await fetch(`http://localhost:4000/public/displays/${displayId}`);
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
