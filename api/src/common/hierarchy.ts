import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';
import { ApprovalFlow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Org hierarchy helpers: two trees per company.
 *  - Reporting tree: Employee.managerId
 *  - Department tree: Department.parentId, each department optionally led by Department.headId
 * Both are loaded into memory per call (a few ms even for tens of thousands of rows).
 */

type Emp = { id: string; managerId: string | null; departmentId: string | null; status: string };
type Dept = { id: string; parentId: string | null; headId: string | null };

export interface ChainStep {
  approverId: string | null; // null = HR/Admin queue
  role: string;
}

@Injectable()
export class HierarchyService {
  constructor(private prisma: PrismaService) {}

  private async load(tenantId: string) {
    const [emps, depts] = await Promise.all([
      this.prisma.employee.findMany({ where: { tenantId }, select: { id: true, managerId: true, departmentId: true, status: true } }),
      this.prisma.department.findMany({ where: { tenantId }, select: { id: true, parentId: true, headId: true } }),
    ]);
    return { emps, depts };
  }

  private static children<T extends { id: string }>(rows: T[], parentKey: keyof T) {
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const p = r[parentKey] as unknown as string | null;
      if (p) map.set(p, [...(map.get(p) || []), r.id]);
    }
    return map;
  }

  /** All ids below root in a tree (excluding root). */
  private static subtree(children: Map<string, string[]>, root: string) {
    const out = new Set<string>();
    const stack = [...(children.get(root) || [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      stack.push(...(children.get(id) || []));
    }
    return out;
  }

  /** Department plus all its sub-departments. */
  async departmentWithChildren(tenantId: string, departmentId: string) {
    const depts = await this.prisma.department.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
    return [departmentId, ...HierarchyService.subtree(HierarchyService.children(depts, 'parentId'), departmentId)];
  }

  /**
   * Everyone an employee leads: direct + indirect reports, plus all members of
   * departments (and sub-departments) they head. Excludes the employee themself.
   */
  async teamIds(tenantId: string, employeeId: string | null): Promise<string[]> {
    if (!employeeId) return [];
    const { emps, depts } = await this.load(tenantId);
    const team = HierarchyService.subtree(HierarchyService.children(emps, 'managerId'), employeeId);

    const deptChildren = HierarchyService.children(depts, 'parentId');
    const led = new Set<string>();
    for (const d of depts.filter((d) => d.headId === employeeId)) {
      led.add(d.id);
      HierarchyService.subtree(deptChildren, d.id).forEach((id) => led.add(id));
    }
    for (const e of emps) if (e.departmentId && led.has(e.departmentId)) team.add(e.id);
    team.delete(employeeId);
    return [...team].filter((id) => emps.find((e) => e.id === id)?.status === 'ACTIVE');
  }

  /** True if the employee manages someone or heads a department. */
  async isLead(tenantId: string, employeeId: string | null) {
    if (!employeeId) return false;
    const [reports, heads] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId, managerId: employeeId, status: 'ACTIVE' } }),
      this.prisma.department.count({ where: { tenantId, headId: employeeId } }),
    ]);
    return reports + heads > 0;
  }

  /** Nearest department head above an employee (walks up parent departments, skipping the employee themself). */
  private static headFor(emp: Emp, depts: Dept[]) {
    const byId = new Map(depts.map((d) => [d.id, d]));
    let d = emp.departmentId ? byId.get(emp.departmentId) : undefined;
    const seen = new Set<string>();
    while (d && !seen.has(d.id)) {
      seen.add(d.id);
      if (d.headId && d.headId !== emp.id) return d.headId;
      d = d.parentId ? byId.get(d.parentId) : undefined;
    }
    return null;
  }

  /** Builds the leave approval chain for an employee according to the company's flow. */
  async approvalChain(tenantId: string, employeeId: string, flow: ApprovalFlow): Promise<ChainStep[]> {
    const { emps, depts } = await this.load(tenantId);
    const emp = emps.find((e) => e.id === employeeId);
    if (!emp) return [{ approverId: null, role: 'HR' }];

    // Approvers must be active employees with an active login
    const users = await this.prisma.user.findMany({ where: { tenantId, isActive: true, employeeId: { not: null } }, select: { employeeId: true } });
    const canAct = new Set(users.map((u) => u.employeeId!));
    const valid = (id: string | null) => (id && id !== employeeId && canAct.has(id) && emps.find((e) => e.id === id)?.status === 'ACTIVE' ? id : null);

    const manager = valid(emp.managerId);
    const head = valid(HierarchyService.headFor(emp, depts));

    const steps: ChainStep[] = [];
    const push = (id: string | null, role: string) => id && !steps.some((s) => s.approverId === id) && steps.push({ approverId: id, role });
    if (flow === 'MANAGER') push(manager || head, manager ? 'Reporting Manager' : 'Department Head');
    else if (flow === 'DEPARTMENT_HEAD') push(head || manager, head ? 'Department Head' : 'Reporting Manager');
    else {
      push(manager, 'Reporting Manager');
      push(head, 'Department Head');
    }
    return steps.length ? steps : [{ approverId: null, role: 'HR' }];
  }

  /** Rejects a manager change that would make someone report (directly or indirectly) to themselves. */
  async assertNoManagerCycle(tenantId: string, employeeIds: string[], managerId: string | null | undefined) {
    if (!managerId) return;
    if (employeeIds.includes(managerId)) throw new BadRequestException('An employee cannot report to themselves');
    const { emps } = await this.load(tenantId);
    const children = HierarchyService.children(emps, 'managerId');
    for (const id of employeeIds) {
      if (HierarchyService.subtree(children, id).has(managerId)) {
        throw new BadRequestException('Invalid manager: this would create a circular reporting line');
      }
    }
  }

  async assertNoDepartmentCycle(tenantId: string, departmentId: string, parentId: string | null | undefined) {
    if (!parentId) return;
    if (parentId === departmentId) throw new BadRequestException('A department cannot be its own parent');
    const depts = await this.prisma.department.findMany({ where: { tenantId }, select: { id: true, parentId: true } });
    if (HierarchyService.subtree(HierarchyService.children(depts, 'parentId'), departmentId).has(parentId)) {
      throw new BadRequestException('Invalid parent: it is a sub-department of this department');
    }
  }
}

@Global()
@Module({ providers: [HierarchyService], exports: [HierarchyService] })
export class HierarchyModule {}
