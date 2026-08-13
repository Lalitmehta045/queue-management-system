import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Role, TokenStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Injectable()
export class TicketPrintService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns a safe printable ticket. Patient name, phone, email, and all other
   * sensitive fields are intentionally excluded.
   */
  async getPrintTicket(tenant: Tenant, userId: string, branchId: string, tokenId: string) {
    const branch = await this.authorizeBranch(tenant, branchId);
    if (!isUUID(tokenId)) throw new NotFoundException('Token not found');

    const token = await this.prisma.token.findFirst({
      where: {
        id: tokenId,
        queueEntry: {
          service: { department: { branchId, branch: { organizationId: tenant.organizationId } } },
        },
      },
      select: {
        displayNumber: true,
        businessDate: true,
        issuedAt: true,
        status: true,
        counterId: true,
        counter: { select: { name: true, code: true } },
        queueEntry: {
          select: {
            service: { select: { name: true, department: { select: { name: true } } } },
          },
        },
      },
    });
    if (!token) throw new NotFoundException('Token not found');

    if (tenant.role === Role.COUNTER_OPERATOR) {
      if (
        token.counterId === null ||
        !(token.status === TokenStatus.CALLED || token.status === TokenStatus.SERVING)
      ) {
        throw new ForbiddenException('Operators can only print the active token of their assigned counter');
      }
      const assignment = await this.prisma.counterAssignment.findFirst({
        where: {
          counterId: token.counterId,
          userId,
          user: {
            memberships: {
              some: {
                userId,
                organizationId: tenant.organizationId,
                branchId,
                role: Role.COUNTER_OPERATOR,
                status: MembershipStatus.ACTIVE,
              },
            },
          },
        },
        select: { id: true },
      });
      if (!assignment) throw new ForbiddenException('Operator is not assigned to this counter');
    }

    return {
      organization: { name: branch.organization.name },
      branch: { name: branch.name, code: branch.code },
      token: {
        displayNumber: token.displayNumber,
        businessDate: token.businessDate.toISOString().slice(0, 10),
        issuedAt: token.issuedAt.toISOString(),
        status: token.status,
      },
      department: { name: token.queueEntry.service.department.name },
      service: { name: token.queueEntry.service.name },
      counter: token.counterId && token.counter ? { name: token.counter.name, code: token.counter.code } : null,
      printedAt: new Date().toISOString(),
    };
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) {
      throw new ForbiddenException('You do not have access to this branch');
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: tenant.organizationId },
      select: { name: true, code: true, organization: { select: { name: true } } },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }
}
