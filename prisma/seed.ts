import {
  PrismaClient,
  Role,
  CompanyType,
  AdvertiserRole,
  PermissionLevel,
  DocValidationStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️ Limpando banco...');

  // Ordem respeitando FKs
  await prisma.walletTransaction.deleteMany();
  await prisma.driverWallet.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.kycDocument.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany();
  await prisma.advertiser.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.auditLog.deleteMany();

  console.log('✅ Banco limpo.');

  // =====================================================
  // 1️⃣ ADMINS
  // =====================================================

  const admins = await prisma.user.createMany({
    data: [
      {
        phone: '+5513997295671',
        name: 'Jorge',
        role: Role.admin,
      },
      {
        phone: '+5571991718274',
        name: 'João Paulo',
        role: Role.admin,
      },
      {
        phone: '+5571992036561',
        name: 'Guilherme',
        role: Role.admin,
      },
    ],
  });

  console.log('👤 3 Admins criados.');

  // =====================================================
  // 2️⃣ GRÁFICA (ANUNCIANTE PJ)
  // =====================================================

  const grafica = await prisma.advertiser.create({
    data: {
      type: CompanyType.PJ,
      cnpj: '12.345.678/0001-99',
      razaoSocial: 'Grafica Modelo LTDA',
      nomeFantasia: 'Grafica Modelo',
      segmento: 'Gráfica',
      logradouro: 'Av. Industrial',
      numero: '100',
      bairro: 'Centro',
      cidade: 'Salvador',
      estado: 'BA',
      cep: '40000-000',
      validationStatus: DocValidationStatus.APROVADO,

      users: {
        create: {
          phone: '+5571888888888',
          name: 'Administrador Grafica',
          role: Role.advertiser,
          teamRole: AdvertiserRole.ADMINISTRADOR,
          permissionLevel: PermissionLevel.ADMIN,
        },
      },
    },
    include: {
      users: true,
    },
  });

  console.log('🏢 Gráfica criada:', grafica.nomeFantasia);

  console.log('🌱 Seed finalizado com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });