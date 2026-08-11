import { Injectable, NotFoundException, HttpException, HttpStatus, MessageEvent } from '@nestjs/common';
import { TokenStatus, QueueEntryStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { FEATURES } from '../entitlements/features';
import { DisplayEventsService } from '../displays/display-events.service';

@Injectable()
export class PublicQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly displayEvents: DisplayEventsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private readonly activeSubscriptions = new Map<string, number>();

  async getPublicTokenStatus(publicTokenId: string) {
    if (!isUUID(publicTokenId)) {
      throw new NotFoundException('Token not found');
    }

    const token = await this.prisma.token.findUnique({
      where: { id: publicTokenId },
      select: {
        id: true,
        displayNumber: true,
        status: true,
        businessDate: true,
        sequenceNumber: true,
        issuedAt: true,
        queueEntry: {
          select: {
            serviceId: true,
            priorityWeight: true,
            service: {
              select: {
                name: true,
                department: { select: { name: true, branchId: true } }
              }
            }
          }
        }
      }
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: token.queueEntry.service.department.branchId },
      select: { organizationId: true },
    });
    if (!branch) throw new NotFoundException('Token not found');
    await this.entitlements.requireFeature(branch.organizationId, FEATURES.QR_STATUS);

    let peopleAhead = 0;
    let estimatedWaitMinutes: number | null = null;
    let currentServingTokenLabel: string | null = null;

    // Get current serving token for this service
    const currentServing = await this.prisma.token.findFirst({
      where: {
        status: { in: [TokenStatus.CALLED, TokenStatus.SERVING] },
        queueEntry: { serviceId: token.queueEntry.serviceId },
        counterId: { not: null }
      },
      orderBy: [{ calledAt: 'desc' }],
      select: { displayNumber: true }
    });
    if (currentServing) {
      currentServingTokenLabel = currentServing.displayNumber;
    }

    if (token.status === TokenStatus.WAITING) {
      const starvationThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
      const isStarved = token.issuedAt < starvationThreshold;

      if (isStarved) {
        peopleAhead = await this.prisma.token.count({
          where: {
            status: TokenStatus.WAITING,
            queueEntry: { serviceId: token.queueEntry.serviceId, status: QueueEntryStatus.WAITING },
            issuedAt: { lt: starvationThreshold },
            OR: [
              { businessDate: { lt: token.businessDate } },
              { businessDate: token.businessDate, sequenceNumber: { lt: token.sequenceNumber } },
              { businessDate: token.businessDate, sequenceNumber: token.sequenceNumber, id: { lt: token.id } }
            ]
          }
        });
      } else {
        peopleAhead = await this.prisma.token.count({
          where: {
            status: TokenStatus.WAITING,
            counterId: null,
            queueEntry: { serviceId: token.queueEntry.serviceId, status: QueueEntryStatus.WAITING },
            OR: [
              { issuedAt: { lt: starvationThreshold } },
              {
                issuedAt: { gte: starvationThreshold },
                queueEntry: {
                  serviceId: token.queueEntry.serviceId,
                  status: QueueEntryStatus.WAITING,
                  priorityWeight: { gt: token.queueEntry.priorityWeight }
                }
              },
              {
                issuedAt: { gte: starvationThreshold },
                queueEntry: {
                  serviceId: token.queueEntry.serviceId,
                  status: QueueEntryStatus.WAITING,
                  priorityWeight: token.queueEntry.priorityWeight
                },
                OR: [
                  { businessDate: { lt: token.businessDate } },
                  { businessDate: token.businessDate, sequenceNumber: { lt: token.sequenceNumber } },
                  { businessDate: token.businessDate, sequenceNumber: token.sequenceNumber, id: { lt: token.id } }
                ]
              }
            ]
          }
        });
      }

      // Calculate estimate
      const timeAverages = await this.prisma.$queryRawUnsafe<Array<{ avgServiceSeconds: number | null }>>(`
        SELECT AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."servingAt")))::double precision as "avgServiceSeconds"
        FROM "Token" t
        JOIN "QueueEntry" qe ON t."queueEntryId" = qe.id
        WHERE qe."serviceId" = $1::uuid
          AND t."status" = 'COMPLETED'
          AND t."servingAt" IS NOT NULL
          AND t."completedAt" IS NOT NULL
      `, token.queueEntry.serviceId);

      const avgServiceSeconds = timeAverages[0]?.avgServiceSeconds;
      if (avgServiceSeconds && avgServiceSeconds > 0) {
        estimatedWaitMinutes = Math.max(1, Math.ceil((peopleAhead * avgServiceSeconds) / 60));
      }
    }

    return {
      tokenLabel: token.displayNumber,
      status: token.status,
      serviceName: token.queueEntry.service.name,
      departmentName: token.queueEntry.service.department.name,
      businessDate: token.businessDate.toISOString().split('T')[0],
      currentServingToken: currentServingTokenLabel,
      peopleAhead: token.status === TokenStatus.WAITING ? peopleAhead : null,
      estimatedWaitMinutes,
      lastUpdated: new Date().toISOString()
    };
  }

  async streamPublicTokenEvents(publicTokenId: string) {
    if (!isUUID(publicTokenId)) {
      throw new NotFoundException('Token not found');
    }

    const token = await this.prisma.token.findUnique({
      where: { id: publicTokenId },
      select: { queueEntry: { select: { service: { select: { department: { select: { branchId: true } } } } } } }
    });

    if (!token) {
      throw new NotFoundException('Token not found');
    }

    const branchId = token.queueEntry.service.department.branchId;
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { organizationId: true },
    });
    if (!branch) throw new NotFoundException('Token not found');
    await this.entitlements.requireFeature(branch.organizationId, FEATURES.QR_STATUS);

    const currentSubs = this.activeSubscriptions.get(publicTokenId) || 0;
    if (currentSubs >= 5) {
      throw new HttpException('Too many active connections for this token', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.activeSubscriptions.set(publicTokenId, currentSubs + 1);

    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      
      const sendSnapshot = (eventType: string) => {
        void this.getPublicTokenStatus(publicTokenId)
          .then((snapshot) => {
            if (!closed) subscriber.next({ type: eventType, data: snapshot });
          })
          .catch((error: unknown) => {
            if (!closed) subscriber.error(error);
          });
      };

      sendSnapshot('QUEUE_UPDATED');
      const unsubscribe = this.displayEvents.subscribe(branchId, sendSnapshot);
      
      const heartbeat = setInterval(() => {
        if (!closed) subscriber.next({ type: 'KEEPALIVE', data: { updatedAt: new Date().toISOString() } });
      }, 25_000);

      const boundedLifecycle = setTimeout(() => {
        if (!closed) subscriber.complete();
      }, 12 * 60 * 60 * 1000);

      return () => {
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(boundedLifecycle);
        unsubscribe();
        const subs = this.activeSubscriptions.get(publicTokenId) || 1;
        this.activeSubscriptions.set(publicTokenId, Math.max(0, subs - 1));
      };
    });
  }
}
