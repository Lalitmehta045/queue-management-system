import { PrismaClient } from '@prisma/client';
import { QueueAllocationService } from './src/queue-calling/queue-allocation.service';
import { QueueCallingService } from './src/queue-calling/queue-calling.service';
import { DisplaysService } from './src/displays/displays.service';
import { TokensService } from './src/tokens/tokens.service';
import { AnalyticsService } from './src/analytics/analytics.service';
import { NotificationsService } from './src/notifications/notifications.service';
import { ConfigService } from '@nestjs/config';

// Mock dependencies
const configService = new ConfigService();
const prisma = new PrismaClient();
const mockQueueCallingGateway = {
  notifyTokenCalled: jest.fn(),
  notifyTokenStatusChanged: jest.fn(),
  notifyTokenCreated: jest.fn(),
  notifyDisplaySnapshot: jest.fn(),
  notifyAllocationError: jest.fn(),
} as any;
const mockEventEmitter = { emit: jest.fn() } as any;

const tokensService = new TokensService(prisma, configService, mockQueueCallingGateway);
const queueAllocationService = new QueueAllocationService(prisma, mockQueueCallingGateway, mockEventEmitter);
const queueCallingService = new QueueCallingService(prisma, queueAllocationService, mockQueueCallingGateway);
const displaysService = new DisplaysService(prisma, queueAllocationService, mockQueueCallingGateway);
const analyticsService = new AnalyticsService(prisma);
const notificationsService = new NotificationsService(prisma, configService);

async function run() {
  console.log('Starting regression tests...');
  
  // Clean up any pending state if needed or just use isolated queries
  const branch = await prisma.branch.findFirst({ include: { organization: true } });
  if (!branch) {
    console.log('No branch found, exiting.');
    return;
  }
  
  const tenant = { organizationId: branch.organizationId, branchId: branch.id, role: 'BRANCH_ADMIN', userId: 'test-user', userStatus: 'ACTIVE' } as any;

  console.log('Testing Displays Service buildPublicSnapshot...');
  // Find a display in this branch
  const display = await prisma.display.findFirst({ where: { branchId: branch.id } });
  if (display) {
    // Calling private method via casting
    const snapshot = await (displaysService as any).buildPublicSnapshot(display);
    console.log('Snapshot generated successfully:', !!snapshot);
    console.log('Waiting tokens count in snapshot:', snapshot?.waitingTokens?.length);
  }

  console.log('Testing Analytics Service...');
  const summary = await analyticsService.getSummary(tenant, branch.id, {});
  console.log('Analytics summary:', summary);

  console.log('Regression testing queries pass without error!');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
