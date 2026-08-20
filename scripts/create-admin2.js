const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const email = 'admin2@example.com';
  const passwordHash = await bcrypt.hash('Admin@1234', 10);
  const existing = await prisma.user.findUnique({where: {email}});
  
  if (existing) {
    console.log('Exists');
    return;
  }
  
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: 'Admin 2'
    }
  });
  
  const org = await prisma.organization.create({
    data: {
      name: 'Admin 2 Org',
      slug: crypto.randomBytes(6).toString('hex'),
      status: 'ACTIVE'
    }
  });
  
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: 'ORG_ADMIN',
      status: 'ACTIVE'
    }
  });
  console.log('Created admin2');
}

main().catch(console.error).finally(()=>prisma.$disconnect());
