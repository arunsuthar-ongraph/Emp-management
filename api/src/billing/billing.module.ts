import {
  Body, CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Global, HttpException, HttpStatus, Injectable, Module, Param, Patch, Post, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingCycle, SubscriptionStatus } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';
import { AuthUser, CurrentUser, Permissions } from '../common/auth';
import { P } from '../common/permissions';
import { BillingService, FEATURES } from './billing.service';

/** Marks a controller as part of a plan module, e.g. @Feature('payroll'). */
export const Feature = (code: keyof typeof FEATURES) => SetMetadata('feature', code);

/** Paths that keep working (for writes) when a company is read-only. */
const READ_ONLY_ALLOWED = ['/api/auth/', '/api/billing', '/api/profile/password'];

/**
 * Runs after AuthGuard on every request of a company user:
 *  - blocks modules that are not in the company's plan
 *  - in read-only mode (grace period over), blocks every write except billing, sign-in and password change
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private billing: BillingService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user?.tenantId) return true; // public routes and platform super admin

    const info = await this.billing.access(user.tenantId);
    const feature = this.reflector.getAllAndOverride<string>('feature', [ctx.getHandler(), ctx.getClass()]);
    if (feature && !info.features.includes(feature)) {
      throw new ForbiddenException(`${FEATURES[feature]} is not included in your ${info.plan.name} plan. Upgrade in Billing to use it.`);
    }
    const path: string = req.originalUrl || req.url;
    if (info.access === 'READ_ONLY' && req.method !== 'GET' && !READ_ONLY_ALLOWED.some((p) => path.startsWith(p))) {
      throw new HttpException('Your subscription has expired, so the account is read-only. Your company admin can renew it in Billing.', HttpStatus.PAYMENT_REQUIRED);
    }
    return true;
  }
}

// ---------- DTOs ----------
class ChangePlanDto {
  @IsNotEmpty() planId: string;
  @IsEnum(BillingCycle) billingCycle: BillingCycle;
}

class PlanDto {
  @Matches(/^[a-z0-9-]{2,30}$/, { message: 'Code: lowercase letters, numbers, hyphens' }) code: string;
  @IsNotEmpty() name: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0) pricePerEmployee: number;
  @IsNumber() @Min(0) minMonthly: number;
  @IsOptional() @IsInt() @Min(1) maxEmployees?: number | null;
  @IsArray() @ArrayNotEmpty() @IsIn(Object.keys(FEATURES), { each: true }) features: string[];
  @IsInt() @Min(0) trialDays: number;
  @IsBoolean() isActive: boolean;
  @IsInt() sortOrder: number;
}

class AdminSubscriptionDto {
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
  @IsOptional() @IsEnum(SubscriptionStatus) status?: SubscriptionStatus;
  @IsOptional() @IsDateString() trialEndsAt?: string;
  @IsOptional() @IsDateString() currentPeriodEnd?: string;
}

class PayDto {
  @IsIn(['Bank transfer', 'UPI', 'Cheque', 'Cash', 'Other']) method: string;
  @IsOptional() @IsString() reference?: string;
}

class VoidDto {
  @IsOptional() @IsString() reason?: string;
}

// ---------- Company admin ----------
@Controller('billing')
export class BillingController {
  constructor(private billing: BillingService) {}

  @Get() @Permissions(P.BILLING_MANAGE) overview(@CurrentUser() u: AuthUser) {
    return this.billing.overview(u.tenantId);
  }

  @Post('plan') @Permissions(P.BILLING_MANAGE) changePlan(@CurrentUser() u: AuthUser, @Body() dto: ChangePlanDto) {
    return this.billing.changePlan(u.tenantId, dto.planId, dto.billingCycle);
  }

  @Get('invoices/:id') @Permissions(P.BILLING_MANAGE) invoice(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.billing.invoice(id, u.tenantId);
  }
}

// ---------- Platform super admin ----------
@Controller('platform')
@Permissions(P.PLATFORM_ADMIN)
export class PlatformBillingController {
  constructor(private billing: BillingService) {}

  @Get('plans') plans() {
    return this.billing.plans(true);
  }

  @Get('features') features() {
    return FEATURES;
  }

  @Post('plans') createPlan(@Body() dto: PlanDto) {
    return this.billing.savePlan({ ...dto, maxEmployees: dto.maxEmployees ?? null });
  }

  @Patch('plans/:id') updatePlan(@Param('id') id: string, @Body() dto: PlanDto) {
    return this.billing.savePlan({ ...dto, maxEmployees: dto.maxEmployees ?? null }, id);
  }

  @Get('tenants/:id/subscription') subscription(@Param('id') id: string) {
    return this.billing.tenantSubscription(id);
  }

  @Patch('tenants/:id/subscription') updateSubscription(@Param('id') id: string, @Body() dto: AdminSubscriptionDto) {
    return this.billing.adminUpdate(id, dto);
  }

  @Post('tenants/:id/invoices') async issue(@Param('id') id: string) {
    const { subscription } = await this.billing.overview(id);
    return this.billing.issueUpcoming(subscription.id);
  }

  @Get('invoices/:id') invoice(@Param('id') id: string) {
    return this.billing.invoice(id);
  }

  @Post('invoices/:id/pay') pay(@Param('id') id: string, @Body() dto: PayDto) {
    return this.billing.markPaid(id, dto.method, dto.reference);
  }

  @Post('invoices/:id/void') void(@Param('id') id: string, @Body() dto: VoidDto) {
    return this.billing.voidInvoice(id, dto.reason);
  }

  @Post('billing/run') run() {
    return this.billing.runBilling();
  }
}

@Global()
@Module({
  controllers: [BillingController, PlatformBillingController],
  providers: [BillingService, SubscriptionGuard],
  exports: [BillingService, SubscriptionGuard],
})
export class BillingModule {}
