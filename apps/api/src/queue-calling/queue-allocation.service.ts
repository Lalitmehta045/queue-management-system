import { Injectable } from '@nestjs/common';
import { Prisma, CounterStatus } from '@prisma/client';

@Injectable()
export class QueueAllocationService {
  async allocateWaitingToken(tx: Prisma.TransactionClient, branchId: string): Promise<string | null> {
    const counters = await tx.counter.findMany({
      where: { branchId, status: CounterStatus.ACTIVE },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    
    if (!counters.length) return null;
    
    const waitingCounts = await tx.token.groupBy({
      by: ['counterId'],
      where: {
        counterId: { in: counters.map((c) => c.id) },
        status: 'WAITING',
      },
      _count: { id: true },
    });
    
    const countMap = new Map(waitingCounts.map((w) => [w.counterId ?? 'unknown', w._count.id]));
    
    let bestCounter = counters[0]!;
    let minCount = countMap.get(bestCounter.id) || 0;
    
    for (let i = 1; i < counters.length; i++) {
      const c = counters[i]!;
      const count = countMap.get(c.id) || 0;
      if (count < minCount) {
        bestCounter = c;
        minCount = count;
      }
    }
    
    return bestCounter.id;
  }

  async rebalanceWaitingTokens(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    const counters = await tx.counter.findMany({
      where: { branchId, status: CounterStatus.ACTIVE },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    if (!counters.length) return;

    const waitingTokens = await tx.token.findMany({
      where: {
        status: 'WAITING',
        queueEntry: { service: { department: { branchId } } }
      },
      select: { id: true },
      orderBy: [
        { queueEntry: { priorityWeight: 'desc' } },
        { businessDate: 'asc' },
        { sequenceNumber: 'asc' },
        { id: 'asc' }
      ]
    });
    
    if (!waitingTokens.length) return;

    const updates = new Map<string, string[]>();
    for (const c of counters) {
      updates.set(c.id, []);
    }

    waitingTokens.forEach((token, index) => {
      const targetCounter = counters[index % counters.length]!;
      updates.get(targetCounter.id)!.push(token.id);
    });

    for (const [counterId, tokenIds] of updates.entries()) {
      if (tokenIds.length > 0) {
        await tx.token.updateMany({
          where: { id: { in: tokenIds } },
          data: { counterId },
        });
      }
    }
  }

  async backfillUnassignedWaitingTokens(tx: Prisma.TransactionClient, branchId: string, previewOnly: boolean = false) {
    const counters = await tx.counter.findMany({
      where: { branchId, status: CounterStatus.ACTIVE },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    const summary: Record<string, number> = {};
    for (const c of counters) summary[`${c.name} (${c.code})`] = 0;

    const unassignedTokens = await tx.token.findMany({
      where: {
        status: 'WAITING',
        counterId: null,
        queueEntry: { service: { department: { branchId } } },
      },
      select: { id: true, displayNumber: true },
      orderBy: [
        { queueEntry: { priorityWeight: 'desc' } },
        { businessDate: 'asc' },
        { sequenceNumber: 'asc' },
        { id: 'asc' },
      ],
    });

    if (previewOnly) {
      return { counters, unassignedTokens, summary, wouldAssign: unassignedTokens.length };
    }

    if (!counters.length || !unassignedTokens.length) {
      return { summary, totalAssigned: 0, skippedAssigned: 0, counters, unassignedTokens };
    }

    let totalAssigned = 0;
    let skippedAssigned = 0;

    for (let i = 0; i < unassignedTokens.length; i++) {
      const token = unassignedTokens[i]!;
      const targetCounter = counters[i % counters.length]!;

      // Concurrency safety: ensure counterId is STILL null and status is STILL WAITING.
      const result = await tx.token.updateMany({
        where: { id: token.id, counterId: null, status: 'WAITING' },
        data: { counterId: targetCounter.id },
      });

      if (result.count === 1) {
        const key = `${targetCounter.name} (${targetCounter.code})`;
        summary[key] = (summary[key] || 0) + 1;
        totalAssigned += 1;
      } else {
        skippedAssigned += 1;
      }
    }

    return { summary, totalAssigned, skippedAssigned, counters, unassignedTokens };
  }
}
