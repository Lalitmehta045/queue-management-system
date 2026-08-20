import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module';
import { TokensController } from '../apps/api/src/tokens/tokens.controller';
import { PrismaClient } from '@prisma/client';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const controller = app.get(TokensController);
  const prisma = new PrismaClient();
  
  const org = await prisma.organization.findFirst();
  const branch = await prisma.branch.findFirst({ where: { organizationId: org!.id } });
  const service = await prisma.service.findFirst({ where: { department: { branchId: branch!.id } } });

  const tenant = { organizationId: org!.id, role: 'ORG_ADMIN', userId: 'test', branchId: null } as any;
  const user = { userId: 'test' };
  const request = { ip: '127.0.0.1', headers: { 'user-agent': 'test' } } as any;

  const qe = await prisma.queueEntry.create({ data: { serviceId: service!.id, priority: 'SENIOR_CITIZEN', priorityWeight: 60 } });
  
  console.log('--- Calling controller.generate ---');
  const t = await controller.generate(tenant, user, request, branch!.id, qe.id, { type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' });
  
  console.log(`Token created via controller: ${t.displayNumber}, type: ${t.type}, counterId: ${t.counter?.id}`);
  
  await app.close();
}
main().catch(console.error);
