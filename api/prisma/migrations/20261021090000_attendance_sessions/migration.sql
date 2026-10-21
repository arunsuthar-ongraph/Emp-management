-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "minutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSession_employeeId_clockOut_idx" ON "AttendanceSession"("employeeId", "clockOut");

-- CreateIndex
CREATE INDEX "AttendanceSession_attendanceId_idx" ON "AttendanceSession"("attendanceId");

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing days become a single session each
INSERT INTO "AttendanceSession" ("id", "tenantId", "attendanceId", "employeeId", "clockIn", "clockOut", "minutes")
SELECT gen_random_uuid()::text, "tenantId", "id", "employeeId", "clockIn", "clockOut", "workMinutes"
FROM "Attendance" WHERE "clockIn" IS NOT NULL;
