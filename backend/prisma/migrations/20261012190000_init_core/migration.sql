-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REPUBLIC_EMPLOYEE', 'REGIONAL_EMPLOYEE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupLeaderAssignmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "engineerCount" INTEGER,
    "republicEmployeeAssignmentId" TEXT,
    "regionalEmployeeAssignmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeRegionAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeRegionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_groupLeaderAssignmentId_id_key" ON "Region"("groupLeaderAssignmentId", "id");

-- CreateIndex
CREATE INDEX "District_regionId_idx" ON "District"("regionId");

-- CreateIndex
CREATE INDEX "District_republicEmployeeAssignmentId_regionId_idx" ON "District"("republicEmployeeAssignmentId", "regionId");

-- CreateIndex
CREATE INDEX "District_regionalEmployeeAssignmentId_regionId_idx" ON "District"("regionalEmployeeAssignmentId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "District_name_regionId_key" ON "District"("name", "regionId");

-- CreateIndex
CREATE INDEX "EmployeeRegionAssignment_regionId_idx" ON "EmployeeRegionAssignment"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRegionAssignment_userId_regionId_key" ON "EmployeeRegionAssignment"("userId", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRegionAssignment_id_regionId_key" ON "EmployeeRegionAssignment"("id", "regionId");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_groupLeaderAssignmentId_id_fkey" FOREIGN KEY ("groupLeaderAssignmentId", "id") REFERENCES "EmployeeRegionAssignment"("id", "regionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_republicEmployeeAssignmentId_regionId_fkey" FOREIGN KEY ("republicEmployeeAssignmentId", "regionId") REFERENCES "EmployeeRegionAssignment"("id", "regionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_regionalEmployeeAssignmentId_regionId_fkey" FOREIGN KEY ("regionalEmployeeAssignmentId", "regionId") REFERENCES "EmployeeRegionAssignment"("id", "regionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRegionAssignment" ADD CONSTRAINT "EmployeeRegionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRegionAssignment" ADD CONSTRAINT "EmployeeRegionAssignment_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

