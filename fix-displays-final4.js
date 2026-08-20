const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  /counter: counter\.name \?\? counter\.code \?\? 'Counter',/,
  `counter: counter.name ?? counter.code ?? 'Counter',
          tokenType: counter.tokenType,`
);

content = content.replace(
  /tokenLabel: token\.displayNumber, counter: token\.counter\?\.name \?\? token\.counter\?\.code \?\? 'Counter',/,
  `tokenLabel: token.displayNumber, counter: token.counter?.name ?? token.counter?.code ?? 'Counter', tokenType: token.type,`
);

fs.writeFileSync(p, content);
