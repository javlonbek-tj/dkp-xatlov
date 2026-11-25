-- The call log section was removed.
-- DropForeignKey
ALTER TABLE "CallLog" DROP CONSTRAINT "CallLog_districtId_fkey";

-- DropTable
DROP TABLE "CallLog";

-- DropEnum
DROP TYPE "CallStatus";
