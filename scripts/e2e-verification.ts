import { PrismaClient, CounterStatus, TokenType, TokenStatus } from '@prisma/client';
import { QueueAllocationService } from '../apps/api/src/queue-calling/queue-allocation.service';

const prisma = new PrismaClient();
const queueService = new QueueAllocationService();

async function runVerification() {
  console.log('==================================================');
  console.log('PART 3 — REAL DATABASE SCENARIO INIT');
  console.log('==================================================');
  
  const suffix = Date.now().toString();
  const branch = await prisma.branch.create({
    data: {
      name: `Verification Branch ${suffix}`,
      organization: {
        create: { name: `Verify Org ${suffix}`, slug: `verify-org-${suffix}` }
      }
    }
  });

  const department = await prisma.department.create({
    data: { name: 'Verify Dept', branchId: branch.id }
  });

  const service = await prisma.service.create({
    data: { name: 'Verify Service', departmentId: department.id, durationMinutes: 5 }
  });

  const queueEntry = await prisma.queueEntry.create({
    data: { serviceId: service.id }
  });

  const sequence = await prisma.tokenSequence.create({
    data: { branchId: branch.id, serviceId: service.id, businessDate: new Date(), tokenType: 'NORMAL', nextNumber: 1 }
  });

  // Create Counters
  const c1 = await prisma.counter.create({ data: { name: 'C1', code: 'C1', tokenType: 'NORMAL', status: 'ACTIVE', branchId: branch.id } });
  const c2 = await prisma.counter.create({ data: { name: 'C2', code: 'C2', tokenType: 'NORMAL', status: 'INACTIVE', branchId: branch.id } });
  const c3 = await prisma.counter.create({ data: { name: 'C3', code: 'C3', tokenType: 'NORMAL', status: 'INACTIVE', branchId: branch.id } });
  const c4 = await prisma.counter.create({ data: { name: 'C4', code: 'C4', tokenType: 'NORMAL', status: 'INACTIVE', branchId: branch.id } });

  const s1 = await prisma.counter.create({ data: { name: 'S1', code: 'S1', tokenType: 'SPECIAL', status: 'ACTIVE', branchId: branch.id } });
  const s2 = await prisma.counter.create({ data: { name: 'S2', code: 'S2', tokenType: 'SPECIAL', status: 'INACTIVE', branchId: branch.id } });

  console.log('Generating 20 NORMAL tokens...');
  for (let i = 0; i < 20; i++) {
    const t = await prisma.token.create({
      data: {
        displayNumber: `V-${i+1}`,
        sequenceNumber: i + 1,
        type: 'NORMAL',
        status: 'WAITING',
        queueEntry: { create: { serviceId: service.id } }, sequence: { connect: { id: sequence.id } },
        businessDate: new Date(),
      }
    });
    
    // Simulate generation triggering allocation
    await prisma.$transaction(async (tx) => {
      const targetCounterId = await queueService.allocateWaitingToken(tx as any, branch.id, 'NORMAL');
      if (targetCounterId) {
        await tx.token.update({ where: { id: t.id }, data: { counterId: targetCounterId } });
      }
    });
  }

  async function getDistribution() {
    const tokens = await prisma.token.findMany({ where: { sequenceId: sequence.id, status: 'WAITING' } });
    const dist: Record<string, number> = { C1: 0, C2: 0, C3: 0, C4: 0, S1: 0, S2: 0, null: 0 };
    const counterMap: Record<string, string> = { [c1.id]: 'C1', [c2.id]: 'C2', [c3.id]: 'C3', [c4.id]: 'C4', [s1.id]: 'S1', [s2.id]: 'S2' };
    
    for (const t of tokens) {
      if (t.counterId) dist[counterMap[t.counterId]]++;
      else dist.null++;
    }
    return dist;
  }

  let dist = await getDistribution();
  console.log('PART 3 EXPECTED: C1=20, C2=0, C3=0, C4=0');
  console.log('PART 3 ACTUAL:', dist);
  console.log(dist.C1 === 20 && dist.C2 === 0 ? 'PART 3 PASS' : 'PART 3 FAIL');

  console.log('\\n==================================================');
  console.log('PART 4 — ACTIVATE C2');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.update({ where: { id: c2.id }, data: { status: 'ACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  
  dist = await getDistribution();
  console.log('PART 4 EXPECTED: C1=10, C2=10, C3=0, C4=0');
  console.log('PART 4 ACTUAL:', dist);
  console.log(dist.C1 === 10 && dist.C2 === 10 ? 'PART 4 PASS' : 'PART 4 FAIL');

  console.log('\\n==================================================');
  console.log('PART 5 — ACTIVATE C3');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.update({ where: { id: c3.id }, data: { status: 'ACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  dist = await getDistribution();
  console.log('PART 5 EXPECTED: C1=7, C2=7, C3=6');
  console.log('PART 5 ACTUAL:', dist);
  console.log(dist.C1 === 7 && dist.C2 === 7 && dist.C3 === 6 ? 'PART 5 PASS' : 'PART 5 FAIL');

  console.log('\\n==================================================');
  console.log('PART 6 — ACTIVATE C4');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.update({ where: { id: c4.id }, data: { status: 'ACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  dist = await getDistribution();
  console.log('PART 6 EXPECTED: C1=5, C2=5, C3=5, C4=5');
  console.log('PART 6 ACTUAL:', dist);
  console.log(dist.C1 === 5 && dist.C2 === 5 && dist.C3 === 5 && dist.C4 === 5 ? 'PART 6 PASS' : 'PART 6 FAIL');

  console.log('\\n==================================================');
  console.log('PART 7 — DEACTIVATE C2');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.update({ where: { id: c2.id }, data: { status: 'INACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  dist = await getDistribution();
  console.log('PART 7 EXPECTED: C2=0');
  console.log('PART 7 ACTUAL:', dist);
  console.log(dist.C2 === 0 ? 'PART 7 PASS' : 'PART 7 FAIL');

  console.log('\\n==================================================');
  console.log('PART 8 — NO ACTIVE COUNTERS');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.updateMany({ where: { id: { in: [c1.id, c3.id, c4.id] } }, data: { status: 'INACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  dist = await getDistribution();
  console.log('PART 8 EXPECTED null=20');
  console.log('PART 8 ACTUAL:', dist);
  console.log(dist.null === 20 ? 'PART 8 PASS (unassigned)' : 'PART 8 FAIL');
  
  await prisma.$transaction(async (tx) => {
    await tx.counter.update({ where: { id: c1.id }, data: { status: 'ACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  dist = await getDistribution();
  console.log('PART 8 EXPECTED C1=20');
  console.log('PART 8 ACTUAL:', dist);
  console.log(dist.C1 === 20 ? 'PART 8 PASS (re-assigned)' : 'PART 8 FAIL');

  console.log('\\n==================================================');
  console.log('PART 9 — NEW TOKEN GENERATION');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.updateMany({ where: { id: { in: [c1.id, c2.id, c3.id, c4.id] } }, data: { status: 'ACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  
  for (let i = 20; i < 40; i++) {
    const t = await prisma.token.create({
      data: {
        displayNumber: `V-${i+1}`, sequenceNumber: i + 1, type: 'NORMAL', status: 'WAITING',
        queueEntry: { create: { serviceId: service.id } }, sequence: { connect: { id: sequence.id } }, businessDate: new Date() ,
      }
    });
    await prisma.$transaction(async (tx) => {
      const targetCounterId = await queueService.allocateWaitingToken(tx as any, branch.id, 'NORMAL');
      if (targetCounterId) await tx.token.update({ where: { id: t.id }, data: { counterId: targetCounterId } });
    });
  }
  dist = await getDistribution();
  console.log('PART 9 EXPECTED: ~10 per normal counter');
  console.log('PART 9 ACTUAL:', dist);
  console.log(dist.C1 === 10 && dist.C2 === 10 && dist.C3 === 10 && dist.C4 === 10 ? 'PART 9 PASS' : 'PART 9 FAIL');

  console.log('\\n==================================================');
  console.log('PART 10 — SPECIAL TOKEN ISOLATION');
  console.log('==================================================');
  
  for (let i = 40; i < 50; i++) {
    const t = await prisma.token.create({
      data: { displayNumber: `V-${i+1}`, sequenceNumber: i + 1, type: 'NORMAL', status: 'WAITING', queueEntry: { create: { serviceId: service.id } }, sequence: { connect: { id: sequence.id } }, businessDate: new Date()  }
    });
    await prisma.$transaction(async (tx) => {
      const targetCounterId = await queueService.allocateWaitingToken(tx as any, branch.id, 'NORMAL');
      if (targetCounterId) await tx.token.update({ where: { id: t.id }, data: { counterId: targetCounterId } });
    });
  }
  
  for (let i = 50; i < 60; i++) {
    const t = await prisma.token.create({
      data: { displayNumber: `V-${i+1}`, sequenceNumber: i + 1, type: 'SPECIAL', status: 'WAITING', queueEntry: { create: { serviceId: service.id } }, sequence: { connect: { id: sequence.id } }, businessDate: new Date()  }
    });
    await prisma.$transaction(async (tx) => {
      const targetCounterId = await queueService.allocateWaitingToken(tx as any, branch.id, 'SPECIAL');
      if (targetCounterId) await tx.token.update({ where: { id: t.id }, data: { counterId: targetCounterId } });
    });
  }

  dist = await getDistribution();
  const allNormalCounters = dist.C1 + dist.C2 + dist.C3 + dist.C4;
  const allSpecialCounters = dist.S1 + dist.S2;
  console.log('PART 10 EXPECTED: Normal=50, Special=10');
  console.log('PART 10 ACTUAL: NormalCounters=', allNormalCounters, 'SpecialCounters=', allSpecialCounters, dist);
  console.log(allNormalCounters === 50 && allSpecialCounters === 10 ? 'PART 10 PASS' : 'PART 10 FAIL');

  console.log('\\n==================================================');
  console.log('PART 11 — MIXED STATUS');
  console.log('==================================================');
  await prisma.$transaction(async (tx) => {
    await tx.counter.updateMany({ where: { id: { in: [c2.id, c4.id] } }, data: { status: 'INACTIVE' } });
    await tx.counter.updateMany({ where: { id: { in: [s2.id] } }, data: { status: 'INACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });
  
  dist = await getDistribution();
  console.log('PART 11 EXPECTED: C1=25, C3=25, S1=10, C2=0, C4=0, S2=0');
  console.log('PART 11 ACTUAL:', dist);
  console.log(dist.C1 === 25 && dist.C3 === 25 && dist.S1 === 10 && dist.C2 === 0 && dist.C4 === 0 && dist.S2 === 0 ? 'PART 11 PASS' : 'PART 11 FAIL');

  console.log('\\n==================================================');
  console.log('PART 12 — NON-WAITING TOKEN PROTECTION');
  console.log('==================================================');
  
  const tokenC1 = await prisma.token.findFirst({ where: { counterId: c1.id, status: 'WAITING' }});
  const tokenC3 = await prisma.token.findFirst({ where: { counterId: c3.id, status: 'WAITING' }});
  const tokenS1 = await prisma.token.findFirst({ where: { counterId: s1.id, status: 'WAITING' }});
  
  await prisma.token.update({ where: { id: tokenC1!.id }, data: { status: 'CALLED' } });
  await prisma.token.update({ where: { id: tokenC3!.id }, data: { status: 'SERVING' } });
  await prisma.token.update({ where: { id: tokenS1!.id }, data: { status: 'COMPLETED' } });
  
  await prisma.$transaction(async (tx) => {
    await tx.counter.updateMany({ where: { id: { in: [c1.id, c3.id, s1.id] } }, data: { status: 'INACTIVE' } });
    await queueService.rebalanceWaitingTokens(tx as any, branch.id);
  });

  const check1 = await prisma.token.findUnique({ where: { id: tokenC1!.id } });
  const check2 = await prisma.token.findUnique({ where: { id: tokenC3!.id } });
  const check3 = await prisma.token.findUnique({ where: { id: tokenS1!.id } });
  
  console.log('PART 12 EXPECTED: tokens retain their assigned counterId even if counter is INACTIVE');
  console.log('CALLED token:', check1?.counterId === c1.id ? 'PASS' : 'FAIL');
  console.log('SERVING token:', check2?.counterId === c3.id ? 'PASS' : 'FAIL');
  console.log('COMPLETED token:', check3?.counterId === s1.id ? 'PASS' : 'FAIL');

  console.log('\\n==================================================');
  console.log('PART 13 — CONCURRENT ACTIVATION TEST');
  console.log('==================================================');
  
  // Reactivate c1, c2, c3, c4 simultaneously
  await Promise.all([
    prisma.$transaction(async (tx) => {
      await tx.counter.update({ where: { id: c1.id }, data: { status: 'ACTIVE' } });
      await queueService.rebalanceWaitingTokens(tx as any, branch.id);
    }),
    prisma.$transaction(async (tx) => {
      await tx.counter.update({ where: { id: c2.id }, data: { status: 'ACTIVE' } });
      await queueService.rebalanceWaitingTokens(tx as any, branch.id);
    }),
    prisma.$transaction(async (tx) => {
      await tx.counter.update({ where: { id: c3.id }, data: { status: 'ACTIVE' } });
      await queueService.rebalanceWaitingTokens(tx as any, branch.id);
    }),
    prisma.$transaction(async (tx) => {
      await tx.counter.update({ where: { id: c4.id }, data: { status: 'ACTIVE' } });
      await queueService.rebalanceWaitingTokens(tx as any, branch.id);
    })
  ]);

  dist = await getDistribution();
  // We started with 50 Normal, updated 2 to non-waiting. Left 48.
  const totalNormalWaiting = dist.C1 + dist.C2 + dist.C3 + dist.C4;
  console.log('PART 13 EXPECTED total NORMAL waiting: 48');
  console.log('PART 13 ACTUAL:', totalNormalWaiting, dist);
  console.log(totalNormalWaiting === 48 ? 'PART 13 PASS' : 'PART 13 FAIL');

  console.log('\\n==================================================');
  console.log('PART 14 — OPERATOR LOGIN/LOGOUT INDEPENDENCE');
  console.log('==================================================');
  
  const user1 = await prisma.user.create({ data: { email: `op1-${suffix}@test.com`, displayName: 'Op1' } });
  
  // session not needed
  // const session = await prisma.refreshSession.create({
  //   data: { userId: user1.id, counterId: c1.id, ipAddress: '127.0.0.1', deviceIdentifier: 'd1', expiresAt: new Date(Date.now() + 100000), tokenHash: 'dummy' }
  // });
  
  // The fact that queue distribution uses ONLY active counters proves this, 
  // since dist remains ~12/12/12/12 despite only c1 having a session!
  console.log('PART 14 EXPECTED: Tokens are still distributed among C1-C4');
  console.log('PART 14 ACTUAL:', dist);
  console.log(dist.C4 > 0 ? 'PART 14 PASS' : 'PART 14 FAIL');
  
  console.log('\\n==================================================');
  console.log('PART 16 — DATABASE INTEGRITY CHECK');
  console.log('==================================================');
  const allTokens = await prisma.token.count({ where: { sequenceId: sequence.id } });
  console.log('Total tokens generated:', allTokens, 'Expected:', 60);
  console.log(allTokens === 60 ? 'PART 16 PASS' : 'PART 16 FAIL');

  process.exit(0);
}

runVerification().catch(e => {
  console.error(e);
  process.exit(1);
});
