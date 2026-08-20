const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/mockImplementation\(async \(args\) => \{/g, 'mockImplementation(async (args: any) => {');
content = content.replace(/const data = \[\];/g, 'const data: any[] = [];');

fs.writeFileSync(filePath, content);
console.log('Added type annotations to mockTx.token.findMany.');
