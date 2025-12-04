import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as admin from 'firebase-admin';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class NotificationsService {
  private logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    // Inicializa o Firebase se ainda não estiver
    if (!admin.apps.length) {
      const serviceAccountBase64 = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');
      if (serviceAccountBase64) {
        const serviceAccount = JSON.parse(Buffer.from(serviceAccountBase64, 'base64').toString('utf-8'));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        this.logger.warn('Firebase Service Account não configurada. Notificações Push não funcionarão.');
      }
    }
  }

  /**
   * Salva o token FCM do dispositivo do usuário.
   * O Front deve chamar isso logo após o login.
   */
  async registerDeviceToken(userId: string, token: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken: token },
    });
  }

  /**
   * Envia uma notificação (Push + Banco).
   */
  async sendNotification(userId: string, title: string, body: string, data?: any) {
    // 1. Salva no Banco (Histórico)
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        title,
        body,
        data: data || {},
      },
    });

    // 2. Tenta enviar o Push via Firebase
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    
    if (user?.fcmToken) {
      try {
        await admin.messaging().send({
          token: user.fcmToken,
          notification: {
            title,
            body,
          },
          data: {
            // Firebase data deve ser tudo string
            ...Object.keys(data || {}).reduce((acc, key) => {
              acc[key] = String(data[key]);
              return acc;
            }, {}),
            notificationId: notification.id, // Para marcar como lida ao clicar
          },
        });
        this.logger.log(`Push enviado para user ${userId}`);
      } catch (error) {
        this.logger.error(`Erro ao enviar Push para user ${userId}`, error);
        // Opcional: Se o erro for "token inválido", limpar o fcmToken do usuário
      }
    }

    return notification;
  }

  /**
   * Lista notificações do usuário.
   */
  async getUserNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Marca como lida.
   */
  async markAsRead(userId: string, notificationId: string) {
    // Verifica se pertence ao usuário
    const notif = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notif || notif.userId !== userId) return;

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }
}