import { Body, Controller, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { LeaveStatus } from '@prisma/client';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { AuthUser, CurrentUser, Permissions, requireEmployee } from '../common/auth';
import { P } from '../common/permissions';
import { LeaveService } from './leave.service';
import { LeaveNotifier } from '../notifications/leave-notifier';
import { Feature } from '../billing/billing.module';

class LeaveTypeDto {
  @IsNotEmpty() name: string;
  @IsNotEmpty() code: string;
  @IsInt() @Min(0) annualQuota: number;
  @IsBoolean() isPaid: boolean;
  @IsOptional() @IsBoolean() carryForward?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class ApplyDto {
  @IsNotEmpty() leaveTypeId: string;
  @IsDateString() fromDate: string;
  @IsDateString() toDate: string;
  @IsOptional() @IsBoolean() halfDay?: boolean;
  @IsOptional() @IsString() reason?: string;
}

class DecisionDto {
  @IsOptional() @IsString() comment?: string;
}

@Controller('leave')
@Feature('leave')
export class LeaveController {
  constructor(private svc: LeaveService) {}

  @Get('types') types(@CurrentUser() u: AuthUser) {
    return this.svc.types(u);
  }

  @Post('types') @Permissions(P.LEAVE_MANAGE) createType(@CurrentUser() u: AuthUser, @Body() dto: LeaveTypeDto) {
    return this.svc.saveType(u, { ...dto, code: dto.code.toUpperCase(), tenantId: u.tenantId });
  }

  @Patch('types/:id') @Permissions(P.LEAVE_MANAGE) updateType(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: LeaveTypeDto) {
    return this.svc.saveType(u, { ...dto, code: dto.code.toUpperCase(), tenantId: u.tenantId }, id);
  }

  @Get('balances/me') @Permissions(P.LEAVE_APPLY) myBalances(@CurrentUser() u: AuthUser) {
    return this.svc.balances(u, requireEmployee(u));
  }

  @Get('balances/:employeeId') @Permissions(P.LEAVE_MANAGE) balances(@CurrentUser() u: AuthUser, @Param('employeeId') id: string) {
    return this.svc.balances(u, id);
  }

  @Get('requests/me') @Permissions(P.LEAVE_APPLY) mine(@CurrentUser() u: AuthUser) {
    return this.svc.myRequests(u);
  }

  // Approvals follow the org hierarchy, so any employee may be an approver; the service checks each request.
  @Get('requests/pending') pending(@CurrentUser() u: AuthUser) {
    return this.svc.pendingApprovals(u);
  }

  @Get('requests/team') team(@CurrentUser() u: AuthUser) {
    return this.svc.teamRequests(u);
  }

  @Get('requests') @Permissions(P.LEAVE_MANAGE) all(@CurrentUser() u: AuthUser, @Query('status') status?: LeaveStatus) {
    return this.svc.allRequests(u, status || undefined);
  }

  @Post('requests') @Permissions(P.LEAVE_APPLY) apply(@CurrentUser() u: AuthUser, @Body() dto: ApplyDto) {
    return this.svc.apply(u, dto);
  }

  @Patch('requests/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.svc.decide(u, id, true, dto.comment);
  }

  @Patch('requests/:id/reject') reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.svc.decide(u, id, false, dto.comment);
  }

  @Patch('requests/:id/cancel') @Permissions(P.LEAVE_APPLY) cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.cancel(u, id);
  }
}

@Module({ controllers: [LeaveController], providers: [LeaveService, LeaveNotifier], exports: [LeaveService] })
export class LeaveModule {}
