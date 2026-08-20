const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

content = content.replace(
  /const now = new Date\(\);\s+const branchCounters = await this\.prisma\.counter\.findMany\(\{[\s\S]*?orderBy: \{ name: 'asc' \},\s+\}\);/,
  `    const branchCounters = await this.prisma.counter.findMany({
      where: {
        branchId: display.branchId,
        status: CounterStatus.ACTIVE,
      },
      select: { id: true, name: true, code: true, tokenType: true, status: true },
      orderBy: { name: 'asc' },
    });`
);

fs.writeFileSync(p, content);
