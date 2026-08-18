import { IncomingMessage, ServerResponse } from "http";
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { validateEnvironment } from "./config/env.validation";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { OrganizationsModule } from "./organizations/organizations.module";
import { OperationsModule } from "./operations/operations.module";
import { PatientsModule } from "./patients/patients.module";
import { QueueEntriesModule } from "./queue-entries/queue-entries.module";
import { TokensModule } from "./tokens/tokens.module";
import { QueueCallingModule } from "./queue-calling/queue-calling.module";
import { DisplaysModule } from "./displays/displays.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AppointmentsModule } from "./appointments/appointments.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AuditModule } from "./audit/audit.module";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { PriorityConfigurationsModule } from "./priority-configurations/priority-configurations.module";
import { PublicQueueModule } from "./public-queue/public-queue.module";
import { PrintersModule } from './printers/printers.module';
import { SelfServiceModule } from './self-service/self-service.module';
import { EntitlementsModule } from './entitlements/entitlements.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          pinoHttp: {
            level: configService.get('NODE_ENV') === 'production' ? 'info' : 'debug',
            ...(configService.get('NODE_ENV') !== 'production' && {
              transport: {
                target: 'pino-pretty',
                options: { singleLine: true },
              },
            }),
            genReqId: (req) => req.id,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "body.password",
                "body.accessToken",
                "body.refreshToken",
                "body.token",
                "body.otp"
              ],
              censor: "[REDACTED]"
            },
            serializers: {
              req: (req: IncomingMessage & { id?: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url
              }),
              res: (res: ServerResponse) => ({
                statusCode: res.statusCode
              })
            }
          }
        };
      }
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10000 // default limit
      }
    ]),
    HealthModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    OperationsModule,
    PatientsModule,
    QueueEntriesModule,
    TokensModule,
    AppointmentsModule,
    QueueCallingModule,
    DisplaysModule,
    NotificationsModule,
    AnalyticsModule,
    PriorityConfigurationsModule,
    PublicQueueModule,
    PrintersModule,
    SelfServiceModule,
    EntitlementsModule,
    TasksModule,
  ],
  providers: [
    ...(process.env.NODE_ENV === 'test' ? [] : [{
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }])
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
