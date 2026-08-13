import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  console.log('--- TOKEN GENERATION TRACE ---');
  
  // 1. Find the latest token
  const token = await prisma.token.findFirst({
    orderBy: { createdAt: 'desc' },
    include: {
      queueEntry: {
        include: {
          service: {
            include: {
              department: true
            }
          }
        }
      }
    }
  });

  if (!token) {
    console.log('No token found in database.');
    return;
  }

  console.log('TOKEN IN DATABASE: YES');
  console.log({
    id: token.id,
    tokenLabel: token.tokenLabel,
    status: token.status,
    counterId: token.counterId,
    queueEntryId: token.queueEntryId,
    patientId: token.queueEntry?.patientId,
    serviceId: token.queueEntry?.serviceId,
    departmentId: token.queueEntry?.service?.departmentId,
    branchId: token.queueEntry?.service?.department?.branchId
  });

  if (token.counterId) {
    console.log(`COUNTER ALLOCATION: ASSIGNED (${token.counterId})`);
  } else {
    console.log('COUNTER ALLOCATION: NULL');
    console.log('Reason: QueueAllocationService failed to assign or ignored it.');
  }

  const branchId = token.queueEntry?.service?.department?.branchId;
  
  console.log('\n--- PUBLIC DISPLAY TRACE ---');
  // 5. Trace buildPublicSnapshot for the branch
  const display = await prisma.display.findFirst({ where: { branchId } });
  
  if (!display) {
    console.log('No display found for branch:', branchId);
    return;
  }
  
  console.log('displayId:', display.id);
  console.log('display.branchId:', display.branchId);

  const branchCounters = await prisma.counter.findMany({
    where: { branchId: display.branchId, status: 'ACTIVE' },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
  console.log('Active counters:', branchCounters.map(c => c.code).join(', '));

  console.log('\nQuerying waitingTokens exactly as buildPublicSnapshot does...');
  const waitingTokens = await prisma.token.findMany({
    where: { 
      status: 'WAITING', 
      counterId: { not: null }, 
      queueEntry: { status: 'WAITING', service: { department: { branchId: display.branchId } } } 
    },
    orderBy: [{ queueEntry: { priorityWeight: 'desc' } }, { businessDate: 'asc' }, { sequenceNumber: 'asc' }, { id: 'asc' }],
    include: { queueEntry: { include: { service: true, patient: true } } }
  });

  console.log(`waitingTokens count: ${waitingTokens.length}`);
  waitingTokens.forEach(t => {
    console.log(`- ${t.tokenLabel} (id: ${t.id}, counterId: ${t.counterId})`);
  });

  if (waitingTokens.find(t => t.id === token.id)) {
    console.log('DISPLAY API: RETURNS TOKEN');
  } else {
    console.log('DISPLAY API: DOES NOT RETURN TOKEN');
    
    // Why?
    if (!token.counterId) {
      console.log('Reason: token has counterId = null, but waitingTokens query requires counterId: { not: null }');
    } else if (token.status !== 'WAITING') {
      console.log('Reason: token status is not WAITING');
    } else if (token.queueEntry?.status !== 'WAITING') {
      console.log('Reason: queueEntry status is not WAITING');
    }
  }

  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
