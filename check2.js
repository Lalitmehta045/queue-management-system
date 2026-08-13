const babel = require('@babel/parser');
const fs = require('fs');
const code = fs.readFileSync('apps/web/src/app/dashboard/organization/team-members/page.tsx', 'utf8');
try {
  babel.parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript']
  });
  console.log('No syntax errors');
} catch (e) {
  console.log('Syntax error:', e.message);
  console.log('Location:', e.loc);
}
