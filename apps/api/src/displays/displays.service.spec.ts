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
    it('should assign unique tokens to correct counters and remove NEXT from waiting', async () => {
      // Mock branches and counters
      jest.spyOn(prismaService.branch, 'findUnique').mockResolvedValue({ organization: { timezone: 'UTC' } } as any);
      jest.spyOn(prismaService.counter, 'findMany').mockResolvedValue([
        { id: 'C1', name: 'Counter 1', code: 'C1', branchId: 'B1', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
        { id: 'C2', name: 'Counter 2', code: 'C2', branchId: 'B1', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() },
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
  });
});
