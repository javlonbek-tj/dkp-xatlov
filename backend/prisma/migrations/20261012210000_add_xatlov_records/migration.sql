CREATE TABLE "XatlovRecord" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "completedMfyCount" INTEGER NOT NULL,
    "censusCount" INTEGER NOT NULL,
    "migrationCount" INTEGER NOT NULL,
    "completedMfyNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nearingCompletionMfyNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "XatlovRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "XatlovRecord_districtId_recordDate_key" ON "XatlovRecord"("districtId", "recordDate");
CREATE INDEX "XatlovRecord_recordDate_idx" ON "XatlovRecord"("recordDate");
ALTER TABLE "XatlovRecord" ADD CONSTRAINT "XatlovRecord_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
