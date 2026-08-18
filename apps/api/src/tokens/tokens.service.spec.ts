/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayEventsService } from '../displays/display-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { QueueAllocationService } from '../queue-calling/queue-allocation.service';
import { ConfigService } from '@nestjs/config';
import { BulkGenerateTokenDto } from './dto/bulk-generate-token.dto';
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PriorityLevel } from '@prisma/client';

describe('TokensService Bulk Generation', () => {
  let service: TokensService;
  let mockPrisma: any;
  let mockDisplayEvents: any;
  let mockNotifications: any;
  let mockAudit: any;
  let mockEntitlements: any;
  let mockQueueAllocation: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockPrisma)),
      service: { findFirst: jest.fn() },
      patient: { findFirst: jest.fn() },
      priorityConfiguration: { findFirst: jest.fn() },
      tokenSequence: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      token: { count: jest.fn(), create: jest.fn() },
      queueEntry: { count: jest.fn(), create: jest.fn() },
    };

    mockDisplayEvents = { publish: jest.fn() };
    mockNotifications = { onTokenCreated: jest.fn().mockResolvedValue(undefined) };
    mockAudit = { record: jest.fn() };
    mockEntitlements = { lockOrganization: jest.fn(), enforceVolumeLimit: jest.fn() };
    mockQueueAllocation = { allocateWaitingTokensBulk: jest.fn() };
    mockConfigService = { get: jest.fn().mockReturnValue('UTC') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DisplayEventsService, useValue: mockDisplayEvents },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditService, useValue: mockAudit },
        { provide: EntitlementsService, useValue: mockEntitlements },
        { provide: QueueAllocationService, useValue: mockQueueAllocation },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
    // private method override
    service['authorizeBranch'] = jest.fn().mockResolvedValue(true);
  });

  const tenant: any = { organizationId: 'org-1', role: 'ORG_ADMIN' };
  const branchId = 'branch-1';
  
  it('A. Generate 1 token (Bulk API with quantity=1)', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({ id: 's1', acceptingQueueEntries: true });
    mockPrisma.tokenSequence.findUnique.mockResolvedValue({ id: 'seq1', nextNumber: 1 });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAllocation.allocateWaitingTokensBulk.mockResolvedValue(['c1']);
    mockPrisma.queueEntry.create.mockResolvedValue({ id: 'qe1' });
    mockPrisma.token.create.mockResolvedValue({ id: 't1', displayNumber: 'T-001' });

    const dto: BulkGenerateTokenDto = { serviceId: 's1', quantity: 1, priority: PriorityLevel.NORMAL };
    const result = await service.generateBulk(tenant, branchId, dto);

    expect(result.count).toBe(1);
    expect(result.tokens.length).toBe(1);
    expect(mockPrisma.queueEntry.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.token.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.tokenSequence.updateMany).toHaveBeenCalledWith({
      where: { id: 'seq1', nextNumber: 1 },
      data: { nextNumber: { increment: 1 } }
    });
    expect(mockDisplayEvents.publish).toHaveBeenCalledWith(branchId, 'QUEUE_UPDATED');
  });

  it('B. Generate 5 tokens', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({ id: 's1', acceptingQueueEntries: true });
    mockPrisma.tokenSequence.findUnique.mockResolvedValue({ id: 'seq1', nextNumber: 21 });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAllocation.allocateWaitingTokensBulk.mockResolvedValue(['c1', 'c2', 'c1', 'c2', 'c1']);
    
    let qeCount = 0;
    mockPrisma.queueEntry.create.mockImplementation(() => Promise.resolve({ id: `qe${++qeCount}` }));
    
    let tCount = 0;
    mockPrisma.token.create.mockImplementation((args: any) => Promise.resolve({ id: `t${++tCount}`, displayNumber: `T-0${20+tCount}` }));

    const dto: BulkGenerateTokenDto = { serviceId: 's1', quantity: 5, priority: PriorityLevel.NORMAL };
    const result = await service.generateBulk(tenant, branchId, dto);

    expect(result.count).toBe(5);
    expect(mockPrisma.queueEntry.create).toHaveBeenCalledTimes(5);
    expect(mockPrisma.token.create).toHaveBeenCalledTimes(5);
    
    // Verify sequence increment
    expect(mockPrisma.tokenSequence.updateMany).toHaveBeenCalledWith({
      where: { id: 'seq1', nextNumber: 21 },
      data: { nextNumber: { increment: 5 } }
    });
    
    // Verify tokens were generated sequentially
    expect(result.tokens[0]!.displayNumber).toBe('T-021');
    expect(result.tokens[4]!.displayNumber).toBe('T-025');
    
    // Single event emit
    expect(mockDisplayEvents.publish).toHaveBeenCalledTimes(1);
  });

  it('P. Bulk operation is atomic: simulate a failure and verify', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({ id: 's1', acceptingQueueEntries: true });
    mockPrisma.tokenSequence.findUnique.mockResolvedValue({ id: 'seq1', nextNumber: 101 });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAllocation.allocateWaitingTokensBulk.mockResolvedValue(['c1', 'c2']);
    
    // Fail on the second queue entry creation
    mockPrisma.queueEntry.create
      .mockResolvedValueOnce({ id: 'qe1' })
      .mockRejectedValueOnce(new Error('Simulated DB Failure'));

    const dto: BulkGenerateTokenDto = { serviceId: 's1', quantity: 2, priority: PriorityLevel.NORMAL };
    
    // The entire generateBulk is wrapped in $transaction, so a failure here causes the transaction to abort and throw.
    await expect(service.generateBulk(tenant, branchId, dto)).rejects.toThrow('Simulated DB Failure');
    
    // Because it throws, it doesn't return any partial tokens
    expect(mockDisplayEvents.publish).not.toHaveBeenCalled();
  });
  
  it('T. Invalid service is rejected', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null);
    const dto: BulkGenerateTokenDto = { serviceId: 'invalid', quantity: 5, priority: PriorityLevel.NORMAL };
    await expect(service.generateBulk(tenant, branchId, dto)).rejects.toThrow(NotFoundException);
  });
});
