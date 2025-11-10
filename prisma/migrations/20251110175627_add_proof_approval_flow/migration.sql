-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AssignmentStatus" ADD VALUE 'awaiting_approval';

-- AlterTable
ALTER TABLE "InstallProof" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "PeriodicProof" ADD COLUMN     "adminNotes" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING';
