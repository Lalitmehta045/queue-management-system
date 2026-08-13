import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, TokenStatus, AppointmentStatus, QueueEntryStatus } from '@prisma/client';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest } from '../auth/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

type Tenant = NonNullable<AuthenticatedRequest['tenant']>;

export interface SummaryMetrics {
  totalPatients: number;
  totalQueueEntries: number;
  waitingQueueCount: number;
  cancelledQueueCount: number;
  tokensIssued: number;
  tokensCalled: number;
  tokensServing: number;
  tokensCompleted: number;
  tokensSkipped: number;
  tokensCancelled: number;
  currentlyServing: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
  avgHandlingTimeSeconds: number | null;
  completionRate: number;
  cancellationRate: number;
  skipRate: number;
}

export interface ServicePerformanceRow {
  serviceId: string;
  serviceName: string;
  departmentName: string;
  queueEntries: number;
  tokensIssued: number;
  completed: number;
  cancelled: number;
  skipped: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
  completionRate: number;
}

export interface CounterPerformanceRow {
  counterId: string;
  counterName: string;
  counterCode: string;
  tokensHandled: number;
  completed: number;
  skipped: number;
  avgServiceTimeSeconds: number | null;
  avgWaitingTimeSeconds: number | null;
}

export interface DailyTrendRow {
  date: string;
  queueEntries: number;
  tokensIssued: number;
  completed: number;
  cancelled: number;
  skipped: number;
  avgWaitingTimeSeconds: number | null;
  avgServiceTimeSeconds: number | null;
}

export interface AppointmentSummary {
  appointmentsCreated: number;
  appointmentsCompleted: number;
  appointmentsCancelled: number;
  appointmentsNoShow: number;
  appointmentsScheduled: number;
  appointmentsConfirmed: number;
  appointmentsCheckedIn: number;
  appointmentVsWalkIn: { appointments: number; walkIns: number };
}

class SqlBuilder {
  private conditions: string[] = [];
  private params: unknown[] = [];
  private nextIdx = 1;

  add(condition: string, value: unknown): void {
    this.conditions.push(condition.replace('$N', `$${this.nextIdx++}`));
    this.params.push(value);
  }

  addRaw(condition: string): void {
    this.conditions.push(condition);
  }

  getWhere(): string {
    return this.conditions.join(' AND ');
  }

  getParams(): unknown[] {
    return this.params;
  }
}

function buildTokenFilters(
  sb: SqlBuilder,
  organizationId: string,
  branchId: string,
  query: AnalyticsQueryDto,
  aliases: { tokenSequence: string; branch: string; token: string; queueEntry: string; service: string },
): void {
  const { tokenSequence: tsAlias, branch: bAlias, token: tAlias, queueEntry: qeAlias, service: sAlias } = aliases;

  sb.add(`${tsAlias}."branchId" = $N::uuid`, branchId);
  sb.add(`${bAlias}."organizationId" = $N::uuid`, organizationId);

  if (query.businessDate) {
    sb.add(`${tAlias}."businessDate" = $N::date`, query.businessDate);
  } else {
    if (query.startDate) sb.add(`${tAlias}."businessDate" >= $N::date`, query.startDate);
    if (query.endDate) sb.add(`${tAlias}."businessDate" <= $N::date`, query.endDate);
  }

  if (query.serviceId) sb.add(`${qeAlias}."serviceId" = $N::uuid`, query.serviceId);
  if (query.departmentId) sb.add(`${sAlias}."departmentId" = $N::uuid`, query.departmentId);
  if (query.counterId) sb.add(`${tAlias}."counterId" = $N::uuid`, query.counterId);
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async authorizeBranch(tenant: Tenant, branchId: string) {
    if (!isUUID(branchId)) throw new NotFoundException('Branch not found');
    if (tenant.role === Role.BRANCH_ADMIN && tenant.branchId !== branchId) {
      throw new ForbiddenException('You do not have access to this branch');
    }
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  private buildTokenWhere(organizationId: string, branchId: string, query: AnalyticsQueryDto): Prisma.TokenWhereInput {
    const where: Prisma.TokenWhereInput = {
      sequence: { branchId, branch: { organizationId } },
    };

    if (query.businessDate) {
      where.businessDate = new Date(query.businessDate + 'T00:00:00.000Z');
    } else if (query.startDate || query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate + 'T00:00:00.000Z');
      if (query.endDate) dateFilter.lte = new Date(query.endDate + 'T00:00:00.000Z');
      where.businessDate = dateFilter;
    }

    const queueEntryFilter: Prisma.QueueEntryWhereInput = {};
    if (query.serviceId) queueEntryFilter.serviceId = query.serviceId;
    if (query.departmentId) queueEntryFilter.service = { departmentId: query.departmentId };
    if (Object.keys(queueEntryFilter).length > 0) where.queueEntry = queueEntryFilter;

    if (query.counterId) where.counterId = query.counterId;

    return where;
  }

  async getSummary(tenant: Tenant, branchId: string, query: AnalyticsQueryDto): Promise<SummaryMetrics> {
    await this.authorizeBranch(tenant, branchId);
    const tokenWhere = this.buildTokenWhere(tenant.organizationId, branchId, query);

    const queueEntryWhere: Prisma.QueueEntryWhereInput = {
      service: { department: { branchId, branch: { organizationId: tenant.organizationId } } },
    };
    if (query.serviceId) queueEntryWhere.serviceId = query.serviceId;
    if (query.departmentId) queueEntryWhere.service = { departmentId: query.departmentId };

    const [
      totalPatients,
      totalQueueEntries,
      waitingQueueCount,
      cancelledQueueCount,
      tokensIssued,
      tokensCalled,
      tokensServing,
      tokensCompleted,
      tokensSkipped,
      tokensCancelled,
    ] = await Promise.all([
      this.prisma.patient.count({
        where: { branchId, branch: { organizationId: tenant.organizationId } },
      }),
      this.prisma.queueEntry.count({ where: queueEntryWhere }),
      this.prisma.queueEntry.count({
        where: { ...queueEntryWhere, status: QueueEntryStatus.WAITING },
      }),
      this.prisma.queueEntry.count({
        where: { ...queueEntryWhere, status: QueueEntryStatus.CANCELLED },
      }),
      this.prisma.token.count({ where: tokenWhere }),
      this.prisma.token.count({ where: { ...tokenWhere, status: TokenStatus.CALLED } }),
      this.prisma.token.count({ where: { ...tokenWhere, status: TokenStatus.SERVING } }),
      this.prisma.token.count({ where: { ...tokenWhere, status: TokenStatus.COMPLETED } }),
      this.prisma.token.count({ where: { ...tokenWhere, status: TokenStatus.SKIPPED } }),
      this.prisma.token.count({ where: { ...tokenWhere, status: TokenStatus.CANCELLED } }),
    ]);

    const currentlyServing = tokensCalled + tokensServing;

    const sb = new SqlBuilder();
    buildTokenFilters(sb, tenant.organizationId, branchId, query, {
      tokenSequence: 'ts', branch: 'b', token: 't', queueEntry: 'qe', service: 's',
    });

    const timeAverages: Array<{
      avgWaitingSeconds: number | null;
      avgServiceSeconds: number | null;
      avgHandlingSeconds: number | null;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT
        AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."issuedAt")))::double precision as "avgWaitingSeconds",
        AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."servingAt")))::double precision as "avgServiceSeconds",
        AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."issuedAt")))::double precision as "avgHandlingSeconds"
      FROM "Token" t
      JOIN "TokenSequence" ts ON t."sequenceId" = ts.id
      JOIN "QueueEntry" qe ON t."queueEntryId" = qe.id
      JOIN "Service" s ON qe."serviceId" = s.id
      JOIN "Branch" b ON ts."branchId" = b.id
      WHERE ${sb.getWhere()}`,
      ...sb.getParams(),
    );

    const avgWaitingTimeSeconds = timeAverages[0]?.avgWaitingSeconds ?? null;
    const avgServiceTimeSeconds = timeAverages[0]?.avgServiceSeconds ?? null;
    const avgHandlingTimeSeconds = timeAverages[0]?.avgHandlingSeconds ?? null;

    const totalTokens = tokensIssued;
    const completionRate = totalTokens > 0 ? (tokensCompleted / totalTokens) * 100 : 0;
    const cancellationRate = totalTokens > 0 ? (tokensCancelled / totalTokens) * 100 : 0;
    const skipRate = totalTokens > 0 ? (tokensSkipped / totalTokens) * 100 : 0;

    return {
      totalPatients,
      totalQueueEntries,
      waitingQueueCount,
      cancelledQueueCount,
      tokensIssued: totalTokens,
      tokensCalled,
      tokensServing,
      tokensCompleted,
      tokensSkipped,
      tokensCancelled,
      currentlyServing,
      avgWaitingTimeSeconds,
      avgServiceTimeSeconds,
      avgHandlingTimeSeconds,
      completionRate,
      cancellationRate,
      skipRate,
    };
  }

  async getServicePerformance(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<ServicePerformanceRow[]> {
    await this.authorizeBranch(tenant, branchId);

    const sb = new SqlBuilder();
    sb.add('b."organizationId" = $N::uuid', tenant.organizationId);
    sb.add('d."branchId" = $N::uuid', branchId);

    if (query.businessDate) {
      sb.add('t."businessDate" = $N::date', query.businessDate);
    } else {
      if (query.startDate) sb.add('t."businessDate" >= $N::date', query.startDate);
      if (query.endDate) sb.add('t."businessDate" <= $N::date', query.endDate);
    }
    if (query.serviceId) sb.add('s.id = $N::uuid', query.serviceId);
    if (query.departmentId) sb.add('d.id = $N::uuid', query.departmentId);

    const rows: Array<{
      serviceId: string;
      serviceName: string;
      departmentName: string;
      queueEntries: number;
      tokensIssued: number;
      completed: number;
      cancelled: number;
      skipped: number;
      avgWaitingSeconds: number | null;
      avgServiceSeconds: number | null;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT
        s.id as "serviceId",
        s.name as "serviceName",
        d.name as "departmentName",
        COUNT(DISTINCT qe.id)::bigint as "queueEntries",
        COUNT(t.id)::bigint as "tokensIssued",
        COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::bigint as completed,
        COUNT(t.id) FILTER (WHERE t.status = 'CANCELLED')::bigint as cancelled,
        COUNT(t.id) FILTER (WHERE t.status = 'SKIPPED')::bigint as skipped,
        AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."issuedAt"))) FILTER (WHERE t."calledAt" IS NOT NULL)::double precision as "avgWaitingSeconds",
        AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."servingAt"))) FILTER (WHERE t."completedAt" IS NOT NULL AND t."servingAt" IS NOT NULL)::double precision as "avgServiceSeconds"
      FROM "Service" s
      JOIN "Department" d ON s."departmentId" = d.id
      JOIN "Branch" b ON d."branchId" = b.id
      JOIN "QueueEntry" qe ON qe."serviceId" = s.id
      JOIN "Patient" p ON qe."patientId" = p.id AND p."branchId" = b.id
      LEFT JOIN "Token" t ON t."queueEntryId" = qe.id
      LEFT JOIN "TokenSequence" ts ON t."sequenceId" = ts.id AND ts."branchId" = b.id
      WHERE ${sb.getWhere()}
      GROUP BY s.id, s.name, d.name
      ORDER BY s.name ASC`,
      ...sb.getParams(),
    );

    return rows.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      departmentName: r.departmentName,
      queueEntries: Number(r.queueEntries),
      tokensIssued: Number(r.tokensIssued),
      completed: Number(r.completed),
      cancelled: Number(r.cancelled),
      skipped: Number(r.skipped),
      avgWaitingTimeSeconds: r.avgWaitingSeconds,
      avgServiceTimeSeconds: r.avgServiceSeconds,
      completionRate: Number(r.tokensIssued) > 0 ? (Number(r.completed) / Number(r.tokensIssued)) * 100 : 0,
    }));
  }

  async getCounterPerformance(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<CounterPerformanceRow[]> {
    await this.authorizeBranch(tenant, branchId);

    const sb = new SqlBuilder();
    sb.add('c."branchId" = $N::uuid', branchId);
    sb.add('b."organizationId" = $N::uuid', tenant.organizationId);

    if (query.businessDate) {
      sb.add('t."businessDate" = $N::date', query.businessDate);
    } else {
      if (query.startDate) sb.add('t."businessDate" >= $N::date', query.startDate);
      if (query.endDate) sb.add('t."businessDate" <= $N::date', query.endDate);
    }
    if (query.serviceId) sb.add('qe."serviceId" = $N::uuid', query.serviceId);
    if (query.departmentId) sb.add('s."departmentId" = $N::uuid', query.departmentId);
    if (query.counterId) sb.add('c.id = $N::uuid', query.counterId);

    const rows: Array<{
      counterId: string;
      counterName: string;
      counterCode: string;
      tokensHandled: number;
      completed: number;
      skipped: number;
      avgServiceSeconds: number | null;
      avgWaitingSeconds: number | null;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT
        c.id as "counterId",
        c.name as "counterName",
        c.code as "counterCode",
        COUNT(t.id)::bigint as "tokensHandled",
        COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::bigint as completed,
        COUNT(t.id) FILTER (WHERE t.status = 'SKIPPED')::bigint as skipped,
        AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."servingAt"))) FILTER (WHERE t."completedAt" IS NOT NULL AND t."servingAt" IS NOT NULL)::double precision as "avgServiceSeconds",
        AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."issuedAt"))) FILTER (WHERE t."calledAt" IS NOT NULL)::double precision as "avgWaitingSeconds"
      FROM "Counter" c
      JOIN "Branch" b ON c."branchId" = b.id
      LEFT JOIN "Token" t ON t."counterId" = c.id
      LEFT JOIN "TokenSequence" ts ON t."sequenceId" = ts.id
      LEFT JOIN "QueueEntry" qe ON t."queueEntryId" = qe.id
      LEFT JOIN "Service" s ON qe."serviceId" = s.id
      WHERE ${sb.getWhere()}
      GROUP BY c.id, c.name, c.code
      ORDER BY c.name ASC`,
      ...sb.getParams(),
    );

    return rows.map((r) => ({
      counterId: r.counterId,
      counterName: r.counterName,
      counterCode: r.counterCode,
      tokensHandled: Number(r.tokensHandled),
      completed: Number(r.completed),
      skipped: Number(r.skipped),
      avgServiceTimeSeconds: r.avgServiceSeconds,
      avgWaitingTimeSeconds: r.avgWaitingSeconds,
    }));
  }

  async getDailyTrend(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<DailyTrendRow[]> {
    await this.authorizeBranch(tenant, branchId);

    const sb = new SqlBuilder();
    buildTokenFilters(sb, tenant.organizationId, branchId, query, {
      tokenSequence: 'ts', branch: 'b', token: 't', queueEntry: 'qe', service: 's',
    });

    const rows: Array<{
      date: string;
      queueEntries: number;
      tokensIssued: number;
      completed: number;
      cancelled: number;
      skipped: number;
      avgWaitingSeconds: number | null;
      avgServiceSeconds: number | null;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT
        t."businessDate"::text as "date",
        COUNT(DISTINCT qe.id)::bigint as "queueEntries",
        COUNT(t.id)::bigint as "tokensIssued",
        COUNT(t.id) FILTER (WHERE t.status = 'COMPLETED')::bigint as completed,
        COUNT(t.id) FILTER (WHERE t.status = 'CANCELLED')::bigint as cancelled,
        COUNT(t.id) FILTER (WHERE t.status = 'SKIPPED')::bigint as skipped,
        AVG(EXTRACT(EPOCH FROM (t."calledAt" - t."issuedAt"))) FILTER (WHERE t."calledAt" IS NOT NULL)::double precision as "avgWaitingSeconds",
        AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."servingAt"))) FILTER (WHERE t."completedAt" IS NOT NULL AND t."servingAt" IS NOT NULL)::double precision as "avgServiceSeconds"
      FROM "Token" t
      JOIN "TokenSequence" ts ON t."sequenceId" = ts.id
      JOIN "QueueEntry" qe ON t."queueEntryId" = qe.id
      JOIN "Service" s ON qe."serviceId" = s.id
      JOIN "Branch" b ON ts."branchId" = b.id
      WHERE ${sb.getWhere()}
      GROUP BY t."businessDate"
      ORDER BY t."businessDate" ASC`,
      ...sb.getParams(),
    );

    return rows.map((r) => ({
      date: typeof r.date === 'string' ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10),
      queueEntries: Number(r.queueEntries),
      tokensIssued: Number(r.tokensIssued),
      completed: Number(r.completed),
      cancelled: Number(r.cancelled),
      skipped: Number(r.skipped),
      avgWaitingTimeSeconds: r.avgWaitingSeconds,
      avgServiceTimeSeconds: r.avgServiceSeconds,
    }));
  }

  async getAppointmentSummary(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<AppointmentSummary> {
    await this.authorizeBranch(tenant, branchId);

    const apptWhere: Prisma.AppointmentWhereInput = {
      branchId,
      branch: { organizationId: tenant.organizationId },
    };

    if (query.businessDate) {
      apptWhere.appointmentDate = new Date(query.businessDate + 'T00:00:00.000Z');
    } else if (query.startDate || query.endDate) {
      const dateFilter: Record<string, Date> = {};
      if (query.startDate) dateFilter.gte = new Date(query.startDate + 'T00:00:00.000Z');
      if (query.endDate) dateFilter.lte = new Date(query.endDate + 'T00:00:00.000Z');
      apptWhere.appointmentDate = dateFilter;
    }

    if (query.serviceId) apptWhere.serviceId = query.serviceId;
    if (query.departmentId) apptWhere.service = { departmentId: query.departmentId };

    const [
      created,
      completed,
      cancelled,
      noShow,
      scheduled,
      confirmed,
      checkedIn,
    ] = await Promise.all([
      this.prisma.appointment.count({ where: apptWhere }),
      this.prisma.appointment.count({ where: { ...apptWhere, status: AppointmentStatus.COMPLETED } }),
      this.prisma.appointment.count({ where: { ...apptWhere, status: AppointmentStatus.CANCELLED } }),
      this.prisma.appointment.count({ where: { ...apptWhere, status: AppointmentStatus.NO_SHOW } }),
      this.prisma.appointment.count({ where: { ...apptWhere, status: AppointmentStatus.SCHEDULED } }),
      this.prisma.appointment.count({ where: { ...apptWhere, status: AppointmentStatus.CONFIRMED } }),
      this.prisma.appointment.count({ where: { ...apptWhere, status: AppointmentStatus.CHECKED_IN } }),
    ]);

    const tokenWhere = this.buildTokenWhere(tenant.organizationId, branchId, query);
    const totalTokens = await this.prisma.token.count({ where: tokenWhere });
    const walkIns = Math.max(0, totalTokens - checkedIn);

    return {
      appointmentsCreated: created,
      appointmentsCompleted: completed,
      appointmentsCancelled: cancelled,
      appointmentsNoShow: noShow,
      appointmentsScheduled: scheduled,
      appointmentsConfirmed: confirmed,
      appointmentsCheckedIn: checkedIn,
      appointmentVsWalkIn: { appointments: checkedIn, walkIns },
    };
  }

  async exportCsv(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
    type: 'services' | 'counters' | 'trends',
  ): Promise<string> {
    await this.authorizeBranch(tenant, branchId);

    switch (type) {
      case 'services':
        return this.buildServiceCsv(tenant, branchId, query);
      case 'counters':
        return this.buildCounterCsv(tenant, branchId, query);
      case 'trends':
        return this.buildTrendCsv(tenant, branchId, query);
    }
  }

  private formatSeconds(seconds: number | null): string {
    if (seconds === null || Number.isNaN(seconds)) return '';
    return Math.round(seconds).toString();
  }

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private async buildServiceCsv(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<string> {
    const data = await this.getServicePerformance(tenant, branchId, query);
    const header = 'Service,Department,Queue Entries,Tokens Issued,Completed,Cancelled,Skipped,Avg Waiting Time (s),Avg Service Time (s),Completion Rate (%)';
    const rows = data.map((r) =>
      [
        this.escapeCsvField(r.serviceName),
        this.escapeCsvField(r.departmentName),
        r.queueEntries,
        r.tokensIssued,
        r.completed,
        r.cancelled,
        r.skipped,
        this.formatSeconds(r.avgWaitingTimeSeconds),
        this.formatSeconds(r.avgServiceTimeSeconds),
        r.completionRate.toFixed(1),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  private async buildCounterCsv(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<string> {
    const data = await this.getCounterPerformance(tenant, branchId, query);
    const header = 'Counter,Code,Tokens Handled,Completed,Skipped,Avg Service Time (s),Avg Waiting Time (s)';
    const rows = data.map((r) =>
      [
        this.escapeCsvField(r.counterName),
        this.escapeCsvField(r.counterCode),
        r.tokensHandled,
        r.completed,
        r.skipped,
        this.formatSeconds(r.avgServiceTimeSeconds),
        this.formatSeconds(r.avgWaitingTimeSeconds),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  private async buildTrendCsv(
    tenant: Tenant,
    branchId: string,
    query: AnalyticsQueryDto,
  ): Promise<string> {
    const data = await this.getDailyTrend(tenant, branchId, query);
    const header = 'Date,Queue Entries,Tokens Issued,Completed,Cancelled,Skipped,Avg Waiting Time (s),Avg Service Time (s)';
    const rows = data.map((r) =>
      [
        r.date,
        r.queueEntries,
        r.tokensIssued,
        r.completed,
        r.cancelled,
        r.skipped,
        this.formatSeconds(r.avgWaitingTimeSeconds),
        this.formatSeconds(r.avgServiceTimeSeconds),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }
}
