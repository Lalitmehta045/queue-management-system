const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

// Replace publicTokenSelect
content = content.replace(
  `counter: { select: { name: true, code: true } },
    queueEntry: { select: { service: { select: { name: true, department: { select: { name: true } } } } } },`,
  `issuedAt: true,
    createdAt: true,
    sequenceNumber: true,
    counter: { select: { name: true, code: true } },
    queueEntry: { select: { priorityWeight: true, service: { select: { name: true, department: { select: { name: true } } } } } },`
);

// Replace PublicTokenRow type
content = content.replace(
  `  counterId: string | null;
  counter: { name: string; code: string } | null;
  queueEntry: { service: { name: string; department: { name: string } } };`,
  `  counterId: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  sequenceNumber: number;
  counter: { name: string; code: string } | null;
  queueEntry: { priorityWeight: number; service: { name: string; department: { name: string } } };`
);

// Add 'type: true,' to publicTokenSelect if it's missing (it was missing in origin/main)
content = content.replace(
  `    displayNumber: true,
    status: true,`,
  `    displayNumber: true,
    type: true,
    status: true,`
);

content = content.replace(
  `  displayNumber: string;
  status: TokenStatus;`,
  `  displayNumber: string;
  type: string;
  status: TokenStatus;`
);

// Replace the counterWaitingTokens findMany logic
const searchString = `      const counterWaitingTokens = await this.prisma.token.findMany({
        where: { ...businessDateFilter, status: TokenStatus.WAITING, counterId: counter.id, type: counter.tokenType },
        orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { createdAt: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
        select: this.publicTokenSelect,
      });`;

const replaceString = `      const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000);
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
      });`;

// Fallback searchString if previous agent's changes were restored
const fallbackSearchString = `      const counterWaitingTokens = await this.prisma.token.findMany({
        where: { ...businessDateFilter, status: TokenStatus.WAITING, counterId: counter.id },
        orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { businessDate: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
        select: this.publicTokenSelect,
      });`;

const fallbackReplaceString = `      const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000);
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
      });`;

if (content.includes(searchString)) {
  content = content.replace(searchString, replaceString);
} else if (content.includes(fallbackSearchString)) {
  content = content.replace(fallbackSearchString, fallbackReplaceString);
} else {
  console.log("COULD NOT FIND searchString OR fallbackSearchString");
}

fs.writeFileSync(p, content);
