const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

// Replace publicTokenSelect
content = content.replace(
  /private readonly publicTokenSelect = \{\s+id: true,\s+displayNumber: true,\s+type: true,\s+status: true,\s+calledAt: true,\s+recalledAt: true,\s+recallCount: true,\s+counterId: true,\s+counter: \{ select: \{ name: true, code: true \} \},\s+queueEntry: \{ select: \{ service: \{ select: \{ name: true, department: \{ select: \{ name: true \} \} \} \} \} \},\s+\} satisfies Prisma\.TokenSelect;/,
  `private readonly publicTokenSelect = {
    id: true,
    displayNumber: true,
    type: true,
    status: true,
    calledAt: true,
    recalledAt: true,
    recallCount: true,
    counterId: true,
    issuedAt: true,
    createdAt: true,
    sequenceNumber: true,
    counter: { select: { name: true, code: true } },
    queueEntry: { select: { priorityWeight: true, service: { select: { name: true, department: { select: { name: true } } } } } },
  } satisfies Prisma.TokenSelect;`
);

// Replace PublicTokenRow type
content = content.replace(
  /type PublicTokenRow = \{\s+id: string;\s+displayNumber: string;\s+type: string;\s+status: TokenStatus;\s+calledAt: Date \| null;\s+recalledAt: Date \| null;\s+recallCount: number;\s+counterId: string \| null;\s+counter: \{ name: string; code: string \} \| null;\s+queueEntry: \{ service: \{ name: string; department: \{ name: string \} \} \};\s+\};/,
  `type PublicTokenRow = {
  id: string;
  displayNumber: string;
  type: string;
  status: TokenStatus;
  calledAt: Date | null;
  recalledAt: Date | null;
  recallCount: number;
  counterId: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  sequenceNumber: number;
  counter: { name: string; code: string } | null;
  queueEntry: { priorityWeight: number; service: { name: string; department: { name: string } } };
};`
);

// Replace the counterWaitingTokens findMany logic
content = content.replace(
  /const counterWaitingTokens = await this\.prisma\.token\.findMany\(\{\s+where: \{ \.\.\.businessDateFilter, status: TokenStatus\.WAITING, counterId: counter\.id, type: counter\.tokenType \},\s+orderBy: \[\{ queueEntry: \{ priorityWeight: 'desc' \} \}, \{ createdAt: 'asc' \}, \{ sequenceNumber: 'asc' \}, \{ id: 'asc' \}\],\s+select: this\.publicTokenSelect,\s+\}\);/,
  `const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000);
      const counterWaitingTokensRaw = await this.prisma.token.findMany({
        where: { ...businessDateFilter, status: TokenStatus.WAITING, counterId: counter.id, type: counter.tokenType },
        select: this.publicTokenSelect,
      });
      const counterWaitingTokens = counterWaitingTokensRaw.sort((a, b) => {
        const aStarved = a.issuedAt && a.issuedAt < starvationThreshold;
        const bStarved = b.issuedAt && b.issuedAt < starvationThreshold;
        if (aStarved && !bStarved) return -1;
        if (!aStarved && bStarved) return 1;
        
        if (!aStarved && !bStarved) {
          const aPriority = a.queueEntry.priorityWeight;
          const bPriority = b.queueEntry.priorityWeight;
          if (aPriority !== bPriority) return bPriority - aPriority;
        }

        if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return a.id.localeCompare(b.id);
      });`
);

fs.writeFileSync(p, content);
