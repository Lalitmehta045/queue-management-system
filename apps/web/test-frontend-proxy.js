async function run() {
  const publicId = '53abe0e6b9f84a30e3cae506b803c20a1845bdc29f312f49';
  const url = `http://localhost:3000/api/public/displays/${publicId}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log('Error fetching from next.js:', res.status, res.statusText);
      const text = await res.text();
      console.log('Response:', text);
      return;
    }
    
    const data = await res.json();
    console.log('Frontend proxy returned data successfully!');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

run();
