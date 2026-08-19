const fs = require('fs');
const stats = fs.statSync('apps/api/src/utils/date.util.ts');
console.log('Modified:', stats.mtime);
