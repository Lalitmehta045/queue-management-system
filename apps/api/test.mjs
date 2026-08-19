import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const branch = await prisma.branch.findFirst();
  const queueEntry = await prisma.queueEntry.findFirst({ where: { status: 'WAITING' }, include: { service: true } });
  if (!queueEntry) { console.log('No waiting queue entry found'); return; }
  console.log('Found queue entry:', queueEntry.id);
  
  const res = await fetch(`http://localhost:4000/branches/${branch.id}/queue-entries/${queueEntry.id}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' })
  });
  console.log(res.status);
  console.log(await res.text());
}
main().catch(console.error).finally(() => prisma.$disconnect());
