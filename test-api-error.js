async function test() {
  try {
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com', password: 'password123' })
    });
    const loginData = await loginRes.json();
    const token = loginData.accessToken;
    
    if (!token) {
      console.log("Login failed", loginData);
      return;
    }
    
    const branchId = '05468487-1c3e-4eb3-aee9-07131ca1a344'; // the one from user log
    const res = await fetch(`http://localhost:3000/api/branches/${branchId}/tokens?page=1&limit=20`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Body:", text);
  } catch(e) {
    console.error(e);
  }
}
test();
