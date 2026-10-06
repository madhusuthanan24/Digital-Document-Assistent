/**
 * notificationService.ts
 *
 * Automated reminder notification service for DDA (Personal Vault).
 * Manages notification schedules, device permissions, and prevents duplicate alerts.
 * Supports Web Notification API with graceful mobile fallback.
 */

import { Platform } from 'react-native';
import { ExpiryReminder } from '../../types/document';

export const REMINDER_OFFSETS = [30, 14, 7, 3, 1, 0];

export interface NotificationPermissionResult {
  granted: boolean;
  status: 'granted' | 'denied' | 'default' | 'unsupported';
}

class NotificationService {
  private inMemorySentKeys: Set<string> = new Set();

  /**
   * Check if notifications are supported in the current environment
   */
  public isSupported(): boolean {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      return true;
    }
    return false;
  }

  /**
   * Get current device notification permission status
   */
  public async getPermissionStatus(): Promise<NotificationPermissionResult> {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      const status = Notification.permission as 'granted' | 'denied' | 'default';
      return {
        granted: status === 'granted',
        status,
      };
    }

    return {
      granted: false,
      status: 'unsupported',
    };
  }

  /**
   * Request device notification permissions from user
   */
  public async requestPermissions(): Promise<NotificationPermissionResult> {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        return {
          granted: permission === 'granted',
          status: permission as 'granted' | 'denied' | 'default',
        };
      } catch (err) {
        console.warn('[NOTIFICATIONS] Permission request failed:', err);
      }
    }

    return {
      granted: false,
      status: 'unsupported',
    };
  }

  /**
   * Display an immediate notification if permission is granted
   */
  public async showNotification(title: string, options?: { body?: string; tag?: string }): Promise<boolean> {
    const { granted } = await this.getPermissionStatus();
    if (!granted) {
      console.log(`[NOTIFICATIONS] Skipped notification "${title}" — permission not granted`);
      return false;
    }

    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
        new Notification(title, {
          body: options?.body || '',
          tag: options?.tag,
          icon: '/favicon.png',
        });
        return true;
      }
    } catch (err) {
      console.warn('[NOTIFICATIONS] Error triggering notification:', err);
    }

    return false;
  }

  /**
   * Sync document reminders and trigger scheduled notifications for today's milestones.
   * Uses stable identifier (user + documentId + reminderType + milestone + date) to ensure
   * NO duplicate notifications are delivered on repeated screen visits.
   */
  public async syncDocumentReminders(userId: string, reminders: ExpiryReminder[]): Promise<void> {
    if (!userId || !Array.isArray(reminders)) return;

    const todayStr = new Date().toISOString().slice(0, 10);
    const { granted } = await this.getPermissionStatus();

    for (const rem of reminders) {
      const days = rem.daysRemaining;
      const type = rem.reminderType || 'Expiry';
      const targetDateStr = rem.targetDate || rem.expiryDate;

      // Check if current daysRemaining matches any notification milestone
      const isMilestone = REMINDER_OFFSETS.includes(days);
      if (!isMilestone) continue;

      const notifKey = `dda_notif_${userId}_${rem.documentId}_${type.toLowerCase()}_d${days}_${todayStr}`;

      // Check in-memory and localStorage deduplication
      if (this.hasBeenSent(notifKey)) {
        continue;
      }

      // Format notification message
      let title = `${rem.documentName} ${type}`;
      let body = '';

      if (days === 0) {
        title = `⚠️ ${rem.documentName} ${type === 'Due Date' ? 'Due Today' : 'Expires Today'}!`;
        body = `Your ${rem.documentName} (${rem.documentType}) ${type === 'Due Date' ? 'is due' : 'expires'} today (${targetDateStr}). Please take action.`;
      } else if (days === 1) {
        title = `⏰ ${rem.documentName} ${type} Tomorrow`;
        body = `Your ${rem.documentName} will expire tomorrow (${targetDateStr}).`;
      } else {
        title = `🔔 ${rem.documentName} ${type} Reminder`;
        body = `Your ${rem.documentName} expires in ${days} days on ${targetDateStr}.`;
      }

      // Deliver notification if granted
      if (granted) {
        await this.showNotification(title, { body, tag: notifKey });
        console.log(`[NOTIFICATIONS] Delivered milestone notification: "${title}" (${days} days remaining)`);
      } else {
        console.log(`[NOTIFICATIONS] Milestone reached for "${rem.documentName}" (${days} days) but device notifications disabled.`);
      }

      this.markAsSent(notifKey);
    }
  }

  /**
   * Cancel and clean up all notifications associated with a deleted document
   */
  public cancelDocumentNotifications(documentId: string): void {
    if (!documentId) return;

    // Prune in-memory keys
    for (const key of Array.from(this.inMemorySentKeys)) {
      if (key.includes(`_${documentId}_`)) {
        this.inMemorySentKeys.delete(key);
      }
    }

    // Prune localStorage keys
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.includes(`_${documentId}_`)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => window.localStorage.removeItem(k));
      } catch (e) {
        // Continue
      }
    }

    console.log(`[NOTIFICATIONS] Cleaned up notification tracking for document "${documentId}"`);
  }

  private hasBeenSent(key: string): boolean {
    if (this.inMemorySentKeys.has(key)) return true;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key) !== null;
      } catch {
        return false;
      }
    }
    return false;
  }

  private markAsSent(key: string): void {
    this.inMemorySentKeys.add(key);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, new Date().toISOString());
      } catch {
        // continue
      }
    }
  }
}

export const notificationService = new NotificationService();
