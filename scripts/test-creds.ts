async function main() {
  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed', await loginRes.text());
  } else {
    console.log('Login ok');
  }
}
main().catch(console.error);
