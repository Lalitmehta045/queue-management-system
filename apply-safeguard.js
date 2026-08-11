const fs = require('fs');
const path = require('path');
const dir = 'apps/api/test';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'test-utils.ts');

for (const f of files) {
  const filePath = path.join(dir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/await clearDatabase\(prisma\);/g, 'if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }');
  
  const appCloseRegex = /await app\.close\(\);/g;
  content = content.replace(appCloseRegex, 'if (typeof app !== "undefined" && app) { await app.close(); }');
  
  fs.writeFileSync(filePath, content);
  console.log('Safeguarded in', f);
}
