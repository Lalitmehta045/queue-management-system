/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { TasksService } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayEventsService } from '../displays/display-events.service';
import { TokenStatus, QueueEntryStatus } from '@prisma/client';

describe('TasksService', () => {
  let service: TasksService;
  let prisma: PrismaService;
  let displayEvents: DisplayEventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: PrismaService,
          useValue: {
            branch: { findMany: jest.fn() },
            token: { findMany: jest.fn(), updateMany: jest.fn() },
            queueEntry: { updateMany: jest.fn() },
            $transaction: jest.fn((cb) => cb(prisma)),
            auditLog: { createMany: jest.fn() },
          },
        },
        {
          provide: DisplayEventsService,
          useValue: { publish: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
    prisma = module.get<PrismaService>(PrismaService);
    displayEvents = module.get<DisplayEventsService>(DisplayEventsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cancelEndOfDayTokens', () => {
    it('should cancel WAITING tokens if local time is >= 8:00 PM', async () => {
      // Mock branch with UTC timezone, and simulate it's after 8 PM
      jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([
        { id: 'branch-1', organization: { timezone: 'UTC' } } as any
      ]);

      // Mock native Date and Intl to return 20 (8 PM)
      const mockHour = '20';
      const mockDateString = '2026-08-18';
      
      jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) => {
        return {
          format: jest.fn().mockImplementation(() => {
            if (options?.hour) return mockHour;
            return mockDateString;
          })
        } as any;
      });

      // Mock tokens found
      jest.spyOn(prisma.token, 'findMany').mockResolvedValue([
        { id: 'token-1', queueEntryId: 'entry-1', displayNumber: 'A001' } as any
      ]);

      await service.cancelEndOfDayTokens();

      expect(prisma.token.findMany).toHaveBeenCalledWith({
        where: {
          sequence: { branchId: 'branch-1' },
          businessDate: new Date('2026-08-18T00:00:00.000Z'),
          status: TokenStatus.WAITING,
        },
        select: { id: true, queueEntryId: true, displayNumber: true }
      });

      expect(prisma.token.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['token-1'] } },
        data: { status: TokenStatus.CANCELLED },
      });

      expect(prisma.queueEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['entry-1'] } },
        data: { status: QueueEntryStatus.CANCELLED, activeEntryKey: null },
      });

      expect(prisma.auditLog.createMany).toHaveBeenCalled();
      expect(displayEvents.publish).toHaveBeenCalledWith('branch-1', 'QUEUE_UPDATED');
    });

    it('should not cancel tokens if local time is before 8:00 PM', async () => {
      jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([
        { id: 'branch-1', organization: { timezone: 'UTC' } } as any
      ]);

      jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) => {
        return {
          format: jest.fn().mockImplementation(() => {
            if (options?.hour) return '19'; // 7 PM
            return '2026-08-18';
          })
        } as any;
      });

      await service.cancelEndOfDayTokens();

      expect(prisma.token.findMany).not.toHaveBeenCalled();
      expect(prisma.token.updateMany).not.toHaveBeenCalled();
      expect(displayEvents.publish).not.toHaveBeenCalled();
    });

    it('should handle multiple branches in different timezones correctly', async () => {
      jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([
        { id: 'branch-ny', organization: { timezone: 'America/New_York' } } as any,
        { id: 'branch-tk', organization: { timezone: 'Asia/Tokyo' } } as any,
      ]);

      jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) => {
        return {
          format: jest.fn().mockImplementation(() => {
            if (options?.hour) {
              if (options?.timeZone === 'America/New_York') return '15'; // 3 PM
              if (options?.timeZone === 'Asia/Tokyo') return '21'; // 9 PM
            }
            return '2026-08-18';
          })
        } as any;
      });

      jest.spyOn(prisma.token, 'findMany').mockResolvedValue([
        { id: 'token-tk', queueEntryId: 'entry-tk', displayNumber: 'T001' } as any
      ]);

      await service.cancelEndOfDayTokens();

      // Only Tokyo branch tokens should be fetched and cancelled
      expect(prisma.token.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.token.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          sequence: { branchId: 'branch-tk' }
        })
      }));

      expect(prisma.token.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['token-tk'] } },
        data: { status: TokenStatus.CANCELLED },
      });
      expect(displayEvents.publish).toHaveBeenCalledWith('branch-tk', 'QUEUE_UPDATED');
    });

    it('should not cancel if job runs twice and tokens are already CANCELLED', async () => {
      jest.spyOn(prisma.branch, 'findMany').mockResolvedValue([
        { id: 'branch-1', organization: { timezone: 'UTC' } } as any
      ]);

      jest.spyOn(Intl, 'DateTimeFormat').mockImplementation((locale, options) => {
        return {
          format: jest.fn().mockImplementation(() => {
            if (options?.hour) return '20';
            return '2026-08-18';
          })
        } as any;
      });

      // Simulation of job running twice: findMany returns empty because status: WAITING matches nothing
      jest.spyOn(prisma.token, 'findMany').mockResolvedValue([]);

      await service.cancelEndOfDayTokens();

      expect(prisma.token.updateMany).not.toHaveBeenCalled();
      expect(prisma.queueEntry.updateMany).not.toHaveBeenCalled();
      expect(displayEvents.publish).not.toHaveBeenCalled();
    });
  });
});
