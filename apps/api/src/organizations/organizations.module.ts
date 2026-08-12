import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { TeamMembersController } from './team-members.controller';
import { TeamMembersService } from './team-members.service';

@Module({
  controllers: [OrganizationsController, TeamMembersController],
  providers: [OrganizationsService, TeamMembersService],
})
export class OrganizationsModule {}
