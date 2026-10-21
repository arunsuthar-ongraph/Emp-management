import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty } from 'class-validator';
import { AuthUser, CurrentUser, Permissions } from '../common/auth';
import { P } from '../common/permissions';
import { todayIST } from '../common/dates';
import { AttendanceService } from './attendance.service';

class MarkDto {
  @IsNotEmpty() employeeId: string;
  @IsDateString() date: string;
  @IsEnum(AttendanceStatus) status: AttendanceStatus;
}

const ym = (y?: string, m?: string) => {
  const t = todayIST();
  return [Number(y) || t.getUTCFullYear(), Number(m) || t.getUTCMonth() + 1] as const;
};

@Controller('attendance')
export class AttendanceController {
  constructor(private svc: AttendanceService) {}

  @Get('today') @Permissions(P.ATTENDANCE_SELF) today(@CurrentUser() u: AuthUser) {
    return this.svc.today(u);
  }

  @Post('clock-in') @Permissions(P.ATTENDANCE_SELF) clockIn(@CurrentUser() u: AuthUser) {
    return this.svc.clockIn(u);
  }

  @Post('clock-out') @Permissions(P.ATTENDANCE_SELF) clockOut(@CurrentUser() u: AuthUser) {
    return this.svc.clockOut(u);
  }

  @Get('me') @Permissions(P.ATTENDANCE_SELF) me(@CurrentUser() u: AuthUser, @Query('year') y?: string, @Query('month') m?: string) {
    return this.svc.myMonth(u, ...ym(y, m));
  }

  @Get('daily') daily(@CurrentUser() u: AuthUser, @Query('date') date?: string) {
    return this.svc.byDate(u, date);
  }

  @Get('employee/:id') @Permissions(P.ATTENDANCE_ALL)
  employee(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('year') y?: string, @Query('month') m?: string) {
    return this.svc.employeeMonth(u, id, ...ym(y, m));
  }

  @Post('mark') @Permissions(P.ATTENDANCE_ALL) mark(@CurrentUser() u: AuthUser, @Body() dto: MarkDto) {
    return this.svc.mark(u, dto.employeeId, dto.date, dto.status);
  }
}

@Module({ controllers: [AttendanceController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule {}
