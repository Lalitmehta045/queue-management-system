/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { QueueAllocationService } from './queue-allocation.service';

describe('QueueAllocationService', () => {
  let service: QueueAllocationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueueAllocationService],
    }).compile();

    service = module.get<QueueAllocationService>(QueueAllocationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('backfillUnassignedWaitingTokens', () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        branch: {
          findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'UTC' } }),
        },
        $executeRaw: jest.fn().mockResolvedValue(true),
        counter: {
          findMany: jest.fn(),
        },
        token: {
          findMany: jest.fn(),
          updateMany: jest.fn(),
        },
      };
    });

    it('should ignore inactive counters and only use active ones', async () => {
      // getActiveCounters returns ['c1']
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(1);
    });

    it('should return 0 assigned if there are no unassigned tokens', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data: any[] = [];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should return 0 assigned if there are no online counters', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should distribute 4 tokens to 2 counters evenly', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', name: 'Counter 2' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
        { id: 't2', displayNumber: 'T-002' , type: 'NORMAL' },
        { id: 't3', displayNumber: 'T-003' , type: 'NORMAL' },
        { id: 't4', displayNumber: 'T-004' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(4);
      expect(result.summary['Counter 1 (C1)']).toBe(2);
      expect(result.summary['Counter 2 (C2)']).toBe(2);
    });

    it('should distribute 13 tokens to 4 counters correctly', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', name: 'Counter 2' , tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3', name: 'Counter 3' , tokenType: 'NORMAL' },
        { id: 'c4', code: 'C4', name: 'Counter 4' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      
      const tokens = Array.from({ length: 13 }, (_, i) => ({ id: `t${i+1}`, displayNumber: `T-${i+1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(13);
      expect(result.summary['Counter 1 (C1)']).toBe(4);
      expect(result.summary['Counter 2 (C2)']).toBe(3);
      expect(result.summary['Counter 3 (C3)']).toBe(3);
      expect(result.summary['Counter 4 (C4)']).toBe(3);
    });

    it('should handle skipped tokens when concurrent assignment occurs', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
        { id: 't2', displayNumber: 'T-002' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      // First update fails (concurrent assignment), second succeeds
      mockTx.token.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(1);
      expect(result.skippedAssigned).toBe(1);
      expect(result.summary['Counter 1 (C1)']).toBe(1);
    });
    
    it('should preview successfully without modifying the DB', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1', true);

      expect(result.wouldAssign).toBe(1);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should only query WAITING tokens with counterId = null', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data: any[] = [];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(mockTx.token.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'WAITING',
            counterId: null,
            queueEntry: { service: { department: { branchId: 'branch-1' } } },
          },
        })
      );
    });
    
    it('should update tokens with condition counterId = null AND status = WAITING', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(mockTx.token.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1', counterId: null, status: 'WAITING' },
          data: { counterId: 'c1' },
        })
      );
    });
  });

  describe('Operator online/offline allocation', () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        branch: {
          findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'UTC' } }),
        },
        $executeRaw: jest.fn().mockResolvedValue(true),
        counter: { findMany: jest.fn() },
        token: {
          findMany: jest.fn(),
          updateMany: jest.fn(),
          groupBy: jest.fn(),
        },
      };
    });

    it('offline counter is excluded from allocation', async () => {
      // C1 has online operator, C2 does not
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.groupBy.mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(result).toBe('c1');
    });

    it('online counter is eligible for allocation', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1' , tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.groupBy.mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(['c1', 'c3']).toContain(result);
    });

    it('token generated while all operators offline remains unassigned (counterId = null)', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(result).toBeNull();
    });

    it('operator login backfills unassigned WAITING tokens', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c2', code: 'C2', name: 'Counter 2' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
        { id: 't2', displayNumber: 'T-002' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(2);
      expect(mockTx.token.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { counterId: 'c2' } })
      );
    });

    it('two online counters distribute tokens correctly', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1' , tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.groupBy.mockResolvedValue([
        { counterId: 'c1', _count: { id: 2 } },
        { counterId: 'c3', _count: { id: 1 } },
      ]);

      // C3 has fewer waiting tokens, so should get the next one
      const result = await service.allocateWaitingToken(mockTx, 'branch-1');
      expect(result).toBe('c3');
    });

    it('offline counters never receive new tokens (bulk)', async () => {
      // Only C1 and C3 are online; C2 and C4 are offline
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1' , tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.groupBy.mockResolvedValue([]);

      const assignments = await service.allocateWaitingTokensBulk(mockTx, 'branch-1', 4);

      // All tokens should go to c1 or c3, never c2 or c4
      for (const counterId of assignments) {
        expect(['c1', 'c3']).toContain(counterId);
      }
      // Balanced: 2 each
      const c1Count = assignments.filter(id => id === 'c1').length;
      const c3Count = assignments.filter(id => id === 'c3').length;
      expect(c1Count).toBe(2);
      expect(c3Count).toBe(2);
    });

    it('logout makes counter unavailable for NEW assignments', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);
      // After logout, getActiveCounters returns empty

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(result).toBeNull();
    });

    it('existing token assignments are not changed on logout (rebalance with no online counters unassigns)', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);
      // rebalance should unassign waiting tokens (set counterId = null) when no counters are online
      mockTx.token.updateMany.mockResolvedValue({ count: 3 });
      mockTx.token.findMany.mockImplementation(async () => [{ id: 't1' }]);

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      expect(mockTx.token.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: expect.any(Array) },
            counterId: { not: null },
          }),
          data: { counterId: null },
        })
      );
    });

    it('concurrent token generation/login does not create duplicate assignments (optimistic lock)', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', name: 'Counter 1' , tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 't1', displayNumber: 'T-001' , type: 'NORMAL' },
      ];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });
      // Simulate concurrent assignment: counterId is no longer null
      mockTx.token.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(result.skippedAssigned).toBe(1);
    });
  });

  describe('rebalanceWaitingTokens', () => {
    let mockTx: any;

    beforeEach(() => {
      mockTx = {
        branch: {
          findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'UTC' } }),
        },
        $executeRaw: jest.fn().mockResolvedValue(true),
        counter: { findMany: jest.fn() },
        token: {
          findMany: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
    });

    /**
     * Helper: collect all updateMany calls into a Map<counterId, tokenId[]>.
     * Calls with data.counterId === null are treated as "unassign" and skipped.
     */
    function collectAssignments(calls: any[]): Map<string, string[]> {
      const assignments = new Map<string, string[]>();
      for (const call of calls) {
        const counterId = call[0].data.counterId;
        if (counterId === null) continue;
        if (!assignments.has(counterId)) assignments.set(counterId, []);
        assignments.get(counterId)!.push(...call[0].where.id.in);
      }
      return assignments;
    }

    // TEST 5: 20 NORMAL tokens + C1 only ACTIVE → C1=20
    it('1 online counter → all waiting tokens assigned to it', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      expect(assignments.get('c1')).toHaveLength(10);
    });

    // TEST 6: Activate C2 → C1=10, C2=10
    it('second operator login → tokens redistributed 50/50', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      expect(assignments.get('c1')).toHaveLength(10);
      expect(assignments.get('c2')).toHaveLength(10);
    });

    // TEST 7: Activate C3 → C1=7, C2=7, C3=6
    it('third operator login → approximately equal distribution (7/7/6)', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      const counts = ['c1', 'c2', 'c3']
        .map((c) => assignments.get(c)?.length ?? 0)
        .sort((a, b) => b - a);
      expect(counts).toEqual([7, 7, 6]);
    });

    // TEST 8: Activate C4 → C1=5, C2=5, C3=5, C4=5
    it('fourth operator login → approximately equal distribution (5/5/5/5)', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3', tokenType: 'NORMAL' },
        { id: 'c4', code: 'C4', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      for (const c of ['c1', 'c2', 'c3', 'c4']) {
        expect(assignments.get(c)).toHaveLength(5);
      }
    });

    // TEST 9: Deactivate C2 → remaining active counters receive redistributed tokens
    it('operator logout → remaining counters receive redistributed waiting tokens', async () => {
      // After logout, only c1 and c2 remain online (c3 logged out)
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      expect(assignments.get('c1')).toHaveLength(10);
      expect(assignments.get('c2')).toHaveLength(10);
      expect(assignments.get('c3')).toBeUndefined();
    });

    // TEST 10: NORMAL tokens never assigned to SPECIAL counters
    it('NORMAL tokens never assigned to SPECIAL counters', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 's1', code: 'S1', tokenType: 'SPECIAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      // No token should be assigned to the SPECIAL counter
      expect(assignments.get('s1')).toBeUndefined();
    });

    // TEST 11: SPECIAL tokens never assigned to NORMAL counters
    it('SPECIAL tokens never assigned to NORMAL counters', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, type: 'SPECIAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      // No token should be assigned to the NORMAL counter
      expect(assignments.get('c1')).toBeUndefined();
    });

    it('NORMAL and SPECIAL queues stay isolated when both counter types online', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'cn', code: 'N1', tokenType: 'NORMAL' },
        { id: 'cs', code: 'S1', tokenType: 'SPECIAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = [
        { id: 't1', type: 'NORMAL' },
        { id: 't2', type: 'NORMAL' },
        { id: 't3', type: 'SPECIAL' },
        { id: 't4', type: 'SPECIAL' },
      ];
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      // NORMAL tokens → NORMAL counter only
      expect(assignments.get('cn')).toEqual(expect.arrayContaining(['t1', 't2']));
      expect(assignments.get('cn')).not.toContain('t3');
      expect(assignments.get('cn')).not.toContain('t4');
      // SPECIAL tokens → SPECIAL counter only
      expect(assignments.get('cs')).toEqual(expect.arrayContaining(['t3', 't4']));
      expect(assignments.get('cs')).not.toContain('t1');
      expect(assignments.get('cs')).not.toContain('t2');
    });

    // TEST 12/13/14: CALLED/SERVING/COMPLETED tokens never moved (only WAITING tokens queried)
    it('CALLED/SERVING tokens never moved (only WAITING tokens queried)', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        const data: any[] = [];
        return data.filter(t => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      // Verify findMany only queries WAITING tokens
      expect(mockTx.token.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'WAITING',
          }),
        }),
      );
    });

    // TEST 15: All counters INACTIVE → WAITING tokens have counterId=null
    it('all counters INACTIVE → WAITING tokens have counterId = null', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);
      const tokens = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      // All waiting tokens should be unassigned (counterId = null)
      expect(mockTx.token.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: expect.any(Array) },
            counterId: { not: null },
          }),
          data: { counterId: null },
        })
      );
    });

    // TEST 16: Reactivate one counter → WAITING tokens assigned to it
    it('reactivate one counter → all WAITING tokens assigned to it', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      expect(assignments.get('c1')).toHaveLength(5);
    });

    // TEST 18: Concurrent activation/deactivation → no duplicate/lost assignments
    it('simultaneous login/rebalance does not create duplicate or lost assignments', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
        { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
        { id: 'c2', code: 'C2', tokenType: 'NORMAL' },
        { id: 'c3', code: 'C3', tokenType: 'NORMAL' },
      ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, type: 'NORMAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      const allAssigned = [...assignments.values()].flat();

      // No duplicates
      expect(new Set(allAssigned).size).toBe(20);
      // No lost tokens (all 20 assigned)
      expect(allAssigned).toHaveLength(20);
      // Every token is in the assigned set
      for (const token of tokens) {
        expect(allAssigned).toContain(token.id);
      }
    });

    // SPECIAL queue rebalancing
    it('SPECIAL queue follows the same rebalancing rules', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
          { id: 's1', code: 'S1', tokenType: 'SPECIAL' },
          { id: 's2', code: 'S2', tokenType: 'SPECIAL' },
        ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const tokens = Array.from({ length: 10 }, (_, i) => ({ id: `st${i + 1}`, type: 'SPECIAL' }));
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return tokens.filter((t: any) => !args?.where?.type || t.type === args.where.type || !t.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1', 'SPECIAL');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      expect(assignments.get('s1')).toHaveLength(5);
      expect(assignments.get('s2')).toHaveLength(5);
    });

    // Mixed environment: NORMAL tokens go to NORMAL counters, SPECIAL to SPECIAL
    it('mixed environment correctly isolates NORMAL and SPECIAL tokens', async () => {
      mockTx.counter.findMany.mockImplementation(async (args: any) => {
        const data = [
          { id: 'c1', code: 'C1', tokenType: 'NORMAL' },
          { id: 'c2', code: 'C2', tokenType: 'NORMAL' },
          { id: 'c3', code: 'C3', tokenType: 'NORMAL' },
          { id: 'c4', code: 'C4', tokenType: 'NORMAL' },
          { id: 's1', code: 'S1', tokenType: 'SPECIAL' },
        ];
        return data.filter((c: any) => !args?.where?.tokenType || c.tokenType === args.where.tokenType);
      });
      const normalTokens = Array.from({ length: 50 }, (_, i) => ({ id: `nt${i + 1}`, type: 'NORMAL' }));
      const specialTokens = Array.from({ length: 10 }, (_, i) => ({ id: `st${i + 1}`, type: 'SPECIAL' }));
      const allTokens = [...normalTokens, ...specialTokens];
      mockTx.token.findMany.mockImplementation(async (args: any) => {
        return allTokens.filter((t: any) => !args?.where?.type || t.type === args.where.type);
      });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      const assignments = collectAssignments(mockTx.token.updateMany.mock.calls);
      
      // NORMAL counters should only have NORMAL tokens
      for (const cId of ['c1', 'c2', 'c3', 'c4']) {
        const tokenIds = assignments.get(cId) ?? [];
        for (const tId of tokenIds) {
          const token = allTokens.find(t => t.id === tId);
          expect(token?.type).toBe('NORMAL');
        }
      }

      // SPECIAL counter should only have SPECIAL tokens
      const specialTokenIds = assignments.get('s1') ?? [];
      for (const tId of specialTokenIds) {
        const token = allTokens.find(t => t.id === tId);
        expect(token?.type).toBe('SPECIAL');
      }

      // Verify counts
      const totalNormalAssigned = ['c1', 'c2', 'c3', 'c4'].reduce((sum, c) => sum + (assignments.get(c)?.length ?? 0), 0);
      expect(totalNormalAssigned).toBe(50);
      expect(specialTokenIds).toHaveLength(10);

      // NORMAL counters should each get ~12-13 tokens
      for (const cId of ['c1', 'c2', 'c3', 'c4']) {
        const count = assignments.get(cId)?.length ?? 0;
        expect(count).toBeGreaterThanOrEqual(12);
        expect(count).toBeLessThanOrEqual(13);
      }
    });
  });
});
