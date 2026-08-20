const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/mockTx\.token\.findMany\.mockResolvedValue\(\[(.*?)\]\);/gs, (match, p1) => {
    return `mockTx.token.findMany.mockImplementation(async (args) => {
        const data = [${p1}];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });`;
});

fs.writeFileSync(filePath, content);
console.log('Fixed mockTx.token.findMany mocks.');
