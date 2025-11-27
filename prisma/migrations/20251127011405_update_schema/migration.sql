/*
  Warnings:

  - You are about to drop the column `billingInfo` on the `Advertiser` table. All the data in the column will be lost.
  - You are about to drop the column `companyName` on the `Advertiser` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Advertiser` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[cnpj]` on the table `Advertiser` will be added. If there are existing duplicate values, this will fail.
  - Made the column `cnpj` on table `Advertiser` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('PJ', 'MEI', 'AGENCIA', 'PROFISSIONAL_LIBERAL');

-- CreateEnum
CREATE TYPE "AdvertiserRole" AS ENUM ('ADMINISTRADOR', 'GESTOR_MARKETING', 'FINANCEIRO', 'OPERACIONAL');

-- CreateEnum
CREATE TYPE "PermissionLevel" AS ENUM ('ADMIN', 'MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "DocValidationStatus" AS ENUM ('PENDENTE', 'APROVADO', 'REPROVADO');

-- DropForeignKey
ALTER TABLE "public"."Advertiser" DROP CONSTRAINT "Advertiser_userId_fkey";

-- DropIndex
DROP INDEX "public"."Advertiser_userId_key";

-- AlterTable
ALTER TABLE "Advertiser" DROP COLUMN "billingInfo",
DROP COLUMN "companyName",
DROP COLUMN "userId",
ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "budgetLimit" DOUBLE PRECISION,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "docCartaoCnpjUrl" TEXT,
ADD COLUMN     "docContratoSocialUrl" TEXT,
ADD COLUMN     "docResponsavelUrl" TEXT,
ADD COLUMN     "estado" TEXT,
ADD COLUMN     "isAgencyMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "razaoSocial" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "segmento" TEXT,
ADD COLUMN     "type" "CompanyType",
ADD COLUMN     "validationStatus" "DocValidationStatus" NOT NULL DEFAULT 'PENDENTE',
ALTER COLUMN "cnpj" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "advertiserId" TEXT,
ADD COLUMN     "lastLogin" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "permissionLevel" "PermissionLevel",
ADD COLUMN     "teamRole" "AdvertiserRole";

-- CreateIndex
CREATE UNIQUE INDEX "Advertiser_cnpj_key" ON "Advertiser"("cnpj");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Advertiser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
