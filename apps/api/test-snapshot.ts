import { PrismaClient } from '@prisma/client';
import { DisplaysService } from './src/displays/displays.service';

const prisma = new PrismaClient();
const displaysService = new DisplaysService(prisma, {} as any, {} as any);

async function run() {
  const branch = await prisma.branch.findFirst();
  if (!branch) return;

  const display = await prisma.display.findFirst({ where: { branchId: branch.id } });
  if (!display) return;

  const snapshot = await (displaysService as any).buildPublicSnapshot(display);
  console.log(JSON.stringify(snapshot, null, 2));

  process.exit(0);
}

run();
