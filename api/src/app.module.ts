import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.service';
import { HierarchyModule } from './common/hierarchy';
import { AuthGuard } from './common/auth';
import { AuthModule } from './auth/auth.module';
import { EmployeesModule } from './employees/employees.module';
import { OrgModule } from './org/org.module';
import { LeaveModule } from './leave/leave.module';
import { HolidaysModule } from './holidays/holidays.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    PrismaModule,
    HierarchyModule,
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET, signOptions: { expiresIn: '12h' } }),
    AuthModule,
    EmployeesModule,
    OrgModule,
    LeaveModule,
    HolidaysModule,
    AttendanceModule,
    PayrollModule,
    DashboardModule,
    SettingsModule,
    PlatformModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
