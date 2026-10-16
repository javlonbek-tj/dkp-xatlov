-- MKD records are replaced by daily snapshots of in-progress MKD per district and year; old records are dropped.
DROP TABLE "MkdRecord";
DROP TYPE "MkdType";

CREATE TABLE "MkdRecord" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "recordDate" DATE NOT NULL,
    "inProgressCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MkdRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MkdRecord_year_valid" CHECK ("year" >= 2020),
    CONSTRAINT "MkdRecord_inProgressCount_nonnegative" CHECK ("inProgressCount" >= 0)
);

CREATE UNIQUE INDEX "MkdRecord_districtId_year_recordDate_key" ON "MkdRecord"("districtId", "year", "recordDate");
CREATE INDEX "MkdRecord_recordDate_idx" ON "MkdRecord"("recordDate");
ALTER TABLE "MkdRecord" ADD CONSTRAINT "MkdRecord_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
