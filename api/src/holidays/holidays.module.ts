import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsDateString, IsNotEmpty, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Permissions } from '../common/auth';
import { P } from '../common/permissions';
import { toDate, todayIST } from '../common/dates';

class HolidayDto {
  @IsNotEmpty() name: string;
  @IsDateString() date: string;
  @IsOptional() @IsBoolean() optional?: boolean;
}

@Controller('holidays')
export class HolidaysController {
  constructor(private prisma: PrismaService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    const y = Number(year) || todayIST().getUTCFullYear();
    return this.prisma.holiday.findMany({
      where: { tenantId: u.tenantId, date: { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31)) } },
      orderBy: { date: 'asc' },
    });
  }

  @Post() @Permissions(P.HOLIDAY_WRITE) async create(@CurrentUser() u: AuthUser, @Body() dto: HolidayDto) {
    const date = toDate(dto.date);
    if (await this.prisma.holiday.findFirst({ where: { tenantId: u.tenantId, date } })) {
      throw new BadRequestException('A holiday already exists on this date');
    }
    return this.prisma.holiday.create({ data: { tenantId: u.tenantId, name: dto.name, date, optional: !!dto.optional } });
  }

  @Delete(':id') @Permissions(P.HOLIDAY_WRITE) async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.holiday.deleteMany({ where: { id, tenantId: u.tenantId } });
    return { ok: true };
  }
}

@Module({ controllers: [HolidaysController] })
export class HolidaysModule {}
