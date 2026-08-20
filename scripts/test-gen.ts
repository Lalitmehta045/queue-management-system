import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module';
import { TokensController } from '../apps/api/src/tokens/tokens.controller';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirst();
  const branch = await prisma.branch.findFirst({ where: { organizationId: org!.id } });
  const service = await prisma.service.findFirst({ where: { department: { branchId: branch!.id } } });

  // Clear sequences
  await prisma.tokenSequence.deleteMany({});
  await prisma.token.deleteMany({});
  await prisma.queueEntry.deleteMany({});

  const app = await NestFactory.createApplicationContext(AppModule);
  const controller = app.get(TokensController);

  const tenant = { organizationId: org!.id, role: 'ORG_ADMIN', userId: 'test', branchId: null } as any;
  const user = { userId: 'test' };
  const request = { ip: '127.0.0.1', headers: { 'user-agent': 'test' } } as any;

  console.log('Generating 3 NORMAL tokens...');
  for (let i = 0; i < 3; i++) {
    const qe = await prisma.queueEntry.create({ data: { serviceId: service!.id, priority: 'NORMAL', priorityWeight: 0 } });
    const t = await controller.generate(tenant, user, request, branch!.id, qe.id, { type: 'NORMAL' });
    console.log(`NORMAL Token: ${t.displayNumber}`);
  }

  console.log('Generating 1 SPECIAL token...');
  const qeSpec = await prisma.queueEntry.create({ data: { serviceId: service!.id, priority: 'SENIOR_CITIZEN', priorityWeight: 60 } });
  const tSpec = await controller.generate(tenant, user, request, branch!.id, qeSpec.id, { type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' });
  console.log(`SPECIAL Token: ${tSpec.displayNumber}`);

  await app.close();
}
main().catch(console.error);
