import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthenticatedRequest extends Request {
  user?: { userId: string; sessionId: string };
  tenant?: { organizationId: string; membershipId: string; role: Role; branchId: string | null };
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    const organizationHeader = request.headers['x-organization-id'];
    const organizationId = Array.isArray(organizationHeader)
      ? organizationHeader[0]
      : organizationHeader;

    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.userId,
          organizationId,
        },
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('You do not have active membership in this organization');
    }

    request.tenant = {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
      branchId: membership.branchId,
    };

    return true;
  }
}
