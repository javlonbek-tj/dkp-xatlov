-- The delay stage is now chosen manually; existing rows get the stage their deadline implied when migrated.
ALTER TABLE "OverdueApplication" ADD COLUMN "stage" TEXT;

UPDATE "OverdueApplication" SET "stage" = CASE
  WHEN CURRENT_DATE - "deadlineDate" <= 3 THEN '1-3'
  WHEN CURRENT_DATE - "deadlineDate" <= 7 THEN '4-7'
  WHEN CURRENT_DATE - "deadlineDate" <= 14 THEN '8-14'
  WHEN CURRENT_DATE - "deadlineDate" <= 30 THEN '15-30'
  WHEN CURRENT_DATE - "deadlineDate" <= 90 THEN '31-90'
  ELSE '90+'
END;

ALTER TABLE "OverdueApplication" ALTER COLUMN "stage" SET NOT NULL,
ALTER COLUMN "deadlineDate" DROP NOT NULL,
ALTER COLUMN "reason" DROP NOT NULL;
