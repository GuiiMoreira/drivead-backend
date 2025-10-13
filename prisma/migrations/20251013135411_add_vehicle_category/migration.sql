-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('ESSENTIAL', 'SMART', 'PRIME', 'PRO', 'ECO');

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "category" "VehicleCategory" NOT NULL DEFAULT 'ESSENTIAL';
