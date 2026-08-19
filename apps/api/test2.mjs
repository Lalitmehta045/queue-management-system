import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const queueEntry = await prisma.queueEntry.findFirst({ where: { status: 'WAITING' }, include: { service: { include: { department: true } } } });
  if (!queueEntry) { console.log('No waiting queue entry found'); return; }
  const branchId = queueEntry.service.department.branchId;
  console.log('Found queue entry:', queueEntry.id, 'for branch:', branchId);
  
  const res = await fetch(`http://localhost:4000/branches/${branchId}/queue-entries/${queueEntry.id}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' })
  });
  console.log(res.status);
  console.log(await res.text());
}
main().catch(console.error).finally(() => prisma.$disconnect());
