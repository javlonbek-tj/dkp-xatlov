-- District heads enter the daily census and migration counts of their district's employees.
ALTER TYPE "UserRole" ADD VALUE 'DISTRICT_HEAD';

ALTER TABLE "User" ADD COLUMN "districtId" TEXT;
CREATE INDEX "User_districtId_idx" ON "User"("districtId");
ALTER TABLE "User" ADD CONSTRAINT "User_districtId_fkey"
FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DistrictEmployee" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DistrictEmployee_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DistrictEmployee_districtId_idx" ON "DistrictEmployee"("districtId");
ALTER TABLE "DistrictEmployee" ADD CONSTRAINT "DistrictEmployee_districtId_fkey"
FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EmployeeDailyWork" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "censusCount" INTEGER NOT NULL,
    "migrationCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeeDailyWork_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeDailyWork_employeeId_recordDate_key" ON "EmployeeDailyWork"("employeeId", "recordDate");
CREATE INDEX "EmployeeDailyWork_recordDate_idx" ON "EmployeeDailyWork"("recordDate");
ALTER TABLE "EmployeeDailyWork" ADD CONSTRAINT "EmployeeDailyWork_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "DistrictEmployee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
