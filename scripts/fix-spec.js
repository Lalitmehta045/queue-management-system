const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'apps', 'api', 'src', 'queue-calling', 'queue-allocation.service.spec.ts');
let content = fs.readFileSync(filePath, 'utf8');

// The spy is now mocked like this:
// jest.spyOn(service, 'getActiveCounters').mockResolvedValue(['c1']);
// But the return type of getActiveCounters is `{ id: string, code: string, tokenType: TokenType, name: string }[]`.
// We can just completely remove these jest.spyOn(service, 'getActiveCounters') lines since they are not needed.
// The tests just use mockTx.counter.findMany.mockResolvedValue(...) which will naturally flow through getActiveCounters if we just don't mock getActiveCounters.

content = content.replace(/.*jest\.spyOn\(service, 'getActiveCounters'\).*\n/g, '');

fs.writeFileSync(filePath, content);
console.log('Fixed spec file.');
