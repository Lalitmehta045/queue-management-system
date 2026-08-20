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

}
