import { Injectable } from '@nestjs/common';
import { Prisma, CounterStatus, TokenType } from '@prisma/client';
import { getBusinessDate } from '../utils/date.util';

@Injectable()
export class QueueAllocationService {
  /**
   * Returns counters that are ACTIVE in the database.
   * This is the single source of truth for queue allocation.
   */
  async getActiveCounters(tx: Prisma.TransactionClient, branchId: string, tokenType?: TokenType): Promise<{ id: string, code: string, tokenType: TokenType, name: string }[]> {
    return tx.counter.findMany({
      where: {
        branchId,
        status: CounterStatus.ACTIVE,
        ...(tokenType && { tokenType }),
      },
      select: { id: true, code: true, tokenType: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  async allocateWaitingToken(tx: Prisma.TransactionClient, branchId: string, tokenType: TokenType = 'NORMAL'): Promise<string | null> {
    const counters = await this.getActiveCounters(tx, branchId, tokenType);
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

  async rebalanceWaitingTokens(tx: Prisma.TransactionClient, branchId: string, tokenType?: TokenType): Promise<void> {
    // Determine business date
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      include: { organization: { select: { timezone: true } } },
    });
    if (!branch) return;

    const businessDateObj = getBusinessDate(branch.organization.timezone);
    const normalizedBusinessDate = new Date(`${businessDateObj.toISOString().slice(0, 10)}T00:00:00.000Z`);

    const typesToRebalance: TokenType[] = tokenType ? [tokenType] : ['NORMAL', 'SPECIAL'];

    for (const type of typesToRebalance) {
      // 1. Acquire advisory lock per branch + tokenType
      const lockKeyStr = `${branchId}-${type}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKeyStr}))`;

      // 2. Fetch active counters
      const counters = await this.getActiveCounters(tx, branchId, type);

      // 3. Fetch ALL waiting tokens for this branch, type, and businessDate
      const waitingTokens = await tx.token.findMany({
        where: {
          status: 'WAITING',
          type,
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

      if (!waitingTokens.length) continue;

      if (!counters.length) {
        // No active counters for this type: all waiting tokens must have counterId = null
        await tx.token.updateMany({
          where: {
            id: { in: waitingTokens.map(t => t.id) },
            counterId: { not: null },
          },
          data: { counterId: null },
        });
        continue;
      }

      // 4. Deterministic Round Robin Reallocation
      const updates = new Map<string, string[]>();
      for (const c of counters) {
        updates.set(c.id, []);
      }

      for (let i = 0; i < waitingTokens.length; i++) {
        const token = waitingTokens[i]!;
        const targetCounter = counters[i % counters.length]!;
        updates.get(targetCounter.id)!.push(token.id);
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
        console.log(`[QUEUE REBALANCE] branchId: ${branchId}, tokenType: ${type}, activeCounters: ${counters.length}, waitingTokenCount: ${waitingTokens.length}, distribution: ${distributionLog}`);
      }
    }
  }

  async backfillUnassignedWaitingTokens(tx: Prisma.TransactionClient, branchId: string, previewOnly: boolean = false) {
    const counters = await this.getActiveCounters(tx, branchId);

    const summary: Record<string, number> = {};
    for (const c of counters) summary[`${c.name} (${c.code})`] = 0;

    const unassignedTokens = await tx.token.findMany({
      where: {
        status: 'WAITING',
        counterId: null,
        queueEntry: { service: { department: { branchId } } },
      },
      select: { id: true, displayNumber: true, type: true },
      orderBy: [
        { queueEntry: { priorityWeight: 'desc' } },
        { sequenceNumber: 'asc' },
        { createdAt: 'asc' },
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

    const normalCounters = counters.filter(c => c.tokenType === 'NORMAL');
    const specialCounters = counters.filter(c => c.tokenType === 'SPECIAL');

    let normalIndex = 0;
    let specialIndex = 0;

    for (let i = 0; i < unassignedTokens.length; i++) {
      const token = unassignedTokens[i]!;
      const targetCounters = token.type === 'SPECIAL' ? specialCounters : normalCounters;
      
      if (targetCounters.length === 0) {
        skippedAssigned += 1;
        continue;
      }
      
      let targetCounter;
      if (token.type === 'SPECIAL') {
        targetCounter = targetCounters[specialIndex % targetCounters.length]!;
        specialIndex++;
      } else {
        targetCounter = targetCounters[normalIndex % targetCounters.length]!;
        normalIndex++;
      }

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

  async allocateWaitingTokensBulk(tx: Prisma.TransactionClient, branchId: string, quantity: number, tokenType: TokenType = 'NORMAL'): Promise<(string | null)[]> {
    const counters = await this.getActiveCounters(tx, branchId, tokenType);
    
    if (!counters.length) return Array(quantity).fill(null) as (string | null)[];
    
    const waitingCounts = await tx.token.groupBy({
      by: ['counterId'],
      where: {
        counterId: { in: counters.map((c) => c.id) },
        status: 'WAITING',
      },
      _count: { id: true },
    });
    
    const countMap = new Map(counters.map(c => [c.id, 0]));
    for (const w of waitingCounts) {
      if (w.counterId) countMap.set(w.counterId, w._count.id);
    }
    
    const assignments: (string | null)[] = [];
    for (let i = 0; i < quantity; i++) {
      let bestCounter = counters[0]!;
      let minCount = countMap.get(bestCounter.id) || 0;
      
      for (let j = 1; j < counters.length; j++) {
        const c = counters[j]!;
        const count = countMap.get(c.id) || 0;
        if (count < minCount) {
          bestCounter = c;
          minCount = count;
        }
      }
      
      assignments.push(bestCounter.id);
      countMap.set(bestCounter.id, minCount + 1);
    }
    
    return assignments;
  }
}
