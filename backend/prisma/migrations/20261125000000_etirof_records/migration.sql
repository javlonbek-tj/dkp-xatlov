-- CreateTable
CREATE TABLE "EtirofRecord" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "recordDate" DATE NOT NULL,
    "toPublic" INTEGER NOT NULL,
    "toAdliya" INTEGER NOT NULL,
    "adliyaToPayment" INTEGER NOT NULL,
    "editToAdliya" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL,
    "dayAsOf" TIMESTAMP(3),
    "kengashTotal" INTEGER NOT NULL,
    "kengashInTerm" INTEGER NOT NULL,
    "kengashOver90" INTEGER NOT NULL,
    "kengashAsOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtirofRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EtirofRecord_recordDate_idx" ON "EtirofRecord"("recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "EtirofRecord_districtId_recordDate_key" ON "EtirofRecord"("districtId", "recordDate");

-- AddForeignKey
ALTER TABLE "EtirofRecord" ADD CONSTRAINT "EtirofRecord_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

