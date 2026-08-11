const fs = require('fs');
const path = require('path');
const dir = 'apps/api/test';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'test-utils.ts');

for (const f of files) {
  const filePath = path.join(dir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  const oldAfterAllMatch = content.match(/afterAll\(async \(\) => \{[\s\S]*?await app\.close\(\);\s*\}\);/);
  
  if (oldAfterAllMatch) {
    const newAfterAll = `  afterAll(async () => {\n    await clearDatabase(prisma);\n    await app.close();\n  });`;
    
    content = content.replace(oldAfterAllMatch[0], newAfterAll);
    if (!content.includes("import { clearDatabase } from './test-utils';")) {
      content = "import { clearDatabase } from './test-utils';\n" + content;
    }
    fs.writeFileSync(filePath, content);
    console.log('Replaced in', f);
  } else {
    console.log('No match in', f);
  }
}
