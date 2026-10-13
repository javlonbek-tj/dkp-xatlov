-- "Objects completed in a day" duplicated the migration count; keep any value entered only in the dropped column.
UPDATE "XatlovRecord" SET "migrationCount" = "dailyCompletedObjects"
WHERE "migrationCount" = 0 AND "dailyCompletedObjects" > 0;

ALTER TABLE "XatlovRecord" DROP COLUMN "dailyCompletedObjects";
