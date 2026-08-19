import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Role, MembershipStatus, OrganizationStatus } from '@prisma/client';
import { QueueAllocationService } from '../queue-calling/queue-allocation.service';
import { DisplayEventsService } from '../displays/display-events.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private queueAllocation: QueueAllocationService,
    private displayEvents: DisplayEventsService,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName,
        },
      });

      const slug = dto.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + crypto.randomBytes(4).toString('hex');

      const organization = await tx.organization.create({
        data: {
          name: dto.displayName + "'s Organization",
          slug,
          status: OrganizationStatus.ACTIVE,
        },
      });

      await tx.membership.create({
        data: {
          userId: newUser.id,
          organizationId: organization.id,
          role: Role.ORG_ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      });

      return newUser;
    });

    return this.createTokens(user.id, null);
  }

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const result = await this.createTokens(user.id, { userAgent, ipAddress });

    // After login, check if this user is a COUNTER_OPERATOR with counter assignments.
    // If so, their counter is now ONLINE — backfill unassigned WAITING tokens.
    void this.onOperatorLogin(user.id).catch((err: unknown) => {
      this.logger.error('Failed to backfill tokens on operator login', err instanceof Error ? err.stack : err);
    });

    return result;
  }

  async logout(sessionId: string) {
    // Find the session to know which user is logging out, before revoking
    const session = await this.prisma.refreshSession.findFirst({
      where: { id: sessionId },
      select: { userId: true },
    });

    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    // Publish QUEUE_UPDATED for branches where this operator has counter assignments
    // so public displays stop showing this counter as available.
    if (session) {
      void this.onOperatorLogout(session.userId).catch((err: unknown) => {
        this.logger.error('Failed to handle operator logout', err instanceof Error ? err.stack : err);
      });
    }
  }

  async refresh(refreshToken: string, userAgent?: string, ipAddress?: string) {
    const tokenHash = this.hashToken(refreshToken);
    
    const session = await this.prisma.refreshSession.findFirst({
      where: { tokenHash },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      // Refresh token reuse detected!
      // Revoke ALL sessions for this user as a security measure
      await this.prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Token reuse detected');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke old session
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.createTokens(session.userId, { userAgent, ipAddress });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
        memberships: {
          include: {
            organization: true,
          }
        }
      }
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }

  private async createTokens(userId: string, context: { userAgent?: string | undefined, ipAddress?: string | undefined } | null) {
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const session = await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        userAgent: context?.userAgent ?? null,
        ipAddress: context?.ipAddress ?? null,
      },
    });

    const accessToken = this.jwtService.sign(
      { sub: userId, sessionId: session.id },
      { expiresIn: '15m' }
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 15 * 60, // 15 mins
    };
  }

  /**
   * Called after a successful login. If the user is a COUNTER_OPERATOR with
   * counter assignments, backfill unassigned WAITING tokens to their counter(s)
   * and publish QUEUE_UPDATED so displays update immediately.
   */
  private async onOperatorLogin(userId: string): Promise<void> {
    const assignments = await this.prisma.counterAssignment.findMany({
      where: { userId },
      select: {
        counter: {
          select: { branchId: true },
        },
      },
    });

    if (!assignments.length) return;

    // Deduplicate branch IDs
    const branchIds = [...new Set(assignments.map((a) => a.counter.branchId))];

    for (const branchId of branchIds) {
      await this.prisma.$transaction(async (tx) => {
        await this.queueAllocation.backfillUnassignedWaitingTokens(tx, branchId);
      });
      this.displayEvents.publish(branchId, 'QUEUE_UPDATED');
      this.logger.log(`Operator ${userId} login: backfilled tokens for branch ${branchId}`);
    }
  }

  /**
   * Called after a successful logout. Publishes QUEUE_UPDATED for all branches
   * where the operator has counter assignments, so displays stop showing the
   * now-offline counter as receiving tokens.
   */
  private async onOperatorLogout(userId: string): Promise<void> {
    const assignments = await this.prisma.counterAssignment.findMany({
      where: { userId },
      select: {
        counter: {
          select: { branchId: true },
        },
      },
    });

    if (!assignments.length) return;

    const branchIds = [...new Set(assignments.map((a) => a.counter.branchId))];

    for (const branchId of branchIds) {
      this.displayEvents.publish(branchId, 'QUEUE_UPDATED');
      this.logger.log(`Operator ${userId} logout: published QUEUE_UPDATED for branch ${branchId}`);
    }
  }
}
