const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

// 1. Remove assignment filter
const assignmentFilter = `    const now = new Date();
    const branchCounters = await this.prisma.counter.findMany({
      where: {
        branchId: display.branchId,
        status: CounterStatus.ACTIVE,
        assignments: {
          some: {
            user: {
              refreshSessions: {
                some: {
                  revokedAt: null,
                  expiresAt: { gt: now },
                },
              },
            },
          },
        },
      },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });`;

const newBranchCounters = `    // Counter visibility depends ONLY on Counter.status === ACTIVE.
    // Do NOT filter by operator login, RefreshSession, or assignments.
    const branchCounters = await this.prisma.counter.findMany({
      where: {
        branchId: display.branchId,
        status: CounterStatus.ACTIVE,
      },
      select: { id: true, name: true, code: true, tokenType: true, status: true },
      orderBy: { name: 'asc' },
    });`;

content = content.replace(assignmentFilter, newBranchCounters);

// 2. Fix nowToken to match type
const nowTokenOld = `const nowToken = activeCountersTokens.find((t) => t.counterId === counter.id);`;
const nowTokenNew = `const nowToken = activeCountersTokens.find((t) => t.counterId === counter.id && t.type === counter.tokenType);`;
content = content.replace(nowTokenOld, nowTokenNew);

// 3. Fix counterWaitingTokens to match type and apply MY fix (starvation sort)
const oldCounterWaitingTokens = `      const counterWaitingTokens = await this.prisma.token.findMany({
        where: { ...businessDateFilter, status: TokenStatus.WAITING, counterId: counter.id },
        orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { businessDate: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
        select: this.publicTokenSelect,
      });`;

const newCounterWaitingTokens = `      const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000);
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
          const aPriority = a.queueEntry?.priorityWeight ?? 0;
          const bPriority = b.queueEntry?.priorityWeight ?? 0;
          if (aPriority !== bPriority) return bPriority - aPriority;
        }

        if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
        if (a.sequenceNumber !== b.sequenceNumber) return a.sequenceNumber - b.sequenceNumber;
        return a.id.localeCompare(b.id);
      });`;
content = content.replace(oldCounterWaitingTokens, newCounterWaitingTokens);

// 4. Fix counters map to include tokenType
const oldCountersMap = `        counter: counter.name ?? counter.code ?? 'Counter',\n        now: nowToken ? this.toPublicToken(nowToken) : null,`;
const newCountersMap = `        counter: counter.name ?? counter.code ?? 'Counter',\n        tokenType: counter.tokenType,\n        now: nowToken ? this.toPublicToken(nowToken) : null,`;
content = content.replace(oldCountersMap, newCountersMap);

// 5. Update publicTokenSelect to include required fields for the new JS sort
const oldSelect = `  private readonly publicTokenSelect = {
    id: true,
    displayNumber: true,
    status: true,
    calledAt: true,
    recalledAt: true,
    recallCount: true,
    counterId: true,
    counter: { select: { name: true, code: true } },
    queueEntry: { select: { service: { select: { name: true, department: { select: { name: true } } } } } },
  } satisfies Prisma.TokenSelect;`;

const newSelect = `  private readonly publicTokenSelect = {
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
  } satisfies Prisma.TokenSelect;`;
content = content.replace(oldSelect, newSelect);

// 6. Update PublicTokenRow to include new fields
const oldRow = `type PublicTokenRow = {
  id: string;
  displayNumber: string;
  status: TokenStatus;
  calledAt: Date | null;
  recalledAt: Date | null;
  recallCount: number;
  counterId: string | null;
  counter: { name: string; code: string } | null;
  queueEntry: { service: { name: string; department: { name: string } } };
};`;

const newRow = `type PublicTokenRow = {
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
};`;
content = content.replace(oldRow, newRow);

fs.writeFileSync(p, content);
console.log("Restored previous agent changes + applied JS sort fix.");
