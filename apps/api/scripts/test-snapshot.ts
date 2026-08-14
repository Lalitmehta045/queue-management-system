const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { DisplaysService } = require('./src/displays/displays.service');
const { DisplayEventsService } = require('./src/displays/display-events.service');
const { EntitlementsService } = require('./src/entitlements/entitlements.service');

async function check() {
  const display = await prisma.display.findFirst({ where: { active: true } });
  if (!display) return console.log('no display');
  
  // mock displayEvents and entitlements
  const displaysService = new DisplaysService(prisma, {}, {});
  const snapshot = await displaysService.buildPublicSnapshot(display);
  
  let allIds = [];
  snapshot.counters.forEach(c => {
     console.log(`Counter ${c.code}:`);
     if (c.next) {
       console.log(`  NEXT: ${c.next.tokenLabel}`);
       // next token does not have ID in PublicToken, let's see.
     }
     c.waitingTokens.forEach(t => {
       console.log(`  WAIT: ${t.tokenLabel}`);
       allIds.push(t.tokenLabel); // We don't have IDs in PublicToken!
     });
  });
  
  console.log(`Total waiting in arrays: ${allIds.length}`);
  const uniqueLabels = new Set(allIds);
  console.log(`Unique labels: ${uniqueLabels.size}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
