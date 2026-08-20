import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { DisplayEventsService } from '../displays/display-events.service';
import { AuditAction, AuditResourceType, TokenStatus, QueueEntryStatus } from '@prisma/client';
import { getBusinessDate } from '../utils/date.util';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly displayEvents: DisplayEventsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cancelEndOfDayTokens() {
    // Disabled auto-cancellation for testing purposes
    // this.logger.log('Running cancelEndOfDayTokens job');
    return;
    
    try {
      const branches = await this.prisma.branch.findMany({
        where: { status: 'ACTIVE' },
        include: { organization: true },
      });

      for (const branch of branches) {
        const timezone = branch.organization.timezone || 'UTC';
        
        // Use Intl to format the date in the branch's timezone
        const formatterHour = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          hour12: false,
        });
        
        const localHourString = formatterHour.format(new Date());
        let localHour = parseInt(localHourString, 10);
        // Handle 24:00 which Intl might output instead of 0
        if (localHour === 24) localHour = 0;

        if (localHour >= 20) {
          // Create UTC midnight Date object representing the business date
          const businessDate = getBusinessDate(timezone);

          const tokensToCancel = await this.prisma.token.findMany({
            where: {
              sequence: { branchId: branch.id },
              businessDate,
              status: TokenStatus.WAITING,
            },
            select: { id: true, queueEntryId: true, displayNumber: true }
          });

          if (tokensToCancel.length > 0) {
            const tokenIds = tokensToCancel.map(t => t.id);
            const queueEntryIds = tokensToCancel.map(t => t.queueEntryId);

            await this.prisma.$transaction(async (tx) => {
              await tx.token.updateMany({
                where: { id: { in: tokenIds } },
                data: { status: TokenStatus.CANCELLED },
              });

              await tx.queueEntry.updateMany({
                where: { id: { in: queueEntryIds } },
                data: { status: QueueEntryStatus.CANCELLED, activeEntryKey: null },
              });
              
              const auditLogsData = tokensToCancel.map(token => ({
                organizationId: branch.organizationId,
                branchId: branch.id,
                action: AuditAction.TOKEN_CANCELLED,
                resourceType: AuditResourceType.TOKEN,
                resourceId: token.id,
                metadata: { 
                  reason: 'Automatically cancelled after business hours',
                  queueEntryId: token.queueEntryId,
                  displayNumber: token.displayNumber,
                  status: TokenStatus.CANCELLED,
                  businessDate: businessDate.toISOString()
                },
              }));

              await tx.auditLog.createMany({
                data: auditLogsData
              });
            });

            this.logger.log(`Automatically cancelled ${tokenIds.length} tokens for branch ${branch.id} at end of business day`);
            this.displayEvents.publish(branch.id, 'QUEUE_UPDATED');
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to run cancelEndOfDayTokens job', error);
    }
  }
}
