const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/mockTx\.token\.findMany\.mockResolvedValue\(tokens\);/g, `mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });`);

fs.writeFileSync(filePath, content);
console.log('Fixed tokens variable mock.');
