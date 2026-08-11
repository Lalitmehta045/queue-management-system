import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { AuditContext } from './audit.service';

export function getAuditContext(
  tenant: NonNullable<AuthenticatedRequest['tenant']>,
  user: { userId: string },
  request: AuthenticatedRequest,
): AuditContext {
  const rawUserAgent = request.headers['user-agent'];
  const userAgent = typeof rawUserAgent === 'string' ? rawUserAgent : Array.isArray(rawUserAgent) ? rawUserAgent[0] : null;
  return {
    organizationId: tenant.organizationId,
    branchId: tenant.branchId,
    actorUserId: user.userId,
    ipAddress: request.ip,
    userAgent,
  };
}
