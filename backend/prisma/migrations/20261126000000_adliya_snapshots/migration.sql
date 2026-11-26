-- CreateTable
CREATE TABLE "AdliyaSnapshot" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "morning" BOOLEAN NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "inPublic" INTEGER NOT NULL,
    "inAdliya" INTEGER NOT NULL,
    "inPayment" INTEGER NOT NULL,
    "returned" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdliyaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdliyaSnapshot_recordDate_idx" ON "AdliyaSnapshot"("recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "AdliyaSnapshot_districtId_recordDate_morning_key" ON "AdliyaSnapshot"("districtId", "recordDate", "morning");

-- AddForeignKey
ALTER TABLE "AdliyaSnapshot" ADD CONSTRAINT "AdliyaSnapshot_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

