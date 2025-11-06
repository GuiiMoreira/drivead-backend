-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "status" "TransactionStatus" NOT NULL DEFAULT 'COMPLETED';
