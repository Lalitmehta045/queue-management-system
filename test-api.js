const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/branches/1a8cdcf5-d623-4a9c-80e2-574f3dfaadc4/tokens?page=1&limit=20',
  method: 'GET',
  headers: {
    'x-organization-id': 'c0e44a57-fc62-4f4c-8f29-827b15c31b7d'
  }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});

req.on('error', error => console.error(error));
req.end();
