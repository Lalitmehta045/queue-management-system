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



  async acquireRebalanceLock(tx: Prisma.TransactionClient, branchId: string) {
    const lockKeyStr = `branch-rebalance-${branchId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeyStr}))`;
  }

  async rebalanceWaitingTokens(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    // Determine business date
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      include: { organization: { select: { timezone: true } } },
    });
    if (!branch) return;

    const businessDateObj = getBusinessDate(branch.organization.timezone);
    const normalizedBusinessDate = new Date(`${businessDateObj.toISOString().slice(0, 10)}T00:00:00.000Z`);

    // Advisory lock should preferably be called early by the caller, but we call it here just in case.
    await this.acquireRebalanceLock(tx, branchId);

    // 2. Fetch active counters
    const counters = await this.getActiveCounters(tx, branchId);

    // 3. Fetch ALL waiting tokens for this branch and businessDate
    const waitingTokens = await tx.token.findMany({
      where: {
        status: 'WAITING',
        businessDate: normalizedBusinessDate,
        queueEntry: { service: { department: { branchId } } },
      },
      select: { id: true },
      orderBy: [
        { queueEntry: { priorityWeight: 'desc' } },
        { sequenceNumber: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' }
      ]
    });

    if (!waitingTokens.length) return;

    if (!counters.length) {
      // No active counters: all waiting tokens must have counterId = null
      await tx.token.updateMany({
        where: {
          id: { in: waitingTokens.map(t => t.id) },
          counterId: { not: null },
        },
        data: { counterId: null },
      });
      return;
    }

    // 4. Deterministic Block Reallocation
    const updates = new Map<string, string[]>();
    for (const c of counters) {
      updates.set(c.id, []);
    }

    const base = Math.floor(waitingTokens.length / counters.length);
    const remainder = waitingTokens.length % counters.length;

    let tokenIndex = 0;
    for (let cIndex = 0; cIndex < counters.length; cIndex++) {
      const c = counters[cIndex]!;
      const numToAssign = base + (cIndex < remainder ? 1 : 0);
      
      for (let j = 0; j < numToAssign; j++) {
        const token = waitingTokens[tokenIndex]!;
        updates.get(c.id)!.push(token.id);
        tokenIndex++;
      }
    }

    const assignedTokenIds = Array.from(updates.values()).flat();
    const unassignedTokenIds = waitingTokens.filter(t => !assignedTokenIds.includes(t.id)).map(t => t.id);

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
        where: { id: { in: unassignedTokenIds }, counterId: { not: null } },
        data: { counterId: null },
      });
    }

    if (process.env.NODE_ENV !== 'production') {
      const distributionLog = counters.map(c => `${c.code}=${updates.get(c.id)?.length ?? 0}`).join(', ');
      console.log(`[QUEUE REBALANCE] branchId: ${branchId}, activeCounters: ${counters.length}, waitingTokenCount: ${waitingTokens.length}, distribution: ${distributionLog}`);
    }
  }
}
