-- Payment specialists enter the payments they collected in their district.
ALTER TYPE "UserRole" ADD VALUE 'PAYMENT_SPECIALIST';

ALTER TABLE "User" ADD COLUMN "position" TEXT;

CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "amount" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentRecord_userId_recordDate_idx" ON "PaymentRecord"("userId", "recordDate");
CREATE INDEX "PaymentRecord_districtId_recordDate_idx" ON "PaymentRecord"("districtId", "recordDate");
CREATE INDEX "PaymentRecord_applicationNumber_idx" ON "PaymentRecord"("applicationNumber");
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_districtId_fkey"
FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
