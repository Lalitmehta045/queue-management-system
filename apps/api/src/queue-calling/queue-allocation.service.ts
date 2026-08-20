import { Injectable } from '@nestjs/common';
import { Prisma, CounterStatus, TokenType } from '@prisma/client';
import { getBusinessDate } from '../utils/date.util';

@Injectable()
export class QueueAllocationService {
  /**
   * Returns counters that are ACTIVE in the database.
   * This is the single source of truth for queue allocation.
   */
  async getActiveCounters(tx: Prisma.TransactionClient, branchId: string): Promise<{ id: string, code: string, tokenType: TokenType, name: string }[]> {
    return tx.counter.findMany({
      where: {
        branchId,
        status: CounterStatus.ACTIVE,
      },
      select: { id: true, code: true, tokenType: true, name: true },
      orderBy: { code: 'asc' },
    });
  }



  async allocateWaitingToken(tx: Prisma.TransactionClient, branchId: string, tokenType: TokenType, sequenceNumber: number): Promise<string | null> {
    const counters = await tx.counter.findMany({
      where: { branchId, status: CounterStatus.ACTIVE, tokenType },
      orderBy: { code: 'asc' },
    });

    if (counters.length === 0) return null;

    // Strict round-robin based on sequence number
    const index = (sequenceNumber - 1) % counters.length;
    return counters[index]!.id;
  }

  async acquireRebalanceLock(tx: Prisma.TransactionClient, branchId: string) {
    const lockKeyStr = `branch-rebalance-${branchId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeyStr}))`;
  }

  async rebalanceWaitingTokens(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      include: { organization: { select: { timezone: true } } },
    });
    if (!branch) return;

    const businessDateObj = getBusinessDate(branch.organization.timezone);
    const normalizedBusinessDate = new Date(`${businessDateObj.toISOString().slice(0, 10)}T00:00:00.000Z`);

    await this.acquireRebalanceLock(tx, branchId);

    const counters = await this.getActiveCounters(tx, branchId);
    const activeCounterIds = new Set(counters.map(c => c.id));

    const waitingTokens = await tx.token.findMany({
      where: {
        status: 'WAITING',
        businessDate: normalizedBusinessDate,
        queueEntry: { service: { department: { branchId } } },
      },
      select: { id: true, type: true, counterId: true, sequenceNumber: true },
      orderBy: { sequenceNumber: 'asc' }
    });

    if (!waitingTokens.length) return;

    const updates = new Map<string, string[]>();
    for (const c of counters) updates.set(c.id, []);
    const unassignedTokenIds: string[] = [];

    for (const token of waitingTokens) {
      const typeCounters = counters.filter(c => c.tokenType === token.type);
      if (typeCounters.length === 0) {
        if (token.counterId !== null) unassignedTokenIds.push(token.id);
        continue;
      }
      
      const index = (token.sequenceNumber - 1) % typeCounters.length;
      const targetCounterId = typeCounters[index]!.id;
      
      if (token.counterId !== targetCounterId) {
        updates.get(targetCounterId)!.push(token.id);
      }
    }

    for (const [counterId, tokenIds] of updates.entries()) {
      if (tokenIds.length > 0) {
        await tx.token.updateMany({
          where: { id: { in: tokenIds } },
          data: { counterId },
        });
      }
    }

    if (unassignedTokenIds.length > 0) {
      await tx.token.updateMany({
        where: { id: { in: unassignedTokenIds } },
        data: { counterId: null },
      });
    }
  }
}
