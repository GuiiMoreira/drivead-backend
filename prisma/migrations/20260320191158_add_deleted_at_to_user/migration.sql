-- AlterEnum
ALTER TYPE "KycStatus" ADD VALUE 'incomplete';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);