import prisma from '../utils/prisma';
import { emailService } from './emailService';
import { smsService } from './smsService';
import { notificationQueue } from './notificationQueueService';
import { NotificationType, NotificationChannel } from '@prisma/client';

export const reminderService = {
  checkAndSendReminders: async () => {
    try {
      console.log('Running reminder check...');
      const settings = await prisma.salonSettings.findFirst();
      const timeZone = settings?.timezone || 'UTC';
      const notificationsEnabled = settings?.notificationsEnabled ?? true;
      if (!notificationsEnabled) {
        console.log('Notifications disabled in settings, skipping reminder check');
        return;
      }
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        hour: 'numeric'
      });
      const currentHour = parseInt(formatter.format(now));
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      const startOfTomorrow = new Date(`${tomorrowStr}T00:00:00.000Z`);
      const endOfTomorrow = new Date(`${tomorrowStr}T23:59:59.999Z`);
      const maxBookingsPerRun = 100;
      const bookings = await prisma.booking.findMany({
        where: {
          bookingDate: {
            gte: startOfTomorrow,
            lte: endOfTomorrow
          },
          status: 'booked'
        },
        include: {
          customer: true,
          style: true,
          category: true
        },
        take: maxBookingsPerRun
      });
      console.log(`Found ${bookings.length} bookings for tomorrow (${tomorrowStr}). Checking times for hour ${currentHour}...`);
      for (const booking of bookings) {
        const bookingHour = booking.bookingTime.getUTCHours();
        if (bookingHour === currentHour) {
          await reminderService.sendReminderForBooking(booking);
        }
      }
    } catch (error) {
      console.error('Error in checkAndSendReminders:', error);
    }
  },

  /**
   * Send reminder for a specific booking
   */
  sendReminderForBooking: async (booking: any) => {
    try {
      const { customer, style, category, bookingDate, bookingTime } = booking;
      
      if (!customer) return;
      if (customer.notificationConsent === false) return;

      // Check if reminder already sent
      // We look for a Notification of type EMAIL/SMS with metadata { bookingId: id, type: 'REMINDER' }
      // But checking DB for every booking might be slow?
      // For now, it's fine as volume is low.
      const alreadySent = await prisma.notification.findFirst({
        where: {
          metadata: {
            path: ['bookingId'],
            equals: booking.id
          },
          AND: {
            metadata: {
              path: ['type'],
              equals: 'REMINDER'
            }
          }
        }
      });

      if (alreadySent) {
        console.log(`Reminder already sent for booking ${booking.id}`);
        return;
      }

      const dateStr = bookingDate.toISOString().split('T')[0];
      const timeStr = bookingTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      console.log(`Sending reminder for booking ${booking.id} to ${customer.email}`);

      // 1. Send Email
      if (customer.email) {
        const serviceName = style?.name + (category ? ` - ${category.name}` : '');
        const { subject, html } = await emailService.getBookingReminderContent(
          customer.fullName,
          serviceName || 'Service',
          dateStr,
          timeStr
        );

        await notificationQueue.add(
          'EMAIL',
          'AN',
          customer.email,
          html,
          subject,
          { bookingId: booking.id, type: 'REMINDER' }
        );
      }

      // 2. Send SMS
      if (customer.phone) {
        const smsBody = await smsService.getBookingReminderContent(
          customer.fullName,
          dateStr,
          timeStr
        );

        await notificationQueue.add(
          'SMS',
          'AN',
          customer.phone,
          smsBody,
          undefined,
          { bookingId: booking.id, type: 'REMINDER' }
        );
      }

    } catch (error) {
      console.error(`Failed to send reminder for booking ${booking.id}:`, error);
    }
  }
};
