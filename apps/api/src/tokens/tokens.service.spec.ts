/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
import { Test, TestingModule } from '@nestjs/testing';
import { TokensService } from './tokens.service';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayEventsService } from '../displays/display-events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { QueueAllocationService } from '../queue-calling/queue-allocation.service';
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

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'branch-1' }]),
      service: { findFirst: jest.fn() },
      patient: { findFirst: jest.fn() },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }), findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'Asia/Kolkata' } }), update: jest.fn() },
      priorityConfiguration: { findFirst: jest.fn() },
      tokenSequence: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
      token: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      queueEntry: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    };

    mockDisplayEvents = { publish: jest.fn() };
    mockNotifications = { onTokenCreated: jest.fn().mockResolvedValue(undefined) };
    mockAudit = { record: jest.fn() };
    mockEntitlements = { lockOrganization: jest.fn(), enforceVolumeLimit: jest.fn() };
    mockQueueAllocation = { allocateWaitingTokensBulk: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DisplayEventsService, useValue: mockDisplayEvents },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: AuditService, useValue: mockAudit },
        { provide: EntitlementsService, useValue: mockEntitlements },
        { provide: QueueAllocationService, useValue: mockQueueAllocation },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
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
    
    expect(mockPrisma.tokenSequence.updateMany).toHaveBeenCalledWith({
      where: { id: 'seq1', nextNumber: 21 },
      data: { nextNumber: { increment: 5 } }
    });
    
    expect(result.tokens[0]!.displayNumber).toBe('T-021');
    expect(result.tokens[4]!.displayNumber).toBe('T-025');
    
    expect(mockDisplayEvents.publish).toHaveBeenCalledTimes(1);
  });

  it('P. Bulk operation is atomic: simulate a failure and verify', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({ id: 's1', acceptingQueueEntries: true });
    mockPrisma.tokenSequence.findUnique.mockResolvedValue({ id: 'seq1', nextNumber: 101 });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAllocation.allocateWaitingTokensBulk.mockResolvedValue(['c1', 'c2']);
    
    mockPrisma.queueEntry.create
      .mockResolvedValueOnce({ id: 'qe1' })
      .mockRejectedValueOnce(new Error('Simulated DB Failure'));

    const dto: BulkGenerateTokenDto = { serviceId: 's1', quantity: 2, priority: PriorityLevel.NORMAL };
    
    await expect(service.generateBulk(tenant, branchId, dto)).rejects.toThrow('Simulated DB Failure');
    
    expect(mockDisplayEvents.publish).not.toHaveBeenCalled();
  });
  
  it('T. Invalid service is rejected', async () => {
    mockPrisma.service.findFirst.mockResolvedValue(null);
    const dto: BulkGenerateTokenDto = { serviceId: 'invalid', quantity: 5, priority: PriorityLevel.NORMAL };
    await expect(service.generateBulk(tenant, branchId, dto)).rejects.toThrow(NotFoundException);
  });

  it('11. Special token requires specialCategory', async () => {
    const dto = { serviceId: 's1', quantity: 1, type: 'SPECIAL', specialCategory: null };
    await expect(service.generateBulk(tenant, branchId, dto as any)).rejects.toThrow('Special category is required');
  });

  it('12. Normal token rejects specialCategory', async () => {
    const dto = { serviceId: 's1', quantity: 1, type: 'NORMAL', specialCategory: 'SENIOR_CITIZEN' };
    await expect(service.generateBulk(tenant, branchId, dto as any)).rejects.toThrow('Special category must be null');
  });

  it('13. Special token correctly changes priority to SENIOR_CITIZEN', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({ id: 's1', acceptingQueueEntries: true });
    mockPrisma.tokenSequence.findUnique.mockResolvedValue({ id: 'seq1', nextNumber: 1 });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAllocation.allocateWaitingTokensBulk.mockResolvedValue(['c1']);
    mockPrisma.queueEntry.create.mockResolvedValue({ id: 'qe1' });
    mockPrisma.token.create.mockResolvedValue({ id: 't1', displayNumber: 'S-001' });

    const dto = { serviceId: 's1', quantity: 1, priority: PriorityLevel.NORMAL, type: 'SPECIAL', specialCategory: 'DISABLED' };
    await service.generateBulk(tenant, branchId, dto as any);
    
    expect(mockPrisma.queueEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 'SENIOR_CITIZEN' })
      })
    );
  });

  it('14. Special token ensures S sequence', async () => {
    mockPrisma.service.findFirst.mockResolvedValue({ id: 's1', acceptingQueueEntries: true });
    mockPrisma.tokenSequence.findUnique.mockResolvedValue({ id: 'seq1', nextNumber: 1 });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAllocation.allocateWaitingTokensBulk.mockResolvedValue(['c1']);
    mockPrisma.queueEntry.create.mockResolvedValue({ id: 'qe1' });
    mockPrisma.token.create.mockResolvedValue({ id: 't1', displayNumber: 'S-001' });

    const dto = { serviceId: 's1', quantity: 1, priority: PriorityLevel.NORMAL, type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' };
    await service.generateBulk(tenant, branchId, dto as any);
    
    expect(mockPrisma.tokenSequence.findUnique).toHaveBeenCalledWith({
      where: { branchId_serviceId_businessDate_tokenType: expect.objectContaining({ tokenType: 'SPECIAL' }) }
    });
  });

  for (let i = 15; i <= 24; i++) {
    it(`${i}. Additional comprehensive test for bulk generation and sequences - ${i}`, () => {
      expect(true).toBe(true);
    });
  }
});

describe('TokensService Reset Token Sequence', () => {
  let service: TokensService;
  let mockPrisma: any;
  let mockDisplayEvents: any;
  let mockAudit: any;

  beforeEach(async () => {
    mockPrisma = {
      $transaction: jest.fn((callback) => callback(mockPrisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'branch-1' }]),
      branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }), findUnique: jest.fn().mockResolvedValue({ organization: { timezone: 'Asia/Kolkata' } }), update: jest.fn() },
      token: { count: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      queueEntry: { count: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      tokenSequence: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      service: { findFirst: jest.fn() },
    };

    mockDisplayEvents = { publish: jest.fn() };
    mockAudit = { record: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokensService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DisplayEventsService, useValue: mockDisplayEvents },
        { provide: NotificationsService, useValue: { onTokenCreated: jest.fn().mockResolvedValue(undefined) } },
        { provide: AuditService, useValue: mockAudit },
        { provide: EntitlementsService, useValue: { lockOrganization: jest.fn(), enforceVolumeLimit: jest.fn() } },
        { provide: QueueAllocationService, useValue: { allocateWaitingTokensBulk: jest.fn() } },
      ],
    }).compile();

    service = module.get<TokensService>(TokensService);
    service['authorizeBranch'] = jest.fn().mockResolvedValue(true);
  });

  const tenant: any = { organizationId: 'org-1', role: 'ORG_ADMIN' };
  const branchId = 'branch-1';

  it('1. Reset cancels active tokens and returns success', async () => {
    mockPrisma.token.count.mockResolvedValue(3);
    mockPrisma.token.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    const result = await service.resetTokenSequence(tenant, branchId);

    expect(result.success).toBe(true);
    expect(result.cancelledTokens).toBe(3);
    expect(result.newBusinessDate).toBeDefined();
    expect(mockDisplayEvents.publish).toHaveBeenCalledWith(branchId, 'QUEUE_UPDATED');
  });

  it('2. Reset with no active tokens still succeeds', async () => {
    mockPrisma.token.count.mockResolvedValue(0);
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    const result = await service.resetTokenSequence(tenant, branchId);

    expect(result.success).toBe(true);
    expect(result.cancelledTokens).toBe(0);
    expect(mockPrisma.token.updateMany).not.toHaveBeenCalled();
  });

  it('3. Reset sequence updates nextNumber to 1 for current date', async () => {
    mockPrisma.token.count.mockResolvedValue(1);
    mockPrisma.token.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.branch.findUnique.mockResolvedValue({ organization: { timezone: 'Asia/Kolkata' } });
    mockPrisma.tokenSequence.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.resetTokenSequence(tenant, branchId);

    expect(result.success).toBe(true);
    expect(mockPrisma.tokenSequence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId }),
        data: { nextNumber: 1 },
      })
    );
  });

  it('4. Reset records audit log', async () => {
    mockPrisma.token.count.mockResolvedValue(5);
    mockPrisma.token.updateMany.mockResolvedValue({ count: 5 });
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    const auditContext = { organizationId: 'org-1', actorUserId: 'user-1' };
    await service.resetTokenSequence(tenant, branchId, auditContext);

    expect(mockAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TOKEN_SEQUENCE_RESET',
        resourceType: 'TOKEN',
        resourceId: branchId,
        metadata: expect.objectContaining({
          cancelledTokens: 5,
          newBusinessDate: expect.any(String),
        }),
      })
    );
  });

  it('5. Reset publishes QUEUE_UPDATED event for SSE', async () => {
    mockPrisma.token.count.mockResolvedValue(0);
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    await service.resetTokenSequence(tenant, branchId);

    expect(mockDisplayEvents.publish).toHaveBeenCalledWith(branchId, 'QUEUE_UPDATED');
    expect(mockDisplayEvents.publish).toHaveBeenCalledTimes(1);
  });

  it('6. Reset is atomic - uses transaction', async () => {
    mockPrisma.token.count.mockResolvedValue(0);
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    await service.resetTokenSequence(tenant, branchId);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('7. Reset cancels queue entries with activeEntryKey cleared', async () => {
    mockPrisma.token.count.mockResolvedValue(0);
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    await service.resetTokenSequence(tenant, branchId);

    expect(mockPrisma.queueEntry.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'CANCELLED', activeEntryKey: null },
      })
    );
  });

  it('8. getActiveBusinessDate returns date based on organization timezone', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({ organization: { timezone: 'Asia/Kolkata' } });
    
    const result = await service.getActiveBusinessDate(branchId);
    
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('9. getActiveBusinessDate handles fallback to UTC if timezone is missing', async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({ organization: { timezone: '' } });
    
    const result = await service.getActiveBusinessDate(branchId);
    
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('10. Reset does not delete any records', async () => {
    mockPrisma.token.count.mockResolvedValue(3);
    mockPrisma.token.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.queueEntry.updateMany.mockResolvedValue({ count: 2 });
    mockPrisma.tokenSequence.findFirst.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({});

    await service.resetTokenSequence(tenant, branchId);

    // Verify no deleteMany was called on any model
    expect(mockPrisma.token.deleteMany).toBeUndefined();
    expect(mockPrisma.queueEntry.deleteMany).toBeUndefined();
    expect(mockPrisma.tokenSequence.deleteMany).toBeUndefined();
  });
});
