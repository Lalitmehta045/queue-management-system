import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { OperationsService } from './operations.service';
import { ServicesController } from './services.controller';
import { CountersController } from './counters.controller';
import { CountersService } from './counters.service';
import { OperatorsController } from './operators.controller';
import { QueueCallingModule } from '../queue-calling/queue-calling.module';

import { DisplaysModule } from '../displays/displays.module';

@Module({
  imports: [QueueCallingModule, DisplaysModule],
  controllers: [DepartmentsController, ServicesController, CountersController, OperatorsController],
  providers: [OperationsService, CountersService],
})
export class OperationsModule {}