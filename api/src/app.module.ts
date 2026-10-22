import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from './prisma/prisma.service';
import { HierarchyModule } from './common/hierarchy';
import { MailModule } from './notifications/mail.service';
import { BillingModule, SubscriptionGuard } from './billing/billing.module';
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
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [
    PrismaModule,
    HierarchyModule,
    MailModule,
    BillingModule,
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
    ProfileModule,
  ],
  // Order matters: authenticate first, then apply plan/subscription rules
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_GUARD, useClass: SubscriptionGuard }],
})
export class AppModule {}
