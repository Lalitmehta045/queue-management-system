const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.findFirst();
  if (!branch) {
    console.log('No branch found');
    return;
  }
  
  // 1. Get all active counters
  const counters = await prisma.counter.findMany({
    where: { branchId: branch.id, status: 'ACTIVE' },
    select: { id: true, code: true, tokenType: true }
  });

  console.log(`\n--- ACTIVE COUNTERS ---`);
  console.log(counters.map(c => `${c.code} (${c.tokenType})`).join(', '));

  // 2. Fetch waiting tokens
  const waitingTokens = await prisma.token.findMany({
    where: { 
      status: 'WAITING', 
      queueEntry: { service: { department: { branchId: branch.id } } }
    },
    select: {
      id: true,
      displayNumber: true,
      sequenceNumber: true,
      type: true,
      counter: { select: { code: true, tokenType: true } },
    },
    orderBy: [
      { queueEntry: { priorityWeight: 'desc' } },
      { sequenceNumber: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' }
    ]
  });

  console.log(`\n--- WAITING TOKENS (CANONICAL ORDER) ---`);
  waitingTokens.forEach(t => {
    console.log(`${t.displayNumber} (Seq: ${t.sequenceNumber}, Type: ${t.type}) -> Counter: ${t.counter?.code} (${t.counter?.tokenType})`);
  });

  // Verify next tokens logic matching displays.service.ts
  console.log(`\n--- NEXT TOKENS PER COUNTER ---`);
  for (const c of counters) {
    const counterTokens = waitingTokens.filter(t => t.counter?.code === c.code);
    if (counterTokens.length > 0) {
      console.log(`Counter ${c.code}: NEXT = ${counterTokens[0].displayNumber}`);
      
      // Verification check!
      // Is next token's sequence number the minimum among all tokens assigned to this counter?
      const minSeq = Math.min(...counterTokens.map(t => t.sequenceNumber));
      if (counterTokens[0].sequenceNumber !== minSeq) {
         console.error(`ERROR! Counter ${c.code} NEXT token ${counterTokens[0].displayNumber} sequence is ${counterTokens[0].sequenceNumber}, but min sequence is ${minSeq}`);
      }
    } else {
      console.log(`Counter ${c.code}: NEXT = NONE`);
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
