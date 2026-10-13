CREATE TYPE "MkdType" AS ENUM ('YEAR_2025', 'YEAR_2024', 'NEW_UZBEKISTAN');

CREATE TABLE "MkdRecord" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "type" "MkdType" NOT NULL,
    "targetDate" DATE NOT NULL,
    "totalBuildings" INTEGER NOT NULL,
    "completedBuildings" INTEGER NOT NULL,
    "plannedBuildings" INTEGER NOT NULL,
    "completedAgainstPlan" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MkdRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MkdRecord_totalBuildings_nonnegative" CHECK ("totalBuildings" >= 0),
    CONSTRAINT "MkdRecord_completedBuildings_range" CHECK ("completedBuildings" >= 0 AND "completedBuildings" <= "totalBuildings"),
    CONSTRAINT "MkdRecord_plannedBuildings_range" CHECK ("plannedBuildings" >= 0 AND "plannedBuildings" <= "totalBuildings"),
    CONSTRAINT "MkdRecord_completedAgainstPlan_range" CHECK ("completedAgainstPlan" >= 0 AND "completedAgainstPlan" <= "plannedBuildings" AND "completedAgainstPlan" <= "completedBuildings")
);

CREATE UNIQUE INDEX "MkdRecord_districtId_type_targetDate_key" ON "MkdRecord"("districtId", "type", "targetDate");
CREATE INDEX "MkdRecord_targetDate_idx" ON "MkdRecord"("targetDate");
ALTER TABLE "MkdRecord" ADD CONSTRAINT "MkdRecord_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
