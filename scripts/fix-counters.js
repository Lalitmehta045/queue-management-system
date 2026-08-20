const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Fix counter.findMany to dynamically filter by tokenType
// Replace literal array mocks for counter.findMany with mockImplementation
content = content.replace(/mockTx\.counter\.findMany\.mockResolvedValue\(\[(.*?)\]\);/gs, (match, p1) => {
    // Check if the array is empty
    if (p1.trim() === '') {
        return `mockTx.counter.findMany.mockResolvedValue([]);`;
    }
    return `mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [${p1}];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });`;
});

// 2. Fix the logout test by providing dummy tokens so it doesn't skip unassign logic
content = content.replace(/mockTx\.token\.updateMany\.mockResolvedValue\(\{ count: 3 \}\);\s*mockTx\.token\.findMany\.mockResolvedValue\(\[\]\);/g, `mockTx.token.updateMany.mockResolvedValue({ count: 3 });
      mockTx.token.findMany.mockImplementation(async () => [{ id: 't1' }]);`);

fs.writeFileSync(filePath, content);
console.log('Fixed counter.findMany and logout test.');
