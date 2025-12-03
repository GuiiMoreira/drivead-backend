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
  DocValidationStatus,
  ProofRequestStatus,
  TransactionType,
  TransactionStatus,
  ApprovalStatus // Importante para as provas
} from '@prisma/client';

const prisma = new PrismaClient();

// --- Helpers para dados aleatórios ---
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomElement = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const generatePhone = () => `+55719${randomInt(10000000, 99999999)}`;
const generateCNPJ = () => `${randomInt(10, 99)}.${randomInt(100, 999)}.${randomInt(100, 999)}/0001-${randomInt(10, 99)}`;
const generateCPF = () => `${randomInt(100, 999)}.${randomInt(100, 999)}.${randomInt(100, 999)}-${randomInt(10, 99)}`;

// Área de Salvador para GeoJSON
const SALVADOR_AREA = {
  type: "Polygon",
  coordinates: [[
    [-38.5324, -13.0146], [-38.4393, -12.9174], [-38.3981, -12.9580], [-38.4912, -13.0552], [-38.5324, -13.0146]
  ]]
};

// Coordenadas base para gerar pings em Salvador
const SSA_LAT_BASE = -12.97;
const SSA_LON_BASE = -38.50;

const SEGMENTOS = ['Varejo', 'Alimentação', 'Serviços', 'Educação', 'Saúde', 'Tecnologia', 'Imobiliário'];
const BAIRROS_SSA = ['Barra', 'Pituba', 'Rio Vermelho', 'Itapuã', 'Brotas', 'Cajazeiras', 'Campo Grande', 'Horto Florestal'];
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
  await prisma.walletTransaction.deleteMany();
  await prisma.driverWallet.deleteMany();
  await prisma.dailyAssignmentMetric.deleteMany();
  await prisma.periodicProof.deleteMany();
  await prisma.installProof.deleteMany();
  await prisma.position.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.assignment.deleteMany(); // Deleta atribuições antes de campanhas e motoristas
  await prisma.campaign.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.kycDocument.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany(); 
  await prisma.advertiser.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.auditLog.deleteMany();
  
  console.log('✅ Banco limpo. 🌱 Iniciando seed...');

  // ==================================================================
  // 1. SUPER ADMIN
  // ==================================================================
  const adminUser = await prisma.user.create({
    data: {
      phone: '+5571992036561', // Seu número de admin
      name: 'Super Admin',
      role: Role.admin,
    },
  });
  console.log(`👤 Admin criado: ${adminUser.name}`);

  // ==================================================================
  // 2. ANUNCIANTES (10 Empresas Variadas)
  // ==================================================================
  const advertisers = [];
  
  // Criar Anunciante Principal para Teste (Você)
  const myAdvertiser = await createAdvertiserCompany(
    'Minha Empresa Teste', 
    '+5571988887777', // Número para testar login de anunciante
    'Varejo'
  );
  advertisers.push(myAdvertiser);

  // Criar outros 9 aleatórios
  for (let i = 1; i <= 9; i++) {
    const companyName = `Empresa ${SEGMENTOS[i % SEGMENTOS.length]} ${i}`;
    const adv = await createAdvertiserCompany(companyName, generatePhone(), SEGMENTOS[i % SEGMENTOS.length]);
    advertisers.push(adv);
  }
  console.log(`🏢 10 Empresas Anunciantes criadas.`);

  // ==================================================================
  // 3. CAMPANHAS (20 Variadas)
  // ==================================================================
  const campaigns = [];
  const statuses = Object.values(CampaignStatus);
  const categories = Object.values(VehicleCategory);

  for (let i = 0; i < 20; i++) {
    const advertiser = randomElement(advertisers);
    
    // Distribuição de status para teste:
    // 0-7: Active (Para ver no dashboard)
    // 8-9: Pending Approval (Para testar moderação)
    // 10-11: Rejected (Para histórico)
    // 12-14: Draft (Rascunhos)
    // 15+: Aleatório
    let status = randomElement(statuses);
    if (i < 8) status = CampaignStatus.active;
    else if (i < 10) status = CampaignStatus.pending_approval;
    else if (i < 12) status = CampaignStatus.rejected;
    else if (i < 15) status = CampaignStatus.draft;

    const targetCategory = randomElement(categories);
    const daysDuration = randomInt(30, 90);
    
    const campaign = await prisma.campaign.create({
      data: {
        advertiserId: advertiser.id,
        title: `Campanha ${status === 'active' ? 'VERÃO' : 'TESTE'} - ${targetCategory} ${i+1}`,
        type: Math.random() > 0.8 ? CampaignType.political : CampaignType.commercial,
        status: status,
        budget: randomInt(5000, 50000),
        numCars: randomInt(5, 50),
        startAt: new Date(),
        endAt: new Date(new Date().setDate(new Date().getDate() + daysDuration)),
        durationDays: daysDuration, // Duração individual do contrato do motorista
        areaGeojson: SALVADOR_AREA,
        creativeUrl: `https://picsum.photos/seed/${i}/800/400`, // Placeholder de imagem
        requirements: {
          targetCategory: targetCategory,
          minKmPerDay: randomInt(20, 60),
          exposureLevel: 'HIGH'
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
  // APROVADO, Carro Smart, Pronto para rodar
  const myDriver = await createDriverUser(
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
    
    // Distribuição de status KYC:
    // 15-19: Pending (Para testar aprovação de motorista)
    // Outros: Approved
    const kyc = i > 14 ? KycStatus.pending : KycStatus.approved; 

    const driver = await createDriverUser(
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
  // 5. MATCHMAKING, RASTREAMENTO E FINANCEIRO (Dados Reais)
  // ==================================================================
  const activeCampaigns = campaigns.filter(c => c.status === CampaignStatus.active);
  const approvedDrivers = drivers.filter(d => d.kycStatus === KycStatus.approved);

  let assignmentsCount = 0;

  // Vamos popular dados para as campanhas ativas
  for (const campaign of activeCampaigns) {
    // Pegar aleatoriamente 1 a 3 motoristas APROVADOS para esta campanha
    // (Simula que eles se candidataram e foram aceites)
    const numDriversToAssign = Math.min(approvedDrivers.length, randomInt(1, 3));
    const driversToAssign = approvedDrivers.splice(0, numDriversToAssign); // Remove do pool para não repetir muito
    
    for (const driver of driversToAssign) {
      const payoutValue = (campaign.budget / campaign.numCars) * 0.6; // 60% do valor unitário

      // 5.1 Criar Assignment (Atribuição Ativa)
      const assignment = await prisma.assignment.create({
        data: {
          campaignId: campaign.id,
          driverId: driver.id,
          vehicleId: driver.vehicles[0].id,
          status: AssignmentStatus.active, // Já rodando
          priceAgreed: payoutValue,
          payoutAmount: payoutValue,
          installedAt: new Date(new Date().setDate(new Date().getDate() - randomInt(5, 20))), // Instalado há 5-20 dias
          proofStatus: ProofRequestStatus.NONE
        }
      });

      // 5.2 Gerar Métricas Diárias (Para os gráficos do dashboard)
      // Gera dados dos últimos 7 dias
      for (let d = 0; d < 7; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        date.setHours(0,0,0,0);
        
        await prisma.dailyAssignmentMetric.create({
          data: {
            assignmentId: assignment.id,
            date: date,
            kilometersDriven: randomInt(20, 100) + Math.random(), // KM aleatório
            timeInMotionSeconds: randomInt(3600, 20000) // Tempo aleatório
          }
        });
      }

      // 5.3 Gerar Posição "Ao Vivo" (Para o Mapa de Monitoramento em Tempo Real)
      // Gera uma lat/lon próxima ao centro de Salvador com pequena variação
      const lat = SSA_LAT_BASE + (Math.random() * 0.05 - 0.025);
      const lon = SSA_LON_BASE + (Math.random() * 0.05 - 0.025);
      
      await prisma.position.create({
        data: {
          assignmentId: assignment.id,
          driverId: driver.id,
          lat: lat,
          lon: lon,
          speed: randomInt(20, 60),
          ts: new Date(), // Agora (Online)
        }
      });

      // 5.4 Simular Financeiro (Carteira e Saque Pendente)
      // Se o ID do motorista for par (apenas alguns), simulamos que ele tem saldo
      // Convertemos parte do ID (uuid) para número para checar paridade
      if (driver.id.charCodeAt(0) % 2 === 0) {
        
        // 1. Cria carteira com saldo
        await prisma.driverWallet.update({
          where: { driverId: driver.id },
          data: { balance: payoutValue } // Saldo inicial (antes do saque)
        });
        
        const wallet = await prisma.driverWallet.findUnique({ where: { driverId: driver.id } });
        
        // 2. Regista o crédito (Pagamento da campanha anterior fictícia)
        await prisma.walletTransaction.create({
          data: {
            walletId: wallet!.id,
            amount: payoutValue,
            type: TransactionType.CREDIT,
            status: TransactionStatus.COMPLETED,
            description: `Campanha Anterior (Simulada)`
          }
        });

        // 3. Solicita saque de metade do valor (Débito Pendente para o Admin aprovar)
        await prisma.walletTransaction.create({
          data: {
            walletId: wallet!.id,
            amount: -(payoutValue / 2),
            type: TransactionType.DEBIT,
            status: TransactionStatus.PENDING, // <--- Para aparecer na lista de saques pendentes
            description: 'Solicitação de saque PIX'
          }
        });
        
        // 4. Atualiza saldo final (desconta o saque pendente)
        await prisma.driverWallet.update({
            where: { driverId: driver.id },
            data: { balance: { decrement: payoutValue / 2 } }
        });
      }

      assignmentsCount++;
    }
    
    // Devolve os motoristas ao pool se quiser reutilizar (opcional)
    // approvedDrivers.push(...driversToAssign);
  }

  console.log(`🔗 ${assignmentsCount} Atribuições criadas com Métricas, Posições e Financeiro.`);
  console.log('✅ Seed finalizado com sucesso!');
}

// --- FUNÇÕES AUXILIARES ---

async function createAdvertiserCompany(name: string, phone: string, segmento: string) {
  // Cria a EMPRESA (Advertiser)
  const advertiser = await prisma.advertiser.create({
    data: {
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
      validationStatus: DocValidationStatus.APROVADO,
      // Cria o usuário ADMIN da empresa junto
      users: {
        create: {
          phone: phone,
          name: `Gestor ${name}`,
          role: Role.advertiser,
          teamRole: AdvertiserRole.ADMINISTRADOR,
          permissionLevel: PermissionLevel.ADMIN
        }
      }
    },
    include: { users: true } // Retorna com usuários para pegar o ID se precisar
  });
  
  return advertiser;
}

async function createDriverUser(name: string, phone: string, category: VehicleCategory, model: string, kycStatus: KycStatus) {
  // Cria o User primeiro
  const user = await prisma.user.create({
    data: {
      phone,
      name,
      role: Role.driver
    }
  });

  // Cria o Driver vinculado
  return prisma.driver.create({
    data: {
      userId: user.id,
      cpf: generateCPF(),
      cnh: `${randomInt(10000000000, 99999999999)}`,
      kycStatus: kycStatus,
      optInPolitical: Math.random() > 0.5,
      // Documentos dummy para o admin ver (usando placeholders visuais)
      kycDocuments: {
        create: [
          { docType: 'cnhFront', fileUrl: 'https://placehold.co/600x400/png?text=CNH+Frente' },
          { docType: 'selfie', fileUrl: 'https://placehold.co/400x400/png?text=Selfie' }
        ]
      },
      vehicles: {
        create: {
          plate: `ABC-${randomInt(1000, 9999)}`,
          model: model,
          year: randomInt(2018, 2024),
          color: randomElement(['Branco', 'Preto', 'Prata', 'Vermelho']),
          category: category,
        }
      },
      // Cria carteira vazia inicial (será populada se for sorteado no loop)
      wallet: {
        create: { balance: 0 }
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