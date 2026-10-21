-- CreateEnum
CREATE TYPE "ApprovalFlow" AS ENUM ('MANAGER', 'DEPARTMENT_HEAD', 'MANAGER_THEN_HEAD');

-- CreateEnum
CREATE TYPE "ApprovalStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "headId" TEXT,
ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "currentApproverId" TEXT,
ADD COLUMN     "currentLevel" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "leaveApprovalFlow" "ApprovalFlow" NOT NULL DEFAULT 'MANAGER_THEN_HEAD';

-- CreateTable
CREATE TABLE "LeaveApproval" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "approverId" TEXT,
    "role" TEXT NOT NULL,
    "status" "ApprovalStepStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "actedById" TEXT,
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "LeaveApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeaveApproval_requestId_level_key" ON "LeaveApproval"("requestId", "level");

-- CreateIndex
CREATE INDEX "LeaveRequest_currentApproverId_status_idx" ON "LeaveRequest"("currentApproverId", "status");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_headId_fkey" FOREIGN KEY ("headId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_currentApproverId_fkey" FOREIGN KEY ("currentApproverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApproval" ADD CONSTRAINT "LeaveApproval_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

