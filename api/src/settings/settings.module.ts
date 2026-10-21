import { Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { ApprovalFlow } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Permissions } from '../common/auth';
import { P } from '../common/permissions';

class CompanyDto {
  @IsNotEmpty() name: string;
  @IsNotEmpty() state: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() pan?: string;
  @IsOptional() @IsString() tan?: string;
  @IsOptional() @IsString() pfCode?: string;
  @IsOptional() @IsString() esiCode?: string;
  @IsOptional() @IsEnum(ApprovalFlow) leaveApprovalFlow?: ApprovalFlow;
}

@Controller()
export class SettingsController {
  constructor(private prisma: PrismaService) {}

  @Get('settings/company') company(@CurrentUser() u: AuthUser) {
    return this.prisma.tenant.findUnique({ where: { id: u.tenantId } });
  }

  @Patch('settings/company') @Permissions(P.SETTINGS_WRITE) update(@CurrentUser() u: AuthUser, @Body() dto: CompanyDto) {
    return this.prisma.tenant.update({ where: { id: u.tenantId }, data: dto });
  }
}

@Module({ controllers: [SettingsController] })
export class SettingsModule {}
