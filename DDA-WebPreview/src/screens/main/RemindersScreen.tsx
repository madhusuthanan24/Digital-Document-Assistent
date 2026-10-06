import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import { documentService } from '../../services/document/documentService';
import { notificationService } from '../../services/notifications/notificationService';
import { ExpiryReminder } from '../../types/document';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { useAuth } from '../../context/AuthContext';

function formatDaysRemaining(days: number, reminderType: string = 'Expiry'): string {
  if (days < 0) {
    return 'Expired';
  }
  if (days === 0) {
    return reminderType === 'Due Date' ? 'Due today' : 'Expires today';
  }
  if (days === 1) {
    return '1 day remaining';
  }
  return `${days} days remaining`;
}

function formatReminderSummary(docName: string, days: number, reminderType: string = 'Expiry'): string {
  const actionWord =
    reminderType === 'Due Date'
      ? 'is due'
      : reminderType === 'Renewal'
      ? 'renews'
      : reminderType === 'Warranty Expiry'
      ? 'warranty expires'
      : 'expires';

  if (days < 0) {
    return `${docName} has expired`;
  }
  if (days === 0) {
    return `${docName} ${actionWord} today`;
  }
  if (days === 1) {
    return `${docName} ${actionWord} tomorrow`;
  }
  return `${docName} ${actionWord} in ${days} days`;
}

export const RemindersScreen: React.FC = () => {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<ExpiryReminder[]>([]);
  const [activeTab, setActiveTab] = useState<'ALL' | 'EXPIRING_SOON' | 'EXPIRED'>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string>('granted');

  const fetchReminders = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [data, perm] = await Promise.all([
        documentService.getReminders(user.uid),
        notificationService.getPermissionStatus(),
      ]);
      setReminders(data);
      setNotificationStatus(perm.status);

      if (perm.granted) {
        await notificationService.syncDocumentReminders(user.uid, data);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load reminders.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  const onRefresh = useCallback(async () => {
    if (!user?.uid) return;
    setRefreshing(true);
    try {
      const [data, perm] = await Promise.all([
        documentService.getReminders(user.uid),
        notificationService.getPermissionStatus(),
      ]);
      setReminders(data);
      setNotificationStatus(perm.status);

      if (perm.granted) {
        await notificationService.syncDocumentReminders(user.uid, data);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to refresh reminders.');
    } finally {
      setRefreshing(false);
    }
  }, [user?.uid]);

  const handleEnableNotifications = async () => {
    const perm = await notificationService.requestPermissions();
    setNotificationStatus(perm.status);
    if (perm.granted && user?.uid) {
      await notificationService.syncDocumentReminders(user.uid, reminders);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchReminders();
    }, [fetchReminders])
  );

  const filteredReminders = reminders.filter((rem) => {
    if (activeTab === 'EXPIRING_SOON') return rem.daysRemaining >= 0 && rem.daysRemaining <= 30;
    if (activeTab === 'EXPIRED') return rem.daysRemaining < 0;
    return true;
  });

  const expiringSoonCount = reminders.filter((r) => r.daysRemaining >= 0 && r.daysRemaining <= 30).length;
  const expiredCount = reminders.filter((r) => r.daysRemaining < 0).length;

  if (isLoading) {
    return <LoadingIndicator message="Calculating document renewal dates..." />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Expiry Reminders</Text>
        <Text style={styles.subtitle}>
          Automated renewal tracker for your Passport, Driving Licence & Insurance
        </Text>
      </View>

      {/* Device Notifications Banner */}
      {notificationStatus !== 'granted' && (
        <View style={styles.notifBanner}>
          <View style={styles.notifBannerLeft}>
            <Text style={styles.notifBannerIcon}>🔔</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.notifBannerTitle}>Device notifications are disabled</Text>
              <Text style={styles.notifBannerDesc}>
                Enable alerts to receive reminders at 30, 14, 7, 3, 1, and 0 days.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.notifBannerBtn}
            onPress={handleEnableNotifications}
            activeOpacity={0.8}
          >
            <Text style={styles.notifBannerBtnText}>Enable</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Filter Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'ALL' && styles.activeTab]}
          onPress={() => setActiveTab('ALL')}
        >
          <Text style={[styles.tabText, activeTab === 'ALL' && styles.activeTabText]}>
            All ({reminders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'EXPIRING_SOON' && styles.activeTab]}
          onPress={() => setActiveTab('EXPIRING_SOON')}
        >
          <Text style={[styles.tabText, activeTab === 'EXPIRING_SOON' && styles.activeTabText]}>
            Expiring Soon ({expiringSoonCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'EXPIRED' && styles.activeTab]}
          onPress={() => setActiveTab('EXPIRED')}
        >
          <Text style={[styles.tabText, activeTab === 'EXPIRED' && styles.activeTabText]}>
            Expired ({expiredCount})
          </Text>
        </TouchableOpacity>
      </View>

      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
        }
      >
        {filteredReminders.length === 0 ? (
          <EmptyState
            icon="⏰"
            title="No Reminders Found"
            description={
              reminders.length === 0
                ? 'No documents with upcoming dates found in your Personal Vault. Dates like Expiry, Renewal, or Due Date are automatically tracked.'
                : 'No documents match the selected filter criteria.'
            }
          />
        ) : (
          filteredReminders.map((item) => {
            const isExpired = item.daysRemaining < 0;
            const isToday = item.daysRemaining === 0;
            const isExpiringSoon = item.daysRemaining > 0 && item.daysRemaining <= 30;
            const reminderType = item.reminderType || 'Expiry';
            const displayDate = item.targetDate || item.expiryDate;

            let badgeStyle = styles.badgeSuccess;
            let textStyle = styles.textSuccess;
            let statusBadgeLabel = `${item.daysRemaining} days left`;

            if (isExpired) {
              badgeStyle = styles.badgeDanger;
              textStyle = styles.textDanger;
              statusBadgeLabel = 'Expired';
            } else if (isToday) {
              badgeStyle = styles.badgeDanger;
              textStyle = styles.textDanger;
              statusBadgeLabel = reminderType === 'Due Date' ? 'Due Today' : 'Expires Today';
            } else if (isExpiringSoon) {
              badgeStyle = styles.badgeWarning;
              textStyle = styles.textWarning;
              statusBadgeLabel = item.daysRemaining === 1 ? '1 Day Left' : `${item.daysRemaining} Days Left`;
            }

            return (
              <View key={item.id} style={styles.reminderCard}>
                <View style={styles.cardHeader}>
                  <View style={styles.badgeRow}>
                    <Text style={styles.categoryBadge}>{item.documentType}</Text>
                    <View style={styles.typeBadge}>
                      <Text style={styles.typeBadgeText}>{reminderType}</Text>
                    </View>
                  </View>

                  <View style={[styles.statusBadge, badgeStyle]}>
                    <Text style={[styles.statusText, textStyle]}>
                      {statusBadgeLabel}
                    </Text>
                  </View>
                </View>

                <Text style={styles.docTitle}>{item.documentName}</Text>

                <View style={styles.detailsRow}>
                  <Text style={styles.expiryInfo}>
                    Target Date: <Text style={styles.boldDate}>{displayDate}</Text>
                  </Text>
                  <Text
                    style={[
                      styles.daysRemainingText,
                      isExpired ? styles.textDanger : isToday || isExpiringSoon ? styles.textWarning : styles.textSuccess,
                    ]}
                  >
                    {formatDaysRemaining(item.daysRemaining, reminderType)}
                  </Text>
                </View>

                <View style={styles.summaryContainer}>
                  <Text style={styles.summaryText}>
                    💡 {formatReminderSummary(item.documentName, item.daysRemaining, reminderType)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  notifBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm + 4,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  notifBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  notifBannerIcon: {
    fontSize: 20,
    marginRight: theme.spacing.xs + 2,
  },
  notifBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
  },
  notifBannerDesc: {
    fontSize: 11,
    color: '#3B82F6',
    marginTop: 1,
  },
  notifBannerBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: theme.radius.sm,
  },
  notifBannerBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    marginHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: theme.spacing.xs + 2,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  activeTab: {
    backgroundColor: theme.colors.primary,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  activeTabText: {
    color: theme.colors.onPrimary,
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    padding: theme.spacing.md,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radius.sm,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 13,
  },
  listContent: {
    padding: theme.spacing.md,
    paddingTop: 0,
  },
  reminderCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  categoryBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.primary,
    backgroundColor: 'rgba(30, 58, 138, 0.1)',
    paddingHorizontal: theme.spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: theme.radius.xs,
  },
  typeBadge: {
    backgroundColor: 'rgba(100, 116, 139, 0.1)',
    paddingHorizontal: theme.spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: theme.radius.xs,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: theme.radius.pill,
  },
  badgeDanger: {
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
  },
  badgeWarning: {
    backgroundColor: 'rgba(217, 119, 6, 0.12)',
  },
  badgeSuccess: {
    backgroundColor: 'rgba(22, 163, 74, 0.12)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textDanger: {
    color: theme.colors.error,
  },
  textWarning: {
    color: theme.colors.warning,
  },
  textSuccess: {
    color: theme.colors.success,
  },
  docTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginTop: 6,
    marginBottom: 4,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  expiryInfo: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  boldDate: {
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  daysRemainingText: {
    fontSize: 13,
    fontWeight: '700',
  },
  summaryContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  summaryText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
  },
});
