import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type HealthResponse = {
  status: "ok";
  service: string;
  timestamp: string;
  uptimeSeconds: number;
};

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.getLiveHealth();
  }

  @Get("live")
  getLiveHealth(): HealthResponse {
    return {
      status: "ok",
      service: "queue-management-api",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime())
    };
  }

  @Get("ready")
  async getReadyHealth(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getLiveHealth();
    } catch (err: unknown) {
      void err;
      throw new HttpException(
        {
          status: "error",
          service: "queue-management-api",
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.round(process.uptime()),
          reason: "Database connection failed"
        },
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }
  }

  @Get("diagnostics")
  async getDiagnostics() {
    let dbStatus = "connected";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = "disconnected";
    }

    return {
      status: "ok",
      service: "queue-management-api",
      uptimeSeconds: Math.round(process.uptime()),
      environment: process.env.NODE_ENV || "development",
      version: process.env.npm_package_version || "unknown",
      dbStatus
    };
  }
}
