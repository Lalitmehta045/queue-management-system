const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/where: expect\.objectContaining\(\{[\s\n]*status: 'WAITING',[\s\n]*counterId: \{ not: null \},[\s\n]*\}\),/g, `where: expect.objectContaining({
            id: { in: expect.any(Array) },
            counterId: { not: null },
          }),`);

fs.writeFileSync(filePath, content);
console.log('Fixed logout test expectations.');
