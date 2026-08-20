const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Fix tests returning undefined by mocking findMany to return []
content = content.replace(/it\('token generated while all operators offline remains unassigned \(counterId = null\)', async \(\) => \{/g, `it('token generated while all operators offline remains unassigned (counterId = null)', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);`);

content = content.replace(/it\('logout makes counter unavailable for NEW assignments', async \(\) => \{/g, `it('logout makes counter unavailable for NEW assignments', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);`);

content = content.replace(/mockTx\.token\.updateMany\.mockResolvedValue\(\{ count: 3 \}\);/g, `mockTx.token.updateMany.mockResolvedValue({ count: 3 });
      mockTx.token.findMany.mockResolvedValue([]);`);

// Fix NORMAL tokens never assigned to SPECIAL counters
// In the test it uses:
// const tokens = Array.from({ length: 5 }, (_, i) => ({ id: \`t\${i + 1}\` }));
// We just need to add type: 'NORMAL' to the mock tokens in the 3 failing tests at the bottom.
content = content.replace(/const tokens = Array\.from\(\{ length: 5 \}, \(_, i\) => \(\{ id: \`t\$\{\i \+ 1\}\` \}\)\);/g, `const tokens = Array.from({ length: 5 }, (_, i) => ({ id: \`t\${i + 1}\`, type: 'NORMAL' }));`);
content = content.replace(/const tokens = Array\.from\(\{ length: 4 \}, \(_, i\) => \(\{ id: \`t\$\{\i \+ 1\}\` \}\)\);/g, `const tokens = Array.from({ length: 4 }, (_, i) => ({ id: \`t\${i + 1}\`, type: 'NORMAL' }));`);
// Also check if there are other tokens created in those 3 tests that need type: 'NORMAL'.
// Let's do a more generic replace for the tokens arrays that don't have 'type' specified in the map function.
content = content.replace(/=> \(\{ id: \`t\$\{\i \+ 1\}\` \}\)/g, `=> ({ id: \`t\${i + 1}\`, type: 'NORMAL' })`);

// Wait, the "NORMAL and SPECIAL queues stay isolated" test:
// mockTx.token.findMany.mockResolvedValue([
//   { id: 't1', type: 'NORMAL' },
//   { id: 't2', type: 'NORMAL' },
//   { id: 't3', type: 'SPECIAL' },
//   { id: 't4', type: 'SPECIAL' },
// ]);
// This test has types specified, but my filter was:
// data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
// If args.where.type is 'NORMAL', it returns 'NORMAL' and 'SPECIAL' because `!t.type` might be evaluated. No, `!t.type` is false for SPECIAL.
// But wait! My filter logic in fix-mock-findmany.js was:
// return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
// Wait, in `queue-allocation.service.ts`:
// await tx.token.findMany({ where: { status: 'WAITING', type } })
// `type` is passed directly inside `where`! So `args.where.type` is either 'NORMAL' or 'SPECIAL'.
// If t.type is 'SPECIAL', and args.where.type is 'NORMAL':
// !args.where.type is false.
// t.type === args.where.type is false.
// !t.type is false.
// So it returns false! Why did "NORMAL and SPECIAL queues stay isolated" fail and return t3 and t4?
// Ah! In `fix-mock-findmany.js`, I replaced `mockTx.token.findMany.mockResolvedValue([...])`!
// Did I replace the one in "NORMAL and SPECIAL queues stay isolated"?
// Let's just make ALL mockTx.token.findMany.mockResolvedValue dynamically filter by type in queue-allocation.service.spec.ts!
// The easiest way is to overwrite the entire spec file to a fixed version or just use a Jest mock in beforeEach.
// Let's just apply these changes and see.

fs.writeFileSync(filePath, content);
console.log('Fixed final tests.');
