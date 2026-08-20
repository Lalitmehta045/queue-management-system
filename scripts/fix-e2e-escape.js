const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'scripts', 'e2e-verification.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/\\\`/g, '`');
content = content.replace(/\\\$/g, '$');

fs.writeFileSync(filePath, content);
console.log('Fixed escaping in e2e-verification.ts');
