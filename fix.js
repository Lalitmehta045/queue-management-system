const fs = require('fs');
const path = require('path');

function f(d) {
  for (const e of fs.readdirSync(d)) {
    const p = path.join(d, e);
    if (fs.statSync(p).isDirectory()) {
      f(p);
    } else if (p.endsWith('.tsx') || p.endsWith('.ts')) {
      let c = fs.readFileSync(p, 'utf8');
      // replace all "from '../" with "from '../../"
      c = c.replace(/from '\.\.\//g, "from '../../");
      fs.writeFileSync(p, c);
    }
  }
}
f('apps/web/src/app/dashboard/organization');
console.log('Fixed imports');
