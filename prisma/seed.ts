import {
  PrismaClient,
  Role,
  CampaignStatus,
  CampaignType,
  VehicleCategory,
  KycStatus,
  CompanyType,
  AdvertiserRole,
  PermissionLevel,
  AssignmentStatus,
  DocValidationStatus
} from '@prisma/client';

const prisma = new PrismaClient();

// --- Helpers para gerar dados aleatórios ---
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const generatePhone = () => `+55719${randomInt(10000000, 99999999)}`;
const generateCNPJ = () => `${randomInt(10, 99)}.${randomInt(100, 999)}.${randomInt(100, 999)}/0001-${randomInt(10, 99)}`;
const generateCPF = () => `${randomInt(100, 999)}.${randomInt(100, 999)}.${randomInt(100, 999)}-${randomInt(10, 99)}`;

const SALVADOR_AREA = {
  type: "Polygon",
  coordinates: [[
    [-38.5324, -13.0146], [-38.4393, -12.9174], [-38.3981, -12.9580], [-38.4912, -13.0552], [-38.5324, -13.0146]
  ]]
};

const SEGMENTOS = ['Varejo', 'Alimentação', 'Serviços', 'Educação', 'Saúde', 'Tecnologia', 'Imobiliário'];
const BAIRROS_SSA = ['Barra', 'Pituba', 'Rio Vermelho', 'Itapuã', 'Brotas', 'Cajazeiras', 'Campo Grande'];
const CAR_MODELS = {
  ESSENTIAL: ['Fiat Mobi', 'Renault Kwid', 'VW Gol', 'Hyundai HB20'],
  SMART: ['Toyota Corolla', 'Honda City', 'Jeep Renegade', 'VW T-Cross'],
  PRIME: ['BMW 320i', 'Mercedes C180', 'Audi A3', 'Volvo XC40'],
  PRO: ['Fiat Fiorino', 'Renault Kangoo', 'Táxi Spin'],
  ECO: ['BYD Dolphin', 'GWM Ora', 'Toyota Corolla Hybrid']
};

async function main() {
  console.log('🗑️  Limpando banco de dados...');
  // Ordem de deleção para respeitar Foreign Keys
  await prisma.dailyAssignmentMetric.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.driverWallet.deleteMany();
  await prisma.periodicProof.deleteMany();
  await prisma.installProof.deleteMany();
  await prisma.position.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.kycDocument.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany(); // Deleta usuários e advertisers (via cascade ou manual se necessário)
  await prisma.advertiser.deleteMany();
  
  console.log('✅ Banco limpo. 🌱 Iniciando seed...');

  // ==================================================================
  // 1. SUPER ADMIN
  // ==================================================================
  await prisma.user.create({
    data: {
      phone: '+5571992036561', // Seu número
      name: 'Super Admin',
      role: Role.admin,
    },
  });
  console.log('👤 Admin criado.');

  // ==================================================================
  // 2. ANUNCIANTES (10 Empresas)
  // ==================================================================
  const advertisers = [];
  
  // Criar Anunciante Principal para Teste (Você)
  const myAdvertiserUser = await createAdvertiserWithUser(
    'Minha Empresa Teste', 
    '+5571988887777', // Número para testar login de anunciante
    'Varejo'
  );
  advertisers.push(myAdvertiserUser.advertiser);

  // Criar outros 9 aleatórios
  for (let i = 1; i <= 9; i++) {
    const companyName = `Empresa ${SEGMENTOS[i % SEGMENTOS.length]} ${i}`;
    const result = await createAdvertiserWithUser(companyName, generatePhone(), SEGMENTOS[i % SEGMENTOS.length]);
    advertisers.push(result.advertiser);
  }
  console.log(`🏢 10 Anunciantes criados.`);

  // ==================================================================
  // 3. CAMPANHAS (20 Variadas)
  // ==================================================================
  const campaigns = [];
  const statuses = Object.values(CampaignStatus);
  const categories = Object.values(VehicleCategory);

  for (let i = 0; i < 20; i++) {
    const advertiser = randomElement(advertisers);
    if (!advertiser) continue;

    const status = i < 5 ? CampaignStatus.active : randomElement(statuses); // Garante pelo menos 5 ativas
    const targetCategory = randomElement(categories);
    
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: advertiser.id,
        title: `Campanha ${status} - ${targetCategory} - ${i+1}`,
        type: Math.random() > 0.8 ? CampaignType.political : CampaignType.commercial,
        status: status,
        budget: randomInt(5000, 50000),
        numCars: randomInt(5, 50),
        startAt: new Date(),
        endAt: new Date(new Date().setDate(new Date().getDate() + randomInt(15, 90))),
        areaGeojson: SALVADOR_AREA,
        creativeUrl: `https://picsum.photos/seed/${i}/800/400`, // Imagem aleatória
        requirements: {
          targetCategory: targetCategory,
          minKmPerDay: randomInt(20, 60)
        }
      }
    });
    campaigns.push(campaign);
  }
  console.log(`📢 20 Campanhas criadas.`);

  // ==================================================================
  // 4. MOTORISTAS (20 Variados)
  // ==================================================================
  const drivers = [];
  
  // Criar Motorista Principal para Teste (Você)
  const myDriver = await createDriverWithUser(
    'João Motorista',
    '+5571999998888', // Número para testar login de motorista
    VehicleCategory.SMART,
    'Toyota Corolla',
    KycStatus.approved
  );
  drivers.push(myDriver);

  // Criar outros 19
  for (let i = 1; i <= 19; i++) {
    const category = randomElement(Object.values(VehicleCategory));
    const model = randomElement(CAR_MODELS[category]);
    const kyc = i > 15 ? KycStatus.pending : KycStatus.approved; // Alguns pendentes

    const driver = await createDriverWithUser(
      `Motorista ${i}`,
      generatePhone(),
      category,
      model,
      kyc
    );
    drivers.push(driver);
  }
  console.log(`🚗 20 Motoristas criados.`);

  // ==================================================================
  // 5. MATCHMAKING & DADOS REAIS (Assignments e Métricas)
  // ==================================================================
  // Vamos pegar campanhas ATIVAS e atribuir alguns motoristas APROVADOS
  const activeCampaigns = campaigns.filter(c => c.status === CampaignStatus.active);
  const approvedDrivers = drivers.filter(d => d.kycStatus === KycStatus.approved);

  let assignmentsCount = 0;

  for (const campaign of activeCampaigns) {
    // Atribuir 1 a 3 motoristas por campanha ativa
    const driversToAssign = approvedDrivers.slice(0, randomInt(1, 3));
    
    for (const driver of driversToAssign) {
      // Cria o Assignment
      const assignment = await prisma.assignment.create({
        data: {
          campaignId: campaign.id,
          driverId: driver.id,
          vehicleId: driver.vehicles[0].id, // Pega o primeiro carro
          status: AssignmentStatus.active, // Já rodando
          priceAgreed: campaign.budget / campaign.numCars * 0.6,
          payoutAmount: campaign.budget / campaign.numCars * 0.6,
          installedAt: new Date(new Date().setDate(new Date().getDate() - randomInt(1, 10))), // Instalado há alguns dias
        }
      });

      // Gerar métricas diárias fictícias (para o gráfico não ficar vazio)
      for (let d = 0; d < 5; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        
        await prisma.dailyAssignmentMetric.create({
          data: {
            assignmentId: assignment.id,
            date: date,
            kilometersDriven: randomInt(10, 150) + Math.random(),
            timeInMotionSeconds: randomInt(3600, 18000)
          }
        });
      }
      assignmentsCount++;
    }
    // Rotaciona o array de drivers para distribuir melhor
    approvedDrivers.push(approvedDrivers.shift()!); 
  }

  console.log(`🔗 ${assignmentsCount} Atribuições criadas com métricas fictícias.`);
  console.log('✅ Seed finalizado com sucesso!');
}

// --- FUNÇÕES AUXILIARES ---

async function createAdvertiserWithUser(name: string, phone: string, segmento: string) {
  return prisma.user.create({
    data: {
      phone,
      name,
      role: Role.advertiser,
      advertiser: {
        create: {
          type: CompanyType.PJ,
          cnpj: generateCNPJ(),
          razaoSocial: `${name} LTDA`,
          nomeFantasia: name,
          segmento: segmento,
          logradouro: 'Av. ACM',
          numero: `${randomInt(1, 999)}`,
          bairro: randomElement(BAIRROS_SSA),
          cidade: 'Salvador',
          estado: 'BA',
          cep: '40000-000',
          validationStatus: DocValidationStatus.APROVADO
        }
      }
    },
    include: { advertiser: true }
  });
}

async function createDriverWithUser(name: string, phone: string, category: VehicleCategory, model: string, kycStatus: KycStatus) {
  const user = await prisma.user.create({
    data: {
      phone,
      name,
      role: Role.driver
    }
  });

  return prisma.driver.create({
    data: {
      userId: user.id,
      cpf: generateCPF(),
      cnh: `${randomInt(10000000000, 99999999999)}`,
      kycStatus: kycStatus,
      optInPolitical: Math.random() > 0.5,
      vehicles: {
        create: {
          plate: `ABC-${randomInt(1000, 9999)}`,
          model: model,
          year: randomInt(2018, 2024),
          color: randomElement(['Branco', 'Preto', 'Prata', 'Vermelho']),
          category: category,
        }
      },
      wallet: {
        create: { balance: kycStatus === KycStatus.approved ? randomInt(0, 500) : 0 }
      }
    },
    include: { vehicles: true }
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
