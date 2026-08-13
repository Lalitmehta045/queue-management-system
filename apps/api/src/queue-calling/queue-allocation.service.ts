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
        queueEntry: { patient: { branchId } }
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
}
