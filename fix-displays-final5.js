const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  /type PublicToken = \{ tokenLabel: string; counter: string; status: TokenStatus; service\?: string; department\?: string; recalled: boolean; recallCount: number; calledAt: string \| null \};/,
  `type PublicToken = { tokenLabel: string; counter: string; tokenType: string; status: TokenStatus; service?: string; department?: string; recalled: boolean; recallCount: number; calledAt: string | null };`
);

fs.writeFileSync(p, content);
