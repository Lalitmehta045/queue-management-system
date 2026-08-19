const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.tokenSequence.findMany({ select: { businessDate: true } }).then(res => console.log(new Set(res.map(s => s.businessDate.toISOString())))).finally(() => prisma.$disconnect());
