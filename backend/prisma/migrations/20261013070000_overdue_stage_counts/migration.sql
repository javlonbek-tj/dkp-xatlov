-- Overdue applications are now tracked as dated per-district counts for each delay stage.
CREATE TABLE "OverdueSnapshot" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "stage1to3" INTEGER NOT NULL DEFAULT 0,
    "stage4to7" INTEGER NOT NULL DEFAULT 0,
    "stage8to14" INTEGER NOT NULL DEFAULT 0,
    "stage15to30" INTEGER NOT NULL DEFAULT 0,
    "stage31to90" INTEGER NOT NULL DEFAULT 0,
    "stage90plus" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OverdueSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OverdueSnapshot_districtId_recordDate_key" ON "OverdueSnapshot"("districtId", "recordDate");
CREATE INDEX "OverdueSnapshot_recordDate_idx" ON "OverdueSnapshot"("recordDate");
ALTER TABLE "OverdueSnapshot" ADD CONSTRAINT "OverdueSnapshot_districtId_fkey"
  FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Convert still-open applications into today's (Tashkent) counts per district.
INSERT INTO "OverdueSnapshot" ("id", "districtId", "recordDate", "stage1to3", "stage4to7", "stage8to14", "stage15to30", "stage31to90", "stage90plus", "updatedAt")
SELECT
  gen_random_uuid()::text,
  "districtId",
  (now() AT TIME ZONE 'Asia/Tashkent')::date,
  COUNT(*) FILTER (WHERE "stage" = '1-3'),
  COUNT(*) FILTER (WHERE "stage" = '4-7'),
  COUNT(*) FILTER (WHERE "stage" = '8-14'),
  COUNT(*) FILTER (WHERE "stage" = '15-30'),
  COUNT(*) FILTER (WHERE "stage" = '31-90'),
  COUNT(*) FILTER (WHERE "stage" = '90+'),
  CURRENT_TIMESTAMP
FROM "OverdueApplication"
WHERE "clearedAt" IS NULL
GROUP BY "districtId";

DROP TABLE "OverdueApplication";
