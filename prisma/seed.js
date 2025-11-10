"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('Iniciando o script de seed...');
    const adminPhone = '+5511999998888';
    const adminName = 'Administrador DriveAd';
    const adminUser = await prisma.user.upsert({
        where: { phone: adminPhone },
        update: {
            role: client_1.Role.admin,
        },
        create: {
            phone: adminPhone,
            name: adminName,
            role: client_1.Role.admin,
        },
    });
    console.log(`Utilizador administrador (${adminUser.name}) foi criado/atualizado com sucesso.`);
    const advertiserPhone = '+5571988887777';
    const advertiserName = 'Anunciante Padrão';
    const advertiserUser = await prisma.user.upsert({
        where: { phone: advertiserPhone },
        update: {
            role: client_1.Role.advertiser,
        },
        create: {
            phone: advertiserPhone,
            name: advertiserName,
            role: client_1.Role.advertiser,
        },
    });
    console.log(`Utilizador anunciante (${advertiserUser.name}) foi criado/atualizado com sucesso.`);
    console.log('Seed finalizado.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map