CREATE TYPE "CallStatus" AS ENUM ('CALLED_SUCCESSFULLY', 'NO_ANSWER', 'CALLBACK_REQUIRED');

CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "callDate" DATE NOT NULL,
    "status" "CallStatus" NOT NULL,
    "monitoringAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "issues" TEXT,
    "nextAction" TEXT,
    "followUpDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CallLog_districtId_callDate_key" ON "CallLog"("districtId", "callDate");
CREATE INDEX "CallLog_callDate_status_idx" ON "CallLog"("callDate", "status");

ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_districtId_fkey"
FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
