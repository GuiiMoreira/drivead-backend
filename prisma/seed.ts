import { PrismaClient, Role } from '@prisma/client';

// Instancia o Prisma Client
const prisma = new PrismaClient();

async function main() {
    console.log('Iniciando o script de seed...');

    // --- 1. CRIAR/ATUALIZAR UTILIZADOR ADMINISTRADOR ---
    const adminPhone = '+5511999998888'; // <-- Mantenha ou altere o seu número de admin
    const adminName = 'Administrador DriveAd';

    const adminUser = await prisma.user.upsert({
        where: { phone: adminPhone },
        update: {
            role: Role.admin,
        },
        create: {
            phone: adminPhone,
            name: adminName,
            role: Role.admin,
        },
    });

    console.log(`Utilizador administrador (${adminUser.name}) foi criado/atualizado com sucesso.`);

    // --- 2. CRIAR/ATUALIZAR UTILIZADOR ANUNCIANTE ---
    const advertiserPhone = '+5571988887777'; // <-- MUDE PARA O NÚMERO QUE USARÁ PARA TESTAR O ANUNCIANTE
    const advertiserName = 'Anunciante Padrão';

    const advertiserUser = await prisma.user.upsert({
        where: { phone: advertiserPhone },
        update: {
            role: Role.advertiser,
        },
        create: {
            phone: advertiserPhone,
            name: advertiserName,
            role: Role.advertiser,
        },
    });

    console.log(`Utilizador anunciante (${advertiserUser.name}) foi criado/atualizado com sucesso.`);


    console.log('Seed finalizado.');
}

// Executa a função principal e gere erros
main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        // Fecha a conexão com o banco de dados
        await prisma.$disconnect();
    });