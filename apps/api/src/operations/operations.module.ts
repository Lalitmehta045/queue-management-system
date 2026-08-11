import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { OperationsService } from './operations.service';
import { ServicesController } from './services.controller';
import { CountersController } from './counters.controller';
import { CountersService } from './counters.service';
import { OperatorsController } from './operators.controller';

@Module({
  controllers: [DepartmentsController, ServicesController, CountersController, OperatorsController],
  providers: [OperationsService, CountersService],
})
export class OperationsModule {}