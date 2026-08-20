const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

// The spec file initializes mockTx in the beforeEach for rebalanceWaitingTokens tests as well
// We need to add branch: { findUnique: jest.fn() } to the mockTx definition everywhere it's created.
// Or just find all `mockTx = {` and inject `branch: { findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'UTC' } }) }, `

content = content.replace(/mockTx = \{/g, `mockTx = {
        branch: {
          findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'UTC' } }),
        },
        $executeRaw: jest.fn().mockResolvedValue(true),`);

fs.writeFileSync(filePath, content);
console.log('Fixed mockTx in spec file.');
