import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

@Injectable()
export class StorageService {
    private readonly s3Client: S3Client;
    private readonly bucketName: string;
    private readonly endpoint: string;

    constructor(private configService: ConfigService) {
        this.bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
        this.endpoint = this.configService.getOrThrow('S3_ENDPOINT');

        this.s3Client = new S3Client({
            endpoint: this.endpoint,
            region: this.configService.getOrThrow('AWS_REGION'),
            credentials: {
                accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
                secretAccessKey: this.configService.getOrThrow('AWS_SECRET_ACCESS_KEY'),
            },
            forcePathStyle: true, // Essencial para o MinIO
        });
    }

    async uploadFile(file: Express.Multer.File, path: string): Promise<string> {
        const randomName = randomBytes(16).toString('hex');
        const extension = file.originalname.split('.').pop();
        const fileName = `${path}/${randomName}.${extension}`;

        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: 'public-read', // Torna o ficheiro publicamente acessível
        });

        await this.s3Client.send(command);

        // Retorna a URL pública do ficheiro
        return `${this.endpoint}/${this.bucketName}/${fileName}`;
    }
}