import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module';
import { TokensService } from '../apps/api/src/tokens/tokens.service';
import { PrismaService } from '../apps/api/src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tokensService = app.get(TokensService);
  const prisma = app.get(PrismaService);

  const org = await prisma.organization.findFirst();
  const branch = await prisma.branch.findFirst({ where: { organizationId: org!.id } });
  const service = await prisma.service.findFirst({ where: { department: { branchId: branch!.id } } });

  const tenant = { organizationId: org!.id, role: 'ORG_ADMIN', userId: 'test', branchId: null } as any;

  // Reset sequence
  await tokensService.resetTokenSequence(tenant, branch!.id);

  const qe = await prisma.queueEntry.create({ data: { serviceId: service!.id, priority: 'SENIOR_CITIZEN', priorityWeight: 60 } });
  const t = await tokensService.generate(tenant, branch!.id, qe.id, { type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' } as any);
  
  console.log(`Token created: ${t.displayNumber}, type: ${t.type}`);
  
  await app.close();
}
main().catch(console.error);
