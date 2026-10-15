-- RAD limits become dated snapshots (month-to-date values) instead of one row per month.
ALTER TABLE "RadLimit" ADD COLUMN "recordDate" DATE;

-- Existing rows take the Tashkent date of their last edit, kept within their own month.
UPDATE "RadLimit" SET "recordDate" = LEAST(
  GREATEST((("updatedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::date, make_date("year", "month", 1)),
  (make_date("year", "month", 1) + INTERVAL '1 month - 1 day')::date
);

ALTER TABLE "RadLimit" ALTER COLUMN "recordDate" SET NOT NULL;
DROP INDEX "RadLimit_districtId_month_year_key";
DROP INDEX "RadLimit_year_month_idx";
ALTER TABLE "RadLimit" DROP CONSTRAINT "RadLimit_month_valid";
ALTER TABLE "RadLimit" DROP CONSTRAINT "RadLimit_year_valid";
ALTER TABLE "RadLimit" DROP COLUMN "month";
ALTER TABLE "RadLimit" DROP COLUMN "year";

CREATE UNIQUE INDEX "RadLimit_districtId_recordDate_key" ON "RadLimit"("districtId", "recordDate");
CREATE INDEX "RadLimit_recordDate_idx" ON "RadLimit"("recordDate");
