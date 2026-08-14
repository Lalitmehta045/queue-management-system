import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueAllocationService } from '../src/queue-calling/queue-allocation.service';
import { DisplayEventsService } from '../src/displays/display-events.service';
import { isUUID } from 'class-validator';

async function bootstrap() {
  const branchId = process.argv[2];
  const confirmFlag = process.argv[3];

  if (!branchId || !isUUID(branchId)) {
    console.error('Usage: npx tsx scripts/backfill-unassigned-tokens.ts <BRANCH_ID> [--confirm]');
    console.error('Please provide a valid branch ID (UUID).');
    process.exit(1);
  }

  const isConfirm = confirmFlag === '--confirm';

  console.log(`Initializing NestJS Application Context...`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const prisma = app.get(PrismaService);
  const queueAllocation = app.get(QueueAllocationService);
  const displayEvents = app.get(DisplayEventsService);

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { name: true }
  });

  if (!branch) {
    console.error(`Branch with ID ${branchId} not found.`);
    await app.close();
    process.exit(1);
  }

  console.log(`\nBranch: ${branch.name}`);

  try {
    if (!isConfirm) {
      console.log(`\n--- PREVIEW MODE (No database changes will be made) ---\n`);
      
      const result = await queueAllocation.backfillUnassignedWaitingTokens(prisma, branchId, true);
      
      console.log(`Active counters:`);
      if (result.counters.length === 0) {
        console.log(`  (None)`);
      } else {
        result.counters.forEach((c: any) => console.log(`  ${c.name} (${c.code})`));
      }

      console.log(`\nUnassigned WAITING tokens:`);
      if (result.unassignedTokens.length === 0) {
        console.log(`  (None)`);
      } else {
        result.unassignedTokens.forEach((t: any) => console.log(`  ${t.displayNumber}`));
      }

      console.log(`\nWould assign ${result.wouldAssign} tokens to ${result.counters.length} active counters.`);
      console.log(`Run with --confirm to execute the backfill.`);

    } else {
      console.log(`\n--- EXECUTING BACKFILL ---\n`);

      const result = await prisma.$transaction(async (tx) => {
        return queueAllocation.backfillUnassignedWaitingTokens(tx as any, branchId, false);
      });

      if (result.totalAssigned > 0) {
        console.log(`Backfill completed successfully.\n`);
        
        Object.entries(result.summary).forEach(([counterStr, count]) => {
          console.log(`${counterStr}: ${count} tokens`);
        });

        console.log(`\nTotal assigned: ${result.totalAssigned}`);
        if (result.skippedAssigned > 0) {
          console.log(`Skipped (assigned concurrently): ${result.skippedAssigned}`);
        }

        // Publish event to display
        displayEvents.publish(branchId, 'QUEUE_UPDATED');
        console.log(`\nPublished QUEUE_UPDATED event to refresh displays.`);
      } else {
        console.log(`No unassigned waiting tokens found.`);
        console.log(`No database changes made.`);
      }
    }
  } catch (error) {
    console.error('Error executing backfill:', error);
  } finally {
    await app.close();
  }
}

bootstrap();
