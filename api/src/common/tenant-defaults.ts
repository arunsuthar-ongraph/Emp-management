import { Prisma } from '@prisma/client';

/** Leave types every new company starts with (editable later by HR). */
export const DEFAULT_LEAVE_TYPES = [
  { name: 'Casual Leave', code: 'CL', annualQuota: 12, isPaid: true, carryForward: false },
  { name: 'Sick Leave', code: 'SL', annualQuota: 12, isPaid: true, carryForward: false },
  { name: 'Earned Leave', code: 'EL', annualQuota: 15, isPaid: true, carryForward: true },
  { name: 'Loss of Pay', code: 'LOP', annualQuota: 0, isPaid: false, carryForward: false },
];

export async function createTenantDefaults(tx: Prisma.TransactionClient, tenantId: string) {
  await tx.leaveType.createMany({ data: DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, tenantId })) });
  await tx.department.createMany({
    data: ['Management', 'Engineering', 'Human Resources', 'Finance'].map((name) => ({ name, tenantId })),
  });
  await tx.designation.createMany({
    data: ['Director', 'Manager', 'Senior Engineer', 'Engineer', 'HR Executive', 'Accountant'].map((name) => ({
      name,
      tenantId,
    })),
  });
}
