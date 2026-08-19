import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenant = request.tenant;

    if (!tenant) {
      throw new ForbiddenException('Tenant context is required for role authorization');
    }

    if (tenant.role === Role.SUPER_ADMIN) {
        return true;
    }

    if (!requiredRoles.includes(tenant.role)) {
      throw new ForbiddenException('Insufficient role for this resource');
    }

    return true;
  }
}
