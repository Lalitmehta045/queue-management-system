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
        counter: {
          findMany: jest.fn(),
        },
        token: {
          findMany: jest.fn(),
          updateMany: jest.fn(),
        },
      };
      // Mock getOnlineCounterIds to return the counter IDs from the mocked findMany
      jest.spyOn(service, 'getOnlineCounterIds').mockImplementation(async () => {
        const counters = await mockTx.counter.findMany({
          where: { branchId: expect.any(String), status: 'ACTIVE' },
          select: { id: true },
          orderBy: { code: 'asc' },
        });
        return counters.map((c: any) => c.id);
      });
    });

    it('should ignore inactive counters and only use active ones', async () => {
      // getOnlineCounterIds returns ['c1']
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(1);
    });

    it('should return 0 assigned if there are no unassigned tokens', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([]);

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should return 0 assigned if there are no online counters', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue([]);
      mockTx.counter.findMany.mockResolvedValue([]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should distribute 4 tokens to 2 counters evenly', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1', 'c2']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
        { id: 'c2', code: 'C2', name: 'Counter 2' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
        { id: 't2', displayNumber: 'T-002' },
        { id: 't3', displayNumber: 'T-003' },
        { id: 't4', displayNumber: 'T-004' },
      ]);
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(4);
      expect(result.summary['Counter 1 (C1)']).toBe(2);
      expect(result.summary['Counter 2 (C2)']).toBe(2);
    });

    it('should distribute 13 tokens to 4 counters correctly', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1', 'c2', 'c3', 'c4']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
        { id: 'c2', code: 'C2', name: 'Counter 2' },
        { id: 'c3', code: 'C3', name: 'Counter 3' },
        { id: 'c4', code: 'C4', name: 'Counter 4' },
      ]);
      
      const tokens = Array.from({ length: 13 }, (_, i) => ({ id: `t${i+1}`, displayNumber: `T-${i+1}` }));
      mockTx.token.findMany.mockResolvedValue(tokens);
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(13);
      expect(result.summary['Counter 1 (C1)']).toBe(4);
      expect(result.summary['Counter 2 (C2)']).toBe(3);
      expect(result.summary['Counter 3 (C3)']).toBe(3);
      expect(result.summary['Counter 4 (C4)']).toBe(3);
    });

    it('should handle skipped tokens when concurrent assignment occurs', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
        { id: 't2', displayNumber: 'T-002' },
      ]);
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
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1', true);

      expect(result.wouldAssign).toBe(1);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should only query WAITING tokens with counterId = null', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([]);

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
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);
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
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1' },
      ]);
      mockTx.token.groupBy.mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(result).toBe('c1');
    });

    it('online counter is eligible for allocation', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1', 'c3']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1' },
        { id: 'c3', code: 'C3' },
      ]);
      mockTx.token.groupBy.mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(['c1', 'c3']).toContain(result);
    });

    it('token generated while all operators offline remains unassigned (counterId = null)', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(result).toBeNull();
    });

    it('operator login backfills unassigned WAITING tokens', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c2']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c2', code: 'C2', name: 'Counter 2' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
        { id: 't2', displayNumber: 'T-002' },
      ]);
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(2);
      expect(mockTx.token.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { counterId: 'c2' } })
      );
    });

    it('two online counters distribute tokens correctly', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1', 'c3']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1' },
        { id: 'c3', code: 'C3' },
      ]);
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
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1', 'c3']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1' },
        { id: 'c3', code: 'C3' },
      ]);
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
      // After logout, getOnlineCounterIds returns empty
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue([]);

      const result = await service.allocateWaitingToken(mockTx, 'branch-1');

      expect(result).toBeNull();
    });

    it('existing token assignments are not changed on logout (rebalance with no online counters unassigns)', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue([]);
      mockTx.counter.findMany.mockResolvedValue([]);
      // rebalance should unassign waiting tokens (set counterId = null) when no counters are online
      mockTx.token.updateMany.mockResolvedValue({ count: 3 });

      await service.rebalanceWaitingTokens(mockTx, 'branch-1');

      expect(mockTx.token.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'WAITING',
            counterId: { not: null },
          }),
          data: { counterId: null },
        })
      );
    });

    it('concurrent token generation/login does not create duplicate assignments (optimistic lock)', async () => {
      jest.spyOn(service, 'getOnlineCounterIds').mockResolvedValue(['c1']);
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);
      // Simulate concurrent assignment: counterId is no longer null
      mockTx.token.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(result.skippedAssigned).toBe(1);
    });
  });
});
