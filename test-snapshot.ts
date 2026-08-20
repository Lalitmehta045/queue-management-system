import { Test, TestingModule } from '@nestjs/testing';
import { DisplaysService } from './apps/api/src/displays/displays.service';
import { PrismaService } from './apps/api/src/prisma/prisma.service';
import { DisplayEventsService } from './apps/api/src/displays/display-events.service';
import { NotificationsService } from './apps/api/src/notifications/notifications.service';
import { EntitlementsService } from './apps/api/src/entitlements/entitlements.service';

async function main() {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    providers: [
      DisplaysService,
      PrismaService,
      { provide: DisplayEventsService, useValue: { subscribe: () => {}, publish: () => {} } },
      { provide: NotificationsService, useValue: { onAnnouncement: () => {} } },
      { provide: EntitlementsService, useValue: {} },
    ],
  }).compile();

  const service = moduleFixture.get<DisplaysService>(DisplaysService);
  const publicId = '42c115a410479750e1d1d188e495cedf6d49c85d70f0aa75';
  
  const snapshot = await service.getPublicSnapshot(publicId, 'test-ip');
  console.log('Snapshot counters length:', snapshot.counters.length);
  for (const c of snapshot.counters) {
    console.log(`- ${c.code} (${c.tokenType})`);
  }
}
main().catch(console.error);
