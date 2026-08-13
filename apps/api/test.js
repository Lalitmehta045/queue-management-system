const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const q = await prisma.queueEntry.findFirst({ where: { patientId: null }, orderBy: { createdAt: 'desc' } });
  console.log('Latest anon QueueEntry:', q);
  if (!q) return;

  const branchId = '05468487-1c3e-4eb3-aee9-07131ca1a344';
  
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  console.log('Branch orgId:', branch.organizationId);
  const orgId = branch.organizationId;
  
  const findFirstResult = await prisma.queueEntry.findFirst({
    where: {
      id: q.id,
      status: 'WAITING',
      OR: [
        { patientId: null },
        { patient: { branchId, status: 'ACTIVE', branch: { organizationId: orgId } } },
      ],
      service: { status: 'ACTIVE', department: { branchId, branch: { organizationId: orgId } } },
    }
  });
  console.log('findFirst result:', !!findFirstResult);
  
  const lockedEntries = await prisma.$queryRaw`
    SELECT q.id FROM "QueueEntry" q
    INNER JOIN "Service" s ON q."serviceId" = s.id
    INNER JOIN "Department" d ON s."departmentId" = d.id
    INNER JOIN "Branch" b ON d."branchId" = b.id
    WHERE q.id = ${q.id}::uuid
      AND d."branchId" = ${branchId}::uuid
      AND b."organizationId" = ${orgId}::uuid
  `;
  console.log('lockedEntries length:', lockedEntries.length);
})();
