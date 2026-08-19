import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
  };
  tenant?: {
    organizationId: string;
    membershipId: string;
    role: string;
    branchId?: string | null;
  };
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    const organizationId = request.headers['x-organization-id'] || request.body.organizationId || request.query.organizationId || request.params.organizationId;

    if (!organizationId) {
      return true; // No tenant context requested, skip tenant authorization
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.userId,
          organizationId: organizationId,
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
