import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.getOrThrow('AWS_S3_BUCKET_NAME');
    this.publicUrl = this.configService.getOrThrow('S3_PUBLIC_URL');

    this.s3Client = new S3Client({
      endpoint: this.configService.getOrThrow('S3_ENDPOINT'),
      region: this.configService.getOrThrow('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.getOrThrow('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
      forcePathStyle: true, // Importante para compatibilidade com alguns providers
    });
  }

  async uploadFile(file: Express.Multer.File, path: string): Promise<string> {
    const randomName = randomBytes(16).toString('hex');
    const extension = file.originalname.split('.').pop();
    
    // O 'Key' (caminho interno no bucket) continua o mesmo: 'drivers/...'
    const fileName = `${path}/${randomName}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    try {
      await this.s3Client.send(command);
      
      // --- CORREÇÃO AQUI ---
      // Verificamos se a URL pública já termina com o nome do bucket.
      // Se não terminar, adicionamos o nome do bucket na URL retornada.
      // Isso garante o formato: https://...r2.dev/drivead-storage/drivers/...
      
      // Remove barra final se houver para evitar duplicidade
      const cleanPublicUrl = this.publicUrl.replace(/\/$/, '');
      
      // Se a URL pública já incluir o bucket, não adiciona de novo
      if (cleanPublicUrl.endsWith(this.bucketName)) {
          return `${cleanPublicUrl}/${fileName}`;
      }

      return `${cleanPublicUrl}/${this.bucketName}/${fileName}`;
      // ---------------------

    } catch (error) {
      this.logger.error(`Erro ao fazer upload para S3: ${error.message}`, error);
      throw error;
    }
  }
}