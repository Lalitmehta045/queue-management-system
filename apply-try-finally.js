const fs = require('fs');
const path = require('path');
const dir = 'apps/api/test';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'test-utils.ts');

for (const f of files) {
  const filePath = path.join(dir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  
  const badBlock = /if \(typeof prisma !== "undefined" && prisma\) \{ await clearDatabase\(prisma\); \}\s*if \(typeof app !== "undefined" && app\) \{ await app\.close\(\); \}/g;
  const goodBlock = `try {
      if (typeof prisma !== "undefined" && prisma) { await clearDatabase(prisma); }
    } finally {
      if (typeof app !== "undefined" && app) { await app.close(); }
    }`;
    
  content = content.replace(badBlock, goodBlock);
  fs.writeFileSync(filePath, content);
  console.log('Try-finally in', f);
}
