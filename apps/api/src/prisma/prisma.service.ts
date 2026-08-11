import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Prisma database connection established successfully');
    } catch (error) {
      this.logger.error('Failed to establish Prisma database connection', error instanceof Error ? error.stack : undefined);
      // Let it fail if DB is unavailable at startup
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('Closing Prisma database connection...');
    await this.$disconnect();
    this.logger.log('Prisma database connection closed successfully');
  }
}
