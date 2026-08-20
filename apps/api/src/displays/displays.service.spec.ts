/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { DisplaysService } from './displays.service';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayEventsService } from './display-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenStatus } from '@prisma/client';
import { EntitlementsService } from '../entitlements/entitlements.service';

describe('DisplaysService', () => {
  let service: DisplaysService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisplaysService,
        {
          provide: PrismaService,
          useValue: {
            token: { findMany: jest.fn(), count: jest.fn() },
            counter: { findMany: jest.fn() },
            display: { findUnique: jest.fn(), findFirst: jest.fn() },
            branch: { findUnique: jest.fn() },
          },
        },
        {
          provide: DisplayEventsService,
          useValue: { publish: jest.fn(), notifyPublicDisplays: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: { onAnnouncement: jest.fn() },
        },
        {
          provide: EntitlementsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<DisplaysService>(DisplaysService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildPublicSnapshot', () => {
    function setupBranchMock() {
      jest.spyOn(prismaService.branch, 'findUnique').mockResolvedValue({ organization: { timezone: 'UTC' } } as any);
    }

    function setupTokenMocks(options: {
      currentTokens?: any[];
      recentRows?: any[];
      activeCountersTokens?: any[];
      counterWaitingTokensMap?: Record<string, any[]>;
      waitingTotal?: number;
    }) {
      const counterWaitingTokensMap = options.counterWaitingTokensMap ?? {};
      let callIndex = 0;
      (jest.spyOn(prismaService.token, 'findMany') as any).mockImplementation(async (args: any) => {
        callIndex++;
        // 1st call: current tokens
        if (callIndex === 1) return options.currentTokens ?? [];
        // 2nd call: recent rows
        if (callIndex === 2) return options.recentRows ?? [];
        // 3rd call: activeCountersTokens
        if (callIndex === 3) return options.activeCountersTokens ?? [];
        // 4th+ calls: counterWaitingTokens per counter
        const counterId = args?.where?.counterId;
        return counterWaitingTokensMap[counterId] ?? [];
      });
      jest.spyOn(prismaService.token, 'count').mockResolvedValue(options.waitingTotal ?? 0);
    }

    it('should assign unique tokens to correct counters and remove NEXT from waiting', async () => {
      setupBranchMock();
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([
        { id: 'C1', name: 'Counter 1', code: 'C1', branchId: 'B1', status: 'ACTIVE', tokenType: 'NORMAL', createdAt: new Date(), updatedAt: new Date() },
        { id: 'C2', name: 'Counter 2', code: 'C2', branchId: 'B1', status: 'ACTIVE', tokenType: 'NORMAL', createdAt: new Date(), updatedAt: new Date() },
      ]);

      const mockNowTokens = [
        { id: 'T-NOW-1', counterId: 'C1', displayNumber: 'T-001', status: TokenStatus.SERVING },
      ];

      jest.spyOn(prismaService.token, 'findMany')
        // 1. current tokens
        .mockResolvedValueOnce([])
        // 2. recent rows
        .mockResolvedValueOnce([])
        // 3. activeCountersTokens
        .mockResolvedValueOnce(mockNowTokens as any)
        // 4. counterWaitingTokens for C1
        .mockResolvedValueOnce([
          { id: 'T1', counterId: 'C1', displayNumber: 'T-002', status: TokenStatus.WAITING, queueEntry: { patient: {}, service: { department: {} } }, counter: { name: 'Counter 1', code: 'C1' } },
          { id: 'T2', counterId: 'C1', displayNumber: 'T-004', status: TokenStatus.WAITING, queueEntry: { patient: {}, service: { department: {} } }, counter: { name: 'Counter 1', code: 'C1' } },
        ] as any)
        // 5. counterWaitingTokens for C2
        .mockResolvedValueOnce([
          { id: 'T3', counterId: 'C2', displayNumber: 'T-003', status: TokenStatus.WAITING, queueEntry: { patient: {}, service: { department: {} } }, counter: { name: 'Counter 2', code: 'C2' } },
        ] as any);

      jest.spyOn(prismaService.token, 'count').mockResolvedValue(3);

      const snapshot = await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      expect(snapshot.counters).toHaveLength(2);

      const c1 = snapshot.counters.find((c: any) => c.id === 'C1');
      const c2 = snapshot.counters.find((c: any) => c.id === 'C2');

      // Assert C1
      expect(c1.now.tokenLabel).toBe('T-001');
      expect(c1.next.tokenLabel).toBe('T-002');
      expect(c1.waitingTokens).toHaveLength(1);
      expect(c1.waitingTokens[0].tokenLabel).toBe('T-004');

      // Assert C2
      expect(c2.now).toBeNull();
      expect(c2.next.tokenLabel).toBe('T-003');
      expect(c2.waitingTokens).toHaveLength(0);
    });

    // TEST 1: 4 ACTIVE NORMAL + 1 ACTIVE SPECIAL = all 5 visible
    it('should show all ACTIVE counters: 4 NORMAL + 1 SPECIAL', async () => {
      setupBranchMock();
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([
        { id: 'C1', name: 'Counter 1', code: 'C1', tokenType: 'NORMAL' },
        { id: 'C2', name: 'Counter 2', code: 'C2', tokenType: 'NORMAL' },
        { id: 'C3', name: 'Counter 3', code: 'C3', tokenType: 'NORMAL' },
        { id: 'C4', name: 'Counter 4', code: 'C4', tokenType: 'NORMAL' },
        { id: 'C5', name: 'Counter 5', code: 'C5', tokenType: 'SPECIAL' },
      ] as any);

      setupTokenMocks({ waitingTotal: 0 });

      const snapshot = await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      expect(snapshot.counters).toHaveLength(5);
      const normalCounters = snapshot.counters.filter((c: any) => c.tokenType === 'NORMAL');
      const specialCounters = snapshot.counters.filter((c: any) => c.tokenType === 'SPECIAL');
      expect(normalCounters).toHaveLength(4);
      expect(specialCounters).toHaveLength(1);
    });

    // TEST 2: ACTIVE NORMAL counter with zero waiting tokens → still visible
    it('should show ACTIVE NORMAL counter with zero waiting tokens', async () => {
      setupBranchMock();
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([
        { id: 'C1', name: 'Counter 1', code: 'C1', tokenType: 'NORMAL' },
      ] as any);

      setupTokenMocks({ waitingTotal: 0 });

      const snapshot = await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      expect(snapshot.counters).toHaveLength(1);
      expect(snapshot.counters[0].tokenType).toBe('NORMAL');
      expect(snapshot.counters[0].now).toBeNull();
      expect(snapshot.counters[0].next).toBeNull();
      expect(snapshot.counters[0].waitingTokens).toHaveLength(0);
    });

    // TEST 3: ACTIVE SPECIAL counter with zero waiting tokens → still visible
    it('should show ACTIVE SPECIAL counter with zero waiting tokens', async () => {
      setupBranchMock();
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([
        { id: 'S1', name: 'Special 1', code: 'S1', tokenType: 'SPECIAL' },
      ] as any);

      setupTokenMocks({ waitingTotal: 0 });

      const snapshot = await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      expect(snapshot.counters).toHaveLength(1);
      expect(snapshot.counters[0].tokenType).toBe('SPECIAL');
      expect(snapshot.counters[0].now).toBeNull();
      expect(snapshot.counters[0].next).toBeNull();
    });

    // TEST 4: INACTIVE counter → not visible
    it('should NOT show INACTIVE counters', async () => {
      setupBranchMock();
      // The Prisma query filters by status: ACTIVE, so inactive counters
      // are never returned. We verify the query was called correctly.
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([] as any);

      setupTokenMocks({ waitingTotal: 0 });

      const snapshot = await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      expect(snapshot.counters).toHaveLength(0);

      // Verify that the counter query filters by ACTIVE status
      expect(prismaService.counter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        })
      );
    });

    // TEST 17: More than 3 active counters → no counters silently disappear
    it('should show all counters when more than 3 are active', async () => {
      setupBranchMock();
      const counters = Array.from({ length: 8 }, (_, i) => ({
        id: `C${i + 1}`, name: `Counter ${i + 1}`, code: `C${i + 1}`, tokenType: 'NORMAL',
      }));
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue(counters as any);

      setupTokenMocks({ waitingTotal: 0 });

      const snapshot = await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      expect(snapshot.counters).toHaveLength(8);
    });

    // Verify: Counter visibility does NOT depend on operator login/RefreshSession
    it('should NOT filter counters by operator login or RefreshSession', async () => {
      setupBranchMock();
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([
        { id: 'C1', name: 'Counter 1', code: 'C1', tokenType: 'NORMAL' },
      ] as any);

      setupTokenMocks({ waitingTotal: 0 });

      await (service as any).buildPublicSnapshot({ name: 'Test Display', branchId: 'B1' });

      // Verify the counter query does NOT include assignments/refreshSessions
      const counterQuery = (prismaService.counter.findMany as jest.Mock).mock.calls[0][0];
      expect(counterQuery.where).not.toHaveProperty('assignments');
    });
  });
});
