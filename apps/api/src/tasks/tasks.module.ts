import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './tasks.service';

import { PrismaModule } from '../prisma/prisma.module';
import { DisplaysModule } from '../displays/displays.module';

@Module({
  imports: [ScheduleModule.forRoot(), PrismaModule, DisplaysModule],
  providers: [TasksService],
})
export class TasksModule {}
