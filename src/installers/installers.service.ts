import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInstallerDto } from './dto/create-installer.dto';

@Injectable()
export class InstallersService {
    constructor(private prisma: PrismaService) { }

    create(createInstallerDto: CreateInstallerDto) {
        return this.prisma.installer.create({
            data: {
                companyName: createInstallerDto.companyName,
                phone: createInstallerDto.phone,
                address: createInstallerDto.address,
                areas: createInstallerDto.areas,
                priceInstall: createInstallerDto.priceInstall,
            },
        });
    }

    findAll() {
        return this.prisma.installer.findMany();
    }
}