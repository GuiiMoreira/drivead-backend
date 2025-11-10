-- CreateEnum
CREATE TYPE "ProofRequestStatus" AS ENUM ('NONE', 'PENDING_RANDOM');

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "proofStatus" "ProofRequestStatus" NOT NULL DEFAULT 'NONE';
