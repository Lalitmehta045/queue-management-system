const fs = require('fs');
const code = fs.readFileSync('apps/web/src/app/dashboard/organization/team-members/page.tsx', 'utf8');
let braces = 0;
let parens = 0;
let angles = 0;
for(let i = 0; i < code.length; i++) {
  if (code[i] === '{') braces++;
  if (code[i] === '}') braces--;
  if (code[i] === '(') parens++;
  if (code[i] === ')') parens--;
}
console.log('Braces balance:', braces);
console.log('Parentheses balance:', parens);
