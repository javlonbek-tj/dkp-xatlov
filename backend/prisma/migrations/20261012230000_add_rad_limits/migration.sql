CREATE TABLE "RadLimit" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "monthlyLimit" INTEGER NOT NULL,
    "rejectedApplications" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RadLimit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RadLimit_month_valid" CHECK ("month" BETWEEN 1 AND 12),
    CONSTRAINT "RadLimit_year_valid" CHECK ("year" BETWEEN 1 AND 9999),
    CONSTRAINT "RadLimit_values_nonnegative" CHECK ("monthlyLimit" >= 0 AND "rejectedApplications" >= 0)
);

CREATE UNIQUE INDEX "RadLimit_districtId_month_year_key" ON "RadLimit"("districtId", "month", "year");
CREATE INDEX "RadLimit_year_month_idx" ON "RadLimit"("year", "month");
ALTER TABLE "RadLimit" ADD CONSTRAINT "RadLimit_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
