const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');

const prisma = new PrismaClient();

async function run() {
  console.log('Starting exact queue allocation verification...');
  
  // 1. Setup clean environment
  const testOrg = await prisma.organization.create({
    data: { name: 'Queue Test Org', slug: 'queue-test-org-' + Date.now() }
  });
  const branch = await prisma.branch.create({
    data: { name: 'Test Branch', organizationId: testOrg.id, code: 'TB1' }
  });
  const department = await prisma.department.create({
    data: { name: 'General', branchId: branch.id }
  });
  const service = await prisma.service.create({
    data: { name: 'Main Service', departmentId: department.id }
  });

  // Create 4 counters
  const counters = [];
  for (let i = 1; i <= 4; i++) {
    const c = await prisma.counter.create({
      data: {
        branchId: branch.id,
        name: `Counter ${i}`,
        code: `C${i}`,
        status: i === 1 ? 'ACTIVE' : 'INACTIVE',
        tokenType: 'NORMAL'
      }
    });
    counters.push(c);
  }
  
  const [c1, c2, c3, c4] = counters;
  console.log('Created 4 counters. Only C1 is ACTIVE.');

  // Create 20 waiting NORMAL tokens
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

  // Helper to print token distribution
  async function printDistribution(stepName) {
    const counts = await prisma.token.groupBy({
      by: ['counterId'],
      where: {
        queueEntry: { serviceId: service.id },
        status: 'WAITING'
      },
      _count: { id: true }
    });
    const map = {};
    for (const count of counts) {
      if (!count.counterId) {
        map['NULL'] = count._count.id;
      } else {
        const c = counters.find(x => x.id === count.counterId);
        map[c.code] = count._count.id;
      }
    }
    console.log(`\n--- ${stepName} ---`);
    for (const c of counters) {
      console.log(`${c.code}: ${map[c.code] || 0}`);
    }
    if (map['NULL']) console.log(`NULL: ${map['NULL']}`);
  }

  await printDistribution('Initial State (C1 Active)');

  // Helper to toggle counter via HTTP or direct service if possible.
  // We'll use the API by simulating the endpoint if possible, but since this is just a script,
  // we can just call the service method if we compile it, but this is a pure Prisma script.
  // Wait, to actually verify the backend implementation, we should use HTTP to hit the API, 
  // or we can just import the NestJS app context.
  console.log('Use Nest API or internal app context to trigger reallocation...');
}

run().catch(console.error).finally(() => prisma.$disconnect());
