import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module';
import { CountersService } from '../apps/api/src/operations/counters.service';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';
import { CounterStatus } from '@prisma/client';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const countersService = app.get(CountersService);
  const prisma = app.get(PrismaService);
  
  const testOrg = await prisma.organization.create({
    data: { name: 'Queue Test Org', slug: 'queue-test-org-' + Date.now() }
  });
  const branch = await prisma.branch.create({
    data: { name: 'Test Branch', organizationId: testOrg.id, code: 'TB2' }
  });
  const department = await prisma.department.create({
    data: { name: 'General', branchId: branch.id }
  });
  const service = await prisma.service.create({
    data: { name: 'Main Service', departmentId: department.id }
  });

  const tenant = { organizationId: testOrg.id, branchId: branch.id, role: 'ORG_ADMIN' as const, userId: 'test' };

  // Create 4 counters
  const counters = [];
  for (let i = 1; i <= 4; i++) {
    const c = await countersService.create(tenant, branch.id, { name: `Counter ${i}`, code: `C${i}` });
    if (i !== 1) {
      await countersService.setStatus(tenant, branch.id, c.id, CounterStatus.INACTIVE);
    }
    counters.push(c);
  }
  
  const [c1, c2, c3, c4] = counters;

  const activeBusinessDate = new Date();
  activeBusinessDate.setUTCHours(0, 0, 0, 0);

  const sequence = await prisma.tokenSequence.create({
    data: {
      branchId: branch.id,
      serviceId: service.id,
      businessDate: activeBusinessDate,
      tokenType: 'NORMAL',
      nextNumber: 21
    }
  });

  for (let i = 1; i <= 20; i++) {
    const qe = await prisma.queueEntry.create({
      data: {
        serviceId: service.id,
        priority: 'NORMAL',
        status: 'WAITING'
      }
    });
    await prisma.token.create({
      data: {
        queueEntryId: qe.id,
        sequenceId: sequence.id,
        sequenceNumber: i,
        displayNumber: `T-${i.toString().padStart(3, '0')}`,
        businessDate: activeBusinessDate,
        counterId: c1.id, // initially to c1
        type: 'NORMAL',
        status: 'WAITING'
      }
    });
  }

  async function printDistribution(stepName) {
    const counts = await prisma.token.groupBy({
      by: ['counterId'],
      where: { queueEntry: { serviceId: service.id }, status: 'WAITING' },
      _count: { id: true }
    });
    const map = {};
    for (const count of counts) {
      if (!count.counterId) map['NULL'] = count._count.id;
      else {
        const c = counters.find(x => x.id === count.counterId);
        map[c.code] = count._count.id;
      }
    }
    console.log(`\n--- ${stepName} ---`);
    for (const c of counters) console.log(`${c.code}: ${map[c.code] || 0}`);
    if (map['NULL']) console.log(`NULL: ${map['NULL']}`);
  }

  await printDistribution('Initial State (C1 Active)');

  console.log('Activating C2...');
  await countersService.setStatus(tenant, branch.id, c2.id, CounterStatus.ACTIVE);
  await printDistribution('After Activating C2');

  console.log('Activating C3...');
  await countersService.setStatus(tenant, branch.id, c3.id, CounterStatus.ACTIVE);
  await printDistribution('After Activating C3');

  console.log('Activating C4...');
  await countersService.setStatus(tenant, branch.id, c4.id, CounterStatus.ACTIVE);
  await printDistribution('After Activating C4');

  console.log('Deactivating C2...');
  await countersService.setStatus(tenant, branch.id, c2.id, CounterStatus.INACTIVE);
  await printDistribution('After Deactivating C2');
  
  await app.close();
}

bootstrap().catch(console.error);
