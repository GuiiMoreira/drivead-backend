import {
    PrismaClient,
    Role,
    CampaignStatus,
    CampaignType,
    VehicleCategory,
    KycStatus
} from '@prisma/client';

const prisma = new PrismaClient();

// Coordenadas fictícias de Salvador para o GeoJSON
const SALVADOR_AREA = {
    type: "Polygon",
    coordinates: [
        [
            [-38.5324, -13.0146],
            [-38.4393, -12.9174],
            [-38.3981, -12.9580],
            [-38.4912, -13.0552],
            [-38.5324, -13.0146]
        ]
    ]
};

async function main() {
    console.log('🗑️  Limpando banco de dados...');

    // A ordem de deleção importa devido às chaves estrangeiras (Foreign Keys)
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
    await prisma.advertiser.deleteMany();
    await prisma.otpChallenge.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany(); // Usuários por último

    console.log('✅ Banco de dados limpo.');
    console.log('🌱 Iniciando seed...');

    // ==================================================================
    // 1. ADMINISTRADOR
    // ==================================================================
    const adminUser = await prisma.user.create({
        data: {
            phone: '+5571992036561', // Seu número
            name: 'Super Admin',
            role: Role.admin,
        },
    });
    console.log(`👤 Admin criado: ${adminUser.name}`);

    // ==================================================================
    // 2. ANUNCIANTES E CAMPANHAS
    // ==================================================================

    // --- Anunciante 1: Burger King (Varejo) ---
    const advertiser1User = await prisma.user.create({
        data: {
            phone: '+5571999991111',
            name: 'Marketing Burger King',
            role: Role.advertiser,
            advertiser: {
                create: {
                    companyName: 'Burger King Brasil',
                    cnpj: '12.345.678/0001-90',
                }
            }
        },
        include: { advertiser: true } // Retorna o perfil criado
    });

    // Campanha 1: Promoção Whopper (ATIVA e POPULAR)
    await prisma.campaign.create({
        data: {
            advertiserId: advertiser1User.advertiser!.id,
            title: 'Promoção Whopper em Dobro',
            type: CampaignType.commercial,
            status: CampaignStatus.active, // <--- ATIVA, aparecerá para o motorista
            budget: 15000.00,
            numCars: 20,
            startAt: new Date(),
            endAt: new Date(new Date().setDate(new Date().getDate() + 30)), // +30 dias
            areaGeojson: SALVADOR_AREA,
            creativeUrl: 'https://fake-url.com/creative-bk.jpg',
            requirements: {
                targetCategory: VehicleCategory.ESSENTIAL, // Aceita qualquer carro
                minKmPerDay: 30
            }
        }
    });
    console.log(`📢 Anunciante 1 criado com 1 campanha ativa.`);

    // --- Anunciante 2: Vivara (Luxo) ---
    const advertiser2User = await prisma.user.create({
        data: {
            phone: '+5571999992222',
            name: 'Gestão Vivara',
            role: Role.advertiser,
            advertiser: {
                create: {
                    companyName: 'Vivara Joias',
                    cnpj: '98.765.432/0001-10',
                }
            }
        },
        include: { advertiser: true }
    });

    // Campanha 2: Coleção Primavera (RASCUNHO - Aguardando Pagamento)
    await prisma.campaign.create({
        data: {
            advertiserId: advertiser2User.advertiser!.id,
            title: 'Coleção Primavera 2025',
            type: CampaignType.commercial,
            status: CampaignStatus.draft, // <--- RASCUNHO, não deve aparecer para motorista
            budget: 50000.00,
            numCars: 10,
            startAt: new Date(),
            endAt: new Date(new Date().setDate(new Date().getDate() + 45)),
            areaGeojson: SALVADOR_AREA,
            requirements: {
                targetCategory: VehicleCategory.PRIME, // Apenas carros de luxo
            }
        }
    });

    // Campanha 3: Black Friday (ATIVA e INTERMEDIÁRIA)
    await prisma.campaign.create({
        data: {
            advertiserId: advertiser2User.advertiser!.id,
            title: 'Black Friday Vivara',
            type: CampaignType.commercial,
            status: CampaignStatus.active, // <--- ATIVA
            budget: 30000.00,
            numCars: 15,
            startAt: new Date(),
            endAt: new Date(new Date().setDate(new Date().getDate() + 15)),
            areaGeojson: SALVADOR_AREA,
            creativeUrl: 'https://fake-url.com/creative-vivara.jpg',
            requirements: {
                targetCategory: VehicleCategory.SMART, // Carros médios e acima
            }
        }
    });
    console.log(`📢 Anunciante 2 criado com 2 campanhas.`);

    // ==================================================================
    // 3. MOTORISTA VERIFICADO
    // ==================================================================
    const driverUser = await prisma.user.create({
        data: {
            phone: '+5571988887777', // Use este número para testar o login de motorista
            name: 'João Motorista',
            role: Role.driver,
        }
    });

    await prisma.driver.create({
        data: {
            userId: driverUser.id,
            cpf: '111.222.333-44',
            cnh: '12345678900',
            kycStatus: KycStatus.approved, // <--- JÁ APROVADO
            optInPolitical: true, // Aceita campanhas políticas
            vehicles: {
                create: {
                    plate: 'DRV-2025',
                    model: 'Toyota Corolla',
                    year: 2022,
                    color: 'Preto',
                    category: VehicleCategory.SMART, // Categoria Intermediária (Vê campanhas Smart e Essential)
                }
            },
            // Criar carteira zerada
            wallet: {
                create: {
                    balance: 0
                }
            }
        }
    });

    console.log(`🚗 Motorista verificado criado: ${driverUser.name} (${driverUser.phone})`);
    console.log('✅ Seed finalizado com sucesso!');
}

main()
    .catch((e) => {
        console.error(e);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });