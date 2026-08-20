const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

content = content.replace(/const counterWaitingTokens = await this\.prisma\.token\.findMany\(\{[^]*?select: this\.publicTokenSelect,\s+\}\);/, `const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000);
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
      });`);

// Fix nowToken
content = content.replace(/const nowToken = activeCountersTokens\.find\(\(t\) => t\.counterId === counter\.id\);/, `const nowToken = activeCountersTokens.find((t) => t.counterId === counter.id && t.type === counter.tokenType);`);

// Fix toPublicToken
content = content.replace(/counter: counter\.name \?\? counter\.code \?\? 'Counter',/, `counter: counter.name ?? counter.code ?? 'Counter',\n        tokenType: counter.tokenType,`);

fs.writeFileSync(p, content);
