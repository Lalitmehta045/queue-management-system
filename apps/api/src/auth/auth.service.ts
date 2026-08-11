import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuditAction, Prisma, Role, MembershipStatus, OrganizationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private audit: AuditService,
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

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
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
          userId: user.id,
          organizationId: organization.id,
          role: Role.ORG_ADMIN,
          status: MembershipStatus.ACTIVE,
        },
      });

      return this.createTokens(user.id, null, tx);
    });
  }

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.auditForUser(user.id, AuditAction.AUTH_LOGIN_FAILED, { reason: 'INVALID_CREDENTIALS', knownUser: true }, { ipAddress: ipAddress ?? null, userAgent: userAgent ?? null });
      throw new UnauthorizedException('Invalid credentials');
    }

    const context: { userAgent?: string; ipAddress?: string } = {};
    if (userAgent) context.userAgent = userAgent;
    if (ipAddress) context.ipAddress = ipAddress;
    const tokens = await this.createTokens(user.id, context);
    await this.auditForUser(user.id, AuditAction.AUTH_LOGIN, { knownUser: true }, { actorUserId: user.id, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null });
    return tokens;
  }

  async logout(sessionId: string, userAgent?: string, ipAddress?: string) {
    const session = await this.prisma.refreshSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    if (session) {
      await this.auditForUser(session.userId, AuditAction.AUTH_LOGOUT, {}, { actorUserId: session.userId, ipAddress: ipAddress ?? null, userAgent: userAgent ?? null });
    }
  }

  async refresh(refreshToken: string, userAgent?: string, ipAddress?: string) {
    const tokenHash = this.hashToken(refreshToken);
    
    // Atomically attempt to revoke the token if it is currently active
    const updateResult = await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    
    const session = await this.prisma.refreshSession.findFirst({
      where: { tokenHash },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (updateResult.count === 0) {
      // If count is 0, the token was ALREADY revoked by another process or earlier.
      // This is a definitive token reuse scenario.
      // Revoke ALL sessions for this user as a security measure.
      await this.prisma.refreshSession.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Token reuse detected');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const context: { userAgent?: string; ipAddress?: string } = {};
    if (userAgent) context.userAgent = userAgent;
    if (ipAddress) context.ipAddress = ipAddress;
    return this.createTokens(session.userId, context);
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

  private async createTokens(
    userId: string,
    context: { userAgent?: string, ipAddress?: string } | null,
    prisma: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const session = await prisma.refreshSession.create({
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

  private async auditForUser(
    userId: string,
    action: AuditAction,
    metadata: Record<string, unknown>,
    context: { actorUserId?: string | null; ipAddress?: string | null; userAgent?: string | null },
  ) {
    try {
      await this.audit.recordForActiveMemberships(userId, action, metadata, context);
    } catch {
      // Audit membership lookup must not change authentication semantics.
    }
  }
}
