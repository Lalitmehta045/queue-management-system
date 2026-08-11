import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResourceType, DepartmentStatus, Prisma, ServiceStatus } from '@prisma/client';
import { AuditContext, AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListResourcesDto } from './dto/list-resources.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async createDepartment(organizationId: string, branchId: string, dto: CreateDepartmentDto, auditContext?: AuditContext) {
    await this.getBranch(organizationId, branchId);
    try {
      const department = await this.prisma.department.create({ data: { branchId, name: dto.name.trim() }, select: this.departmentSelect });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId, branchId, action: AuditAction.DEPARTMENT_CREATED, resourceType: AuditResourceType.DEPARTMENT, resourceId: department.id, metadata: { name: department.name, status: department.status } });
      return department;
    } catch (error: unknown) { this.handlePrismaError(error, 'Department could not be created'); }
  }

  async listDepartments(organizationId: string, branchId: string, query: ListResourcesDto) {
    await this.getBranch(organizationId, branchId);
    const where = { branchId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit, select: this.departmentSelect }),
      this.prisma.department.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async getDepartment(organizationId: string, branchId: string, departmentId: string) {
    const department = await this.findDepartment(organizationId, branchId, departmentId);
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async updateDepartment(organizationId: string, branchId: string, departmentId: string, dto: UpdateDepartmentDto, auditContext?: AuditContext) {
    await this.getDepartment(organizationId, branchId, departmentId);
    try {
      const department = await this.prisma.department.update({ where: { id: departmentId }, data: dto.name === undefined ? {} : { name: dto.name.trim() }, select: this.departmentSelect });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId, branchId, action: AuditAction.DEPARTMENT_UPDATED, resourceType: AuditResourceType.DEPARTMENT, resourceId: department.id, metadata: { name: department.name, status: department.status, changedFields: Object.keys(dto) } });
      return department;
    } catch (error: unknown) { this.handlePrismaError(error, 'Department could not be updated'); }
  }

  async setDepartmentStatus(organizationId: string, branchId: string, departmentId: string, status: DepartmentStatus, auditContext?: AuditContext) {
    await this.getDepartment(organizationId, branchId, departmentId);
    const department = await this.prisma.department.update({ where: { id: departmentId }, data: { status }, select: this.departmentSelect });
    if (auditContext) await this.audit.record({ ...auditContext, organizationId, branchId, action: status === DepartmentStatus.ACTIVE ? AuditAction.DEPARTMENT_ACTIVATED : AuditAction.DEPARTMENT_DEACTIVATED, resourceType: AuditResourceType.DEPARTMENT, resourceId: department.id, metadata: { name: department.name, status: department.status } });
    return department;
  }

  async createService(organizationId: string, departmentId: string, dto: CreateServiceDto, auditContext?: AuditContext) {
    const department = await this.getDepartmentForOrganization(organizationId, departmentId);
    try {
      const service = await this.prisma.$transaction(async (tx) => {
        await this.entitlements.lockOrganization(organizationId, tx);
        const currentCount = await tx.service.count({ where: { department: { branch: { organizationId } } } });
        await this.entitlements.enforceLimit(organizationId, 'maxServices', currentCount, 1, tx);

        return tx.service.create({ data: { departmentId, name: dto.name.trim() }, select: this.serviceSelect });
      });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId, branchId: department.branchId, action: AuditAction.SERVICE_CREATED, resourceType: AuditResourceType.SERVICE, resourceId: service.id, metadata: { name: service.name, status: service.status } });
      return service;
    } catch (error: unknown) { this.handlePrismaError(error, 'Service could not be created'); }
  }

  async listServices(organizationId: string, departmentId: string, query: ListResourcesDto) {
    await this.getDepartmentForOrganization(organizationId, departmentId);
    const where = { departmentId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.limit, take: query.limit, select: this.serviceSelect }),
      this.prisma.service.count({ where }),
    ]);
    return { data, meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async getService(organizationId: string, departmentId: string, serviceId: string) {
    const service = await this.findService(organizationId, departmentId, serviceId);
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  async updateService(organizationId: string, departmentId: string, serviceId: string, dto: UpdateServiceDto, auditContext?: AuditContext) {
    const department = await this.getDepartmentForOrganization(organizationId, departmentId);
    await this.getService(organizationId, departmentId, serviceId);
    try {
      const service = await this.prisma.service.update({
        where: { id: serviceId },
        data: {
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.acceptingQueueEntries === undefined ? {} : { acceptingQueueEntries: dto.acceptingQueueEntries }),
        },
        select: this.serviceSelect,
      });
      if (auditContext) await this.audit.record({ ...auditContext, organizationId, branchId: department.branchId, action: AuditAction.SERVICE_UPDATED, resourceType: AuditResourceType.SERVICE, resourceId: service.id, metadata: { name: service.name, status: service.status, acceptingQueueEntries: service.acceptingQueueEntries, changedFields: Object.keys(dto) } });
      return service;
    } catch (error: unknown) { this.handlePrismaError(error, 'Service could not be updated'); }
  }

  async setServiceStatus(organizationId: string, departmentId: string, serviceId: string, status: ServiceStatus, auditContext?: AuditContext) {
    const department = await this.getDepartmentForOrganization(organizationId, departmentId);
    await this.getService(organizationId, departmentId, serviceId);
    const service = await this.prisma.service.update({ where: { id: serviceId }, data: { status }, select: this.serviceSelect });
    if (auditContext) await this.audit.record({ ...auditContext, organizationId, branchId: department.branchId, action: status === ServiceStatus.ACTIVE ? AuditAction.SERVICE_ACTIVATED : AuditAction.SERVICE_DEACTIVATED, resourceType: AuditResourceType.SERVICE, resourceId: service.id, metadata: { name: service.name, status: service.status } });
    return service;
  }

  private async getBranch(organizationId: string, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, organizationId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private async findDepartment(organizationId: string, branchId: string, departmentId: string) {
    if (!isUUID(branchId) || !isUUID(departmentId)) return null;
    return this.prisma.department.findFirst({ where: { id: departmentId, branchId, branch: { organizationId } }, select: this.departmentSelect });
  }

  private async getDepartmentForOrganization(organizationId: string, departmentId: string) {
    if (!isUUID(departmentId)) throw new NotFoundException('Department not found');
    const department = await this.prisma.department.findFirst({ where: { id: departmentId, branch: { organizationId } }, select: { id: true, branchId: true } });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  private async findService(organizationId: string, departmentId: string, serviceId: string) {
    if (!isUUID(departmentId) || !isUUID(serviceId)) return null;
    return this.prisma.service.findFirst({ where: { id: serviceId, departmentId, department: { branch: { organizationId } } }, select: this.serviceSelect });
  }

  private readonly departmentSelect = { id: true, branchId: true, name: true, status: true, createdAt: true, updatedAt: true } satisfies Prisma.DepartmentSelect;
  private readonly serviceSelect = { id: true, departmentId: true, name: true, status: true, acceptingQueueEntries: true, createdAt: true, updatedAt: true } satisfies Prisma.ServiceSelect;

  private handlePrismaError(error: unknown, notFoundMessage: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('A resource with the same identifier already exists');
      if (error.code === 'P2025') throw new NotFoundException(notFoundMessage);
    }
    throw error;
  }
}
