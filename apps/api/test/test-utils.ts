import { PrismaService } from '../src/prisma/prisma.service';

export async function clearDatabase(prisma: PrismaService) {
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.notificationSetting.deleteMany({});
  await prisma.printJob.deleteMany({});
  await prisma.token.deleteMany({});
  await prisma.tokenSequence.deleteMany({});
  await prisma.queueEntry.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.patient.deleteMany({});
  await prisma.counterAssignment.deleteMany({});
  await prisma.display.deleteMany({});
  await prisma.counter.deleteMany({});
  await prisma.printer.deleteMany({});
  await prisma.service.deleteMany({});
  await prisma.priorityConfiguration.deleteMany({});
  await prisma.organizationSubscription.deleteMany({});
  await prisma.subscriptionPlan.deleteMany({});
  await prisma.department.deleteMany({});
  await prisma.branchWorkingHours.deleteMany({});
  await prisma.membership.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.organization.deleteMany({});
  await prisma.refreshSession.deleteMany({});
  await prisma.user.deleteMany({});
}
