import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  console.log('--- REGRESSION TEST SCRIPT ---');

  // 1. Fetch some metadata
  const branch = await prisma.branch.findFirst({ include: { organization: true, departments: { include: { services: true } } } });
  if (!branch) throw new Error('No branch found');
  
  const department = branch.departments[0];
  if (!department) throw new Error('No department found');
  const service = department.services[0];
  if (!service) throw new Error('No service found');
  const counter = await prisma.counter.findFirst({ where: { branchId: branch.id } });
  if (!counter) throw new Error('No counter found');

  const tenant = { organizationId: branch.organizationId, branchId: branch.id, role: 'BRANCH_ADMIN' };

  console.log('Creating a walk-in queue entry...');
  const walkInEntry = await prisma.queueEntry.create({
    data: {
      // Walk-in (no patient)
      service: { connect: { id: service.id } },
      priority: 'NORMAL',
      status: 'WAITING',
    }
  });

  // Ensure sequence exists
  let tokenSequence = await prisma.tokenSequence.findFirst({ where: { serviceId: service.id, branchId: branch.id } });
  if (!tokenSequence) {
     tokenSequence = await prisma.tokenSequence.create({ data: { serviceId: service.id, branchId: branch.id, businessDate: new Date() }});
  }

  console.log('Creating a walk-in token...');
  const walkInToken = await prisma.token.create({
    data: {
      queueEntry: { connect: { id: walkInEntry.id } },
      sequence: { connect: { id: tokenSequence.id } },
      status: 'WAITING',
      businessDate: new Date(),
      sequenceNumber: 1000,
      displayNumber: 'T-1000',
    }
  });

  // Verify waitingTokens for the public display logic
  console.log('\n--- Checking Displays Public Snapshot Query ---');
  const waitingTokensDisplay = await prisma.token.findMany({
    where: { 
      status: 'WAITING', 
      queueEntry: { status: 'WAITING', service: { department: { branchId: branch.id } } } 
    },
  });
  
  const foundInDisplay = waitingTokensDisplay.some(t => t.id === walkInToken.id);
  console.log(`Walk-in Token found in display waitingTokens? ${foundInDisplay ? 'YES' : 'NO'}`);
  if (!foundInDisplay) throw new Error('Regression Failed: Token not found in display waitingTokens');

  // Verify Queue Allocation logic
  console.log('\n--- Checking Queue Allocation Query ---');
  const waitingTokensAlloc = await prisma.token.findMany({
    where: {
      status: 'WAITING',
      queueEntry: { service: { department: { branchId: branch.id } } }
    },
  });

  const foundInAlloc = waitingTokensAlloc.some(t => t.id === walkInToken.id);
  console.log(`Walk-in Token found in QueueAllocation waitingTokens? ${foundInAlloc ? 'YES' : 'NO'}`);
  if (!foundInAlloc) throw new Error('Regression Failed: Token not found in allocation waitingTokens');

  // Verify Queue Calling logic
  console.log('\n--- Checking Queue Calling Query ---');
  const scopedTokenCalling = await prisma.token.findFirst({
    where: { 
      id: walkInToken.id, 
      queueEntry: { service: { department: { branchId: branch.id, branch: { organizationId: tenant.organizationId } } } } 
    }
  });
  console.log(`Walk-in Token accessible for Queue Calling? ${scopedTokenCalling ? 'YES' : 'NO'}`);
  if (!scopedTokenCalling) throw new Error('Regression Failed: Token not found for queue calling');

  console.log('\n--- Branch Isolation Verification ---');
  const anotherBranch = await prisma.branch.create({
    data: {
      name: 'Test Branch B',
      organizationId: branch.organizationId,
    }
  });

  const deptB = await prisma.department.create({ data: { name: 'Dept B', branch: { connect: { id: anotherBranch.id } } }});
  const srvB = await prisma.service.create({ data: { name: 'Srv B', department: { connect: { id: deptB.id } } }});
  
  const entryB = await prisma.queueEntry.create({
    data: {
      // Walk-in
      service: { connect: { id: srvB.id } },
      priority: 'NORMAL',
      status: 'WAITING',
    }
  });

  const tokenSequenceB = await prisma.tokenSequence.create({ data: { serviceId: srvB.id, branchId: anotherBranch.id, businessDate: new Date() }});

  const tokenB = await prisma.token.create({
    data: {
      queueEntry: { connect: { id: entryB.id } },
      sequence: { connect: { id: tokenSequenceB.id } },
      status: 'WAITING',
      businessDate: new Date(),
      sequenceNumber: 2000,
      displayNumber: 'B-2000',
    }
  });

  const branchATokens = await prisma.token.findMany({
    where: {
      status: 'WAITING',
      queueEntry: { service: { department: { branchId: branch.id } } }
    }
  });
  
  const foundBInA = branchATokens.some(t => t.id === tokenB.id);
  console.log(`Token from Branch B leaked to Branch A? ${foundBInA ? 'YES' : 'NO (Expected)'}`);
  if (foundBInA) throw new Error('Regression Failed: Branch Isolation breached');

  // Clean up
  await prisma.token.delete({ where: { id: walkInToken.id } });
  await prisma.queueEntry.delete({ where: { id: walkInEntry.id } });
  await prisma.token.delete({ where: { id: tokenB.id } });
  await prisma.queueEntry.delete({ where: { id: entryB.id } });
  await prisma.tokenSequence.delete({ where: { id: tokenSequenceB.id } });
  await prisma.service.delete({ where: { id: srvB.id } });
  await prisma.department.delete({ where: { id: deptB.id } });
  await prisma.branch.delete({ where: { id: anotherBranch.id } });

  console.log('\nSUCCESS: All regression tests passed!');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
