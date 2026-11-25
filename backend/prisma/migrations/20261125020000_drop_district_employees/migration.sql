-- The district employees list ("Xodimlar kesimida") was removed.
-- DropForeignKey
ALTER TABLE "DistrictEmployee" DROP CONSTRAINT "DistrictEmployee_districtId_fkey";

-- DropForeignKey
ALTER TABLE "EmployeeDailyWork" DROP CONSTRAINT "EmployeeDailyWork_employeeId_fkey";

-- DropTable
DROP TABLE "DistrictEmployee";

-- DropTable
DROP TABLE "EmployeeDailyWork";

