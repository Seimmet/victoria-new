import prisma from '../utils/prisma';
import { emailService } from './emailService';
import { smsService } from './smsService';
import { NotificationType, NotificationChannel } from '@prisma/client';

let cachedRequireApproval: boolean | null = null;

export const notificationQueue = {
  add: async (
    channel: NotificationChannel,
    type: NotificationType,
    recipient: string,
    content: string,
    subject?: string,
    metadata?: any
  ) => {
    try {
      if (cachedRequireApproval === null) {
        const settings = await prisma.salonSettings.findFirst();
        cachedRequireApproval = settings?.requireApproval ?? true;
      }
      const requireApproval = cachedRequireApproval;
      const initialStatus = requireApproval ? 'WAITING_APPROVAL' : 'PENDING';
      await prisma.notification.create({
        data: {
          channel,
          type,
          recipient,
          content,
          subject,
          metadata: metadata || {},
          status: initialStatus as any
        }
      });
      console.log(`[Queue] Added ${channel} notification (${type}) for ${recipient} (Status: ${initialStatus})`);
    } catch (error) {
      console.error('Error adding notification to queue:', error);
    }
  },

  processQueue: async (limit = 20) => {
    const pending = await prisma.notification.findMany({
      where: {
        status: 'PENDING',
        retryCount: { lt: 3 }
      },
      take: limit,
      orderBy: { createdAt: 'asc' }
    });
    if (pending.length === 0) {
      return { processed: 0, errors: 0 };
    }
    console.log(`[Queue] Processing ${pending.length} notifications...`);
    let processedCount = 0;
    let errorCount = 0;
    for (const notification of pending) {
      try {
        if (notification.channel === 'EMAIL') {
          if (!notification.subject) {
            throw new Error('Email subject missing');
          }
          await emailService.sendEmail(notification.recipient, notification.subject, notification.content);
        } else if (notification.channel === 'SMS') {
          await smsService.sendSms(notification.recipient, notification.content);
        }
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            sentAt: new Date()
          }
        });
        processedCount++;
      } catch (error: any) {
        console.error(`[Queue] Failed to process notification ${notification.id}:`, error);
        errorCount++;
        const retryCount = notification.retryCount + 1;
        const status = retryCount >= 3 ? 'FAILED' : 'PENDING';
        await prisma.notification.update({
          where: { id: notification.id },
          data: {
            retryCount,
            status
          }
        });
      }
    }
    return { processed: processedCount, errors: errorCount };
  }
};
