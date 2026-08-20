const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  /const nowToken = activeCountersTokens\.find\(\(t\) => t\.counterId === counter\.id && t\.type === counter\.tokenType\);/,
  `const nowToken = activeCountersTokens.find((t) => t.counterId === counter.id);`
);

fs.writeFileSync(p, content);
