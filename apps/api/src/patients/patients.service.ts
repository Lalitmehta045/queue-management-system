import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, PatientStatus, Prisma, Role } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { randomBytes } from 'crypto';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { ListPatientsDto } from './dto/list-patients.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenant: Tenant, branchId: string, dto: CreatePatientDto, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    const data = {
      branchId,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phone: this.normalizePhone(dto.phone),
      email: this.normalizeEmail(dto.email),
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const patient = await this.prisma.patient.create({
          data: { ...data, patientNumber: this.generatePatientNumber() },
          select: this.patientSelect,
        });
        if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: AuditAction.PATIENT_CREATED, resourceType: AuditResourceType.PATIENT, resourceId: patient.id, metadata: { patientNumber: patient.patientNumber, status: patient.status } });
        return patient;
      } catch (error: unknown) {
        if (this.isUniqueError(error) && attempt < 2) continue;
        this.handlePrismaError(error, 'Patient could not be created');
      }
    }
    throw new ConflictException('Patient could not be created');
  }

  async list(tenant: Tenant, branchId: string, query: ListPatientsDto) {
    await this.authorizeBranch(tenant, branchId);
    const search = query.search?.trim();
    const where: Prisma.PatientWhereInput = { branchId };
    if (search) {
      const normalizedPhone = this.normalizePhone(search);
      where.OR = [
        { patientNumber: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        ...(normalizedPhone ? [{ phone: { contains: normalizedPhone } }] : []),
      ];
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.patient.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit, select: this.patientSelect }),
      this.prisma.patient.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async get(tenant: Tenant, branchId: string, patientId: string) {
    await this.authorizeBranch(tenant, branchId);
    const patient = await this.findPatient(tenant.organizationId, branchId, patientId);
    if (!patient) throw new NotFoundException('Patient not found');
    return patient;
  }

  async update(tenant: Tenant, branchId: string, patientId: string, dto: UpdatePatientDto, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    await this.get(tenant, branchId, patientId);
    try {
      const patient = await this.prisma.patient.update({
        where: { id: patientId },
        data: {
          ...(dto.firstName === undefined ? {} : { firstName: dto.firstName.trim() }),
          ...(dto.lastName === undefined ? {} : { lastName: dto.lastName.trim() }),
          ...(dto.phone === undefined ? {} : { phone: this.normalizePhone(dto.phone) }),
          ...(dto.email === undefined ? {} : { email: this.normalizeEmail(dto.email) }),
        },
        select: this.patientSelect,
      });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: AuditAction.PATIENT_UPDATED, resourceType: AuditResourceType.PATIENT, resourceId: patient.id, metadata: { patientNumber: patient.patientNumber, status: patient.status, changedFields: Object.keys(dto) } });
      return patient;
    } catch (error: unknown) {
      this.handlePrismaError(error, 'Patient could not be updated');
    }
  }

  async setStatus(tenant: Tenant, branchId: string, patientId: string, status: PatientStatus, auditContext?: AuditContext) {
    await this.authorizeBranch(tenant, branchId);
    await this.get(tenant, branchId, patientId);
    const patient = await this.prisma.patient.update({ where: { id: patientId }, data: { status }, select: this.patientSelect });
    if (auditContext) await this.audit.record({ ...auditContext, organizationId: tenant.organizationId, branchId, action: status === PatientStatus.ACTIVE ? AuditAction.PATIENT_ACTIVATED : AuditAction.PATIENT_DEACTIVATED, resourceType: AuditResourceType.PATIENT, resourceId: patient.id, metadata: { patientNumber: patient.patientNumber, status: patient.status } });
    return patient;
  }

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) {
      throw new ForbiddenException('You do not have access to this branch');
    }
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId: tenant.organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async findPatient(organizationId: string, branchId: string, patientId: string) {
    if (!isUUID(patientId)) return null;
    return this.prisma.patient.findFirst({ where: { id: patientId, branchId, branch: { organizationId } }, select: this.patientSelect });
  }

  private generatePatientNumber() {
    return `PAT-${randomBytes(6).toString('hex').toUpperCase()}`;
  }

  private normalizePhone(phone?: string) {
    if (!phone) return null;
    const normalized = phone.replace(/[^0-9]/g, '');
    return normalized || null;
  }

  private normalizeEmail(email?: string) {
    return email?.trim().toLowerCase() || null;
  }

  private readonly patientSelect = {
    id: true,
    branchId: true,
    patientNumber: true,
    firstName: true,
    lastName: true,
    phone: true,
    email: true,
    status: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.PatientSelect;

  private isUniqueError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private handlePrismaError(error: unknown, notFoundMessage: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('A resource with the same identifier already exists');
      if (error.code === 'P2025') throw new NotFoundException(notFoundMessage);
    }
    throw error;
  }
}
