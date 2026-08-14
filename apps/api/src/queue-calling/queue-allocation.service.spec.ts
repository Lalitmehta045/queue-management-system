/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { QueueAllocationService } from './queue-allocation.service';
import { CounterStatus } from '@prisma/client';

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
    });

    it('should ignore inactive counters and only use active ones', async () => {
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);
      mockTx.token.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(mockTx.counter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { branchId: 'branch-1', status: CounterStatus.ACTIVE },
        })
      );
      expect(result.totalAssigned).toBe(1);
    });

    it('should return 0 assigned if there are no unassigned tokens', async () => {
      mockTx.counter.findMany.mockResolvedValue([
        { id: 'c1', code: 'C1', name: 'Counter 1' },
      ]);
      mockTx.token.findMany.mockResolvedValue([]);

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should return 0 assigned if there are no active counters', async () => {
      mockTx.counter.findMany.mockResolvedValue([]);
      mockTx.token.findMany.mockResolvedValue([
        { id: 't1', displayNumber: 'T-001' },
      ]);

      const result = await service.backfillUnassignedWaitingTokens(mockTx, 'branch-1');

      expect(result.totalAssigned).toBe(0);
      expect(mockTx.token.updateMany).not.toHaveBeenCalled();
    });

    it('should distribute 4 tokens to 2 counters evenly', async () => {
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
});
