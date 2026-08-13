import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CounterStatus, MembershipStatus, Prisma, Role } from '@prisma/client';
import { isUUID } from 'class-validator';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTeamMemberDto } from './dto/create-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

const MANAGEABLE_STAFF_ROLES = new Set<Role>([
  Role.BRANCH_ADMIN,
  Role.RECEPTIONIST,
  Role.COUNTER_OPERATOR,
  Role.DISPLAY_OPERATOR,
  Role.DOCTOR,
]);

const memberSelect = {
  id: true,
  organizationId: true,
  userId: true,
  branchId: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, name: true, code: true, status: true } },
  user: {
    select: {
      id: true,
      email: true,
      displayName: true,
      createdAt: true,
      updatedAt: true,
      counterAssignments: {
        select: {
          id: true,
          counterId: true,
          counter: { select: { id: true, branchId: true, name: true, code: true, status: true } },
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
} satisfies Prisma.MembershipSelect;

type TeamMemberRecord = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

@Injectable()
export class TeamMembersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    const members = await this.prisma.membership.findMany({
      where: { organizationId, role: { in: [...MANAGEABLE_STAFF_ROLES] } },
      orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
      select: memberSelect,
    });
    return members.map((member) => this.toResponse(member));
  }

  async create(organizationId: string, dto: CreateTeamMemberDto) {
    this.validateRole(dto.role);
    await this.validateBranch(organizationId, dto.branchId);
    if (dto.role !== Role.COUNTER_OPERATOR && dto.counterId) {
      throw new BadRequestException('Only counter operators can be assigned to counters');
    }
    if (dto.counterId) {
      await this.validateCounter(organizationId, dto.branchId, dto.counterId);
    }

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, memberships: { where: { organizationId }, select: { id: true } } },
    });
    if (existingUser?.memberships.length) {
      throw new ConflictException('A member with this email already belongs to this organization');
    }
    if (existingUser) {
      throw new ConflictException('Email already belongs to another account');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const member = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          displayName: dto.displayName.trim(),
          passwordHash,
        },
        select: { id: true },
      });

      const membership = await tx.membership.create({
        data: {
          organizationId,
          userId: user.id,
          branchId: dto.branchId,
          role: dto.role,
          status: MembershipStatus.ACTIVE,
        },
        select: memberSelect,
      });

      if (dto.counterId) {
        await this.assignCounter(tx, organizationId, dto.branchId, user.id, dto.counterId);
        const withAssignment = await tx.membership.findUniqueOrThrow({
          where: { id: membership.id },
          select: memberSelect,
        });
        return withAssignment;
      }

      return membership;
    });

    return { member: this.toResponse(member), temporaryPassword };
  }

  async update(organizationId: string, membershipId: string, dto: UpdateTeamMemberDto) {
    const current = await this.getMembership(organizationId, membershipId);
    const nextRole = dto.role ?? current.role;
    const nextBranchId = dto.branchId ?? current.branchId;

    this.validateRole(nextRole);
    if (!nextBranchId) {
      throw new BadRequestException('Branch is required for staff members');
    }
    await this.validateBranch(organizationId, nextBranchId);

    if (nextRole !== Role.COUNTER_OPERATOR && dto.counterId) {
      throw new BadRequestException('Only counter operators can be assigned to counters');
    }
    if (dto.counterId) {
      await this.validateCounter(organizationId, nextBranchId, dto.counterId);
    }

    const email = dto.email?.trim().toLowerCase();
    if (email && email !== current.user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw new ConflictException('Email already in use');
    }

    const member = await this.prisma.$transaction(async (tx) => {
      const userData: Prisma.UserUpdateInput = {};
      if (dto.displayName !== undefined) userData.displayName = dto.displayName.trim();
      if (email !== undefined) userData.email = email;
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id: current.userId }, data: userData });
      }

      await tx.membership.update({
        where: { id: membershipId },
        data: { role: nextRole, branchId: nextBranchId },
        select: { id: true },
      });

      if (nextRole !== Role.COUNTER_OPERATOR) {
        await this.removeOrganizationAssignments(tx, organizationId, current.userId);
      } else if (dto.branchId !== undefined && dto.branchId !== current.branchId) {
        await this.removeOrganizationAssignments(tx, organizationId, current.userId);
      }

      if (dto.counterId === null) {
        await this.removeBranchAssignments(tx, organizationId, nextBranchId, current.userId);
      } else if (dto.counterId) {
        await this.assignCounter(tx, organizationId, nextBranchId, current.userId, dto.counterId);
      }

      return tx.membership.findUniqueOrThrow({ where: { id: membershipId }, select: memberSelect });
    });

    return this.toResponse(member);
  }

  async setStatus(organizationId: string, membershipId: string, status: MembershipStatus) {
    const current = await this.getMembership(organizationId, membershipId);
    const member = await this.prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membershipId }, data: { status }, select: { id: true } });
      if (status === MembershipStatus.SUSPENDED) {
        await this.removeOrganizationAssignments(tx, organizationId, current.userId);
      }
      return tx.membership.findUniqueOrThrow({ where: { id: membershipId }, select: memberSelect });
    });
    return this.toResponse(member);
  }

  async updatePassword(organizationId: string, membershipId: string, newPassword: string) {
    const current = await this.getMembership(organizationId, membershipId);
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: current.userId },
      data: { passwordHash },
      select: { id: true },
    });
    return { success: true };
  }

  private async getMembership(organizationId: string, membershipId: string) {
    if (!isUUID(membershipId)) throw new NotFoundException('Team member not found');
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, role: { in: [...MANAGEABLE_STAFF_ROLES] } },
      select: memberSelect,
    });
    if (!membership) throw new NotFoundException('Team member not found');
    return membership;
  }

  private validateRole(role: Role) {
    if (!MANAGEABLE_STAFF_ROLES.has(role)) {
      throw new BadRequestException('Role cannot be assigned to organization staff');
    }
  }

  private async validateBranch(organizationId: string, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
  }

  private async validateCounter(organizationId: string, branchId: string, counterId: string) {
    if (!isUUID(counterId)) throw new NotFoundException('Counter not found');
    const counter = await this.prisma.counter.findFirst({
      where: { id: counterId, branchId, branch: { organizationId }, status: CounterStatus.ACTIVE },
      select: { id: true },
    });
    if (!counter) throw new NotFoundException('Counter not found');
  }

  private async assignCounter(tx: Prisma.TransactionClient, organizationId: string, branchId: string, userId: string, counterId: string) {
    await this.removeBranchAssignments(tx, organizationId, branchId, userId);
    await tx.counterAssignment.create({ data: { counterId, userId }, select: { id: true } });
  }

  private removeBranchAssignments(tx: Prisma.TransactionClient, organizationId: string, branchId: string, userId: string) {
    return tx.counterAssignment.deleteMany({
      where: { userId, counter: { branchId, branch: { organizationId } } },
    });
  }

  private removeOrganizationAssignments(tx: Prisma.TransactionClient, organizationId: string, userId: string) {
    return tx.counterAssignment.deleteMany({
      where: { userId, counter: { branch: { organizationId } } },
    });
  }

  private generateTemporaryPassword() {
    return crypto.randomBytes(18).toString('base64url');
  }

  private toResponse(member: TeamMemberRecord) {
    const assignments = member.user.counterAssignments.filter((assignment) => assignment.counter.branchId === member.branchId);
    const counterAssignment = assignments[0] ?? null;

    return {
      id: member.id,
      organizationId: member.organizationId,
      userId: member.userId,
      displayName: member.user.displayName,
      email: member.user.email,
      role: member.role,
      status: member.status,
      branchId: member.branchId,
      branch: member.branch,
      counterAssignment: counterAssignment
        ? {
            id: counterAssignment.id,
            counterId: counterAssignment.counterId,
            counter: counterAssignment.counter,
            createdAt: counterAssignment.createdAt,
            updatedAt: counterAssignment.updatedAt,
          }
        : null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    };
  }
}
