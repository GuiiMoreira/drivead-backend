-- CreateEnum
CREATE TYPE "PixKeyType" AS ENUM ('CPF', 'PHONE', 'EMAIL', 'RANDOM');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "pixKey" TEXT,
ADD COLUMN     "pixKeyType" "PixKeyType";
