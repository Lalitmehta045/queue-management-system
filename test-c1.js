const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const display = await prisma.display.findFirst({
    where: { active: true },
    include: { branch: true }
  });
  console.log("Display ID:", display.publicId);
  const branchId = display.branchId;

  // Find C1
  const c1 = await prisma.counter.findFirst({
    where: { branchId, code: 'C1' }
  });
  
  // Assign T-001, T-005, T-009, T-002 to C1
  const tokens = await prisma.token.findMany({
    where: { displayNumber: { in: ['T-001', 'T-005', 'T-009', 'T-002'] }, status: 'WAITING', counterId: { not: null } }
  });
  
  if (tokens.length > 0) {
    for (const t of tokens) {
      await prisma.token.update({
        where: { id: t.id },
        data: { counterId: c1.id }
      });
      // sleep 100ms
      await new Promise(r => setTimeout(r, 100));
    }
  }

  const res = await fetch(`http://localhost:4000/public/displays/${display.publicId}/events`);
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  
  const events = text.split('\n\n').filter(Boolean);
  for (const event of events) {
    if (event.startsWith('data: ')) {
      const data = JSON.parse(event.slice(6));
      const c1Data = data.data.counters.find(c => c.code === 'C1');
      console.log('NEXT:', c1Data.next?.tokenLabel);
      console.log('WAITING:', c1Data.waitingTokens.map(t => t.tokenLabel).join(', '));
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
