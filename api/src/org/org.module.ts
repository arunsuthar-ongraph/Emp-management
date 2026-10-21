import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Permissions } from '../common/auth';
import { P } from '../common/permissions';
import { HierarchyService } from '../common/hierarchy';

class NameDto {
  @IsNotEmpty() name: string;
}

class DepartmentDto {
  @IsNotEmpty() name: string;
  @IsOptional() @IsString() parentId?: string | null;
  @IsOptional() @IsString() headId?: string | null;
}

class MembersDto {
  @IsArray() @ArrayNotEmpty() employeeIds: string[];
}

const empBrief = { select: { id: true, code: true, firstName: true, lastName: true } };

@Controller()
export class OrgController {
  constructor(private prisma: PrismaService, private hierarchy: HierarchyService) {}

  // ---------- Departments (tree) ----------
  @Get('departments') departments(@CurrentUser() u: AuthUser) {
    return this.prisma.department.findMany({
      where: { tenantId: u.tenantId },
      include: { head: empBrief, _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
      orderBy: { name: 'asc' },
    });
  }

  private async validateRefs(u: AuthUser, dto: DepartmentDto) {
    if (dto.parentId && !(await this.prisma.department.findFirst({ where: { id: dto.parentId, tenantId: u.tenantId } }))) {
      throw new BadRequestException('Parent department not found');
    }
    if (dto.headId && !(await this.prisma.employee.findFirst({ where: { id: dto.headId, tenantId: u.tenantId, status: 'ACTIVE' } }))) {
      throw new BadRequestException('Department head must be an active employee');
    }
    const clash = await this.prisma.department.findFirst({ where: { tenantId: u.tenantId, name: dto.name } });
    return clash;
  }

  @Post('departments') @Permissions(P.ORG_WRITE) async addDepartment(@CurrentUser() u: AuthUser, @Body() dto: DepartmentDto) {
    if (await this.validateRefs(u, dto)) throw new BadRequestException(`${dto.name} already exists`);
    return this.prisma.department.create({
      data: { tenantId: u.tenantId, name: dto.name.trim(), parentId: dto.parentId || null, headId: dto.headId || null },
    });
  }

  @Patch('departments/:id') @Permissions(P.ORG_WRITE) async updateDepartment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DepartmentDto) {
    const dept = await this.prisma.department.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!dept) throw new NotFoundException();
    const clash = await this.validateRefs(u, dto);
    if (clash && clash.id !== id) throw new BadRequestException(`${dto.name} already exists`);
    await this.hierarchy.assertNoDepartmentCycle(u.tenantId, id, dto.parentId);
    return this.prisma.department.update({
      where: { id },
      data: { name: dto.name.trim(), parentId: dto.parentId || null, headId: dto.headId || null },
    });
  }

  /** Sub-departments move up to the deleted department's parent; its employees become unassigned. */
  @Delete('departments/:id') @Permissions(P.ORG_WRITE) async delDepartment(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const dept = await this.prisma.department.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!dept) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.department.updateMany({ where: { parentId: id }, data: { parentId: dept.parentId } }),
      this.prisma.department.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  @Post('departments/:id/members') @Permissions(P.ORG_WRITE) async addMembers(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: MembersDto) {
    const dept = await this.prisma.department.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!dept) throw new NotFoundException();
    const res = await this.prisma.employee.updateMany({ where: { id: { in: dto.employeeIds }, tenantId: u.tenantId }, data: { departmentId: id } });
    return { moved: res.count };
  }

  // ---------- Org chart (lazy: one level at a time) ----------
  @Get('org/chart') async chart(@CurrentUser() u: AuthUser, @Query('managerId') managerId?: string) {
    const rows = await this.prisma.employee.findMany({
      where: { tenantId: u.tenantId, status: 'ACTIVE', managerId: managerId || null },
      select: {
        id: true, code: true, firstName: true, lastName: true,
        designation: { select: { name: true } },
        department: { select: { name: true } },
        headOf: { select: { name: true } },
        _count: { select: { reports: { where: { status: 'ACTIVE' } } } },
      },
      orderBy: { firstName: 'asc' },
    });
    return rows.map((e) => ({
      id: e.id,
      code: e.code,
      name: `${e.firstName} ${e.lastName}`,
      designation: e.designation?.name,
      department: e.department?.name,
      heads: e.headOf.map((d) => d.name),
      reports: e._count.reports,
    }));
  }

  // ---------- Designations ----------
  @Get('designations') designations(@CurrentUser() u: AuthUser) {
    return this.prisma.designation.findMany({
      where: { tenantId: u.tenantId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @Post('designations') @Permissions(P.ORG_WRITE) async addDesignation(@CurrentUser() u: AuthUser, @Body() dto: NameDto) {
    if (await this.prisma.designation.findFirst({ where: { tenantId: u.tenantId, name: dto.name } })) {
      throw new BadRequestException(`${dto.name} already exists`);
    }
    return this.prisma.designation.create({ data: { tenantId: u.tenantId, name: dto.name.trim() } });
  }

  @Delete('designations/:id') @Permissions(P.ORG_WRITE) async delDesignation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.designation.deleteMany({ where: { id, tenantId: u.tenantId } });
    return { ok: true };
  }
}

@Module({ controllers: [OrgController] })
export class OrgModule {}
