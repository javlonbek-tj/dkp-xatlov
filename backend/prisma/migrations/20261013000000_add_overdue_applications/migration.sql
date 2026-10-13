CREATE TABLE "OverdueApplication" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deadlineDate" DATE NOT NULL,
    "clearedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OverdueApplication_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OverdueApplication_districtId_deadlineDate_idx" ON "OverdueApplication"("districtId", "deadlineDate");
CREATE INDEX "OverdueApplication_clearedAt_idx" ON "OverdueApplication"("clearedAt");
ALTER TABLE "OverdueApplication" ADD CONSTRAINT "OverdueApplication_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
