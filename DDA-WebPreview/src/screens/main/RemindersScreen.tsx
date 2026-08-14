import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../../constants/theme';
import { documentService } from '../../services/document/documentService';
import { ExpiryReminder } from '../../types/document';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { useAuth } from '../../context/AuthContext';

export const RemindersScreen: React.FC = () => {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<ExpiryReminder[]>([]);
  const [activeTab, setActiveTab] = useState<'ALL' | 'EXPIRING_SOON' | 'EXPIRED'>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchReminders = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await documentService.getReminders(user.uid);
      setReminders(data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load reminders.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      fetchReminders();
    }, [fetchReminders])
  );

  const filteredReminders = reminders.filter((rem) => {
    if (activeTab === 'EXPIRING_SOON') return rem.status === 'EXPIRING_SOON';
    if (activeTab === 'EXPIRED') return rem.status === 'EXPIRED';
    return true;
  });

  const expiringSoonCount = reminders.filter((r) => r.status === 'EXPIRING_SOON').length;
  const expiredCount = reminders.filter((r) => r.status === 'EXPIRED').length;

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

      <ScrollView contentContainerStyle={styles.listContent}>
        {filteredReminders.length === 0 ? (
          <EmptyState
            icon="⏰"
            title="No Expiry Reminders"
            description={
              reminders.length === 0
                ? 'No documents with expiry dates found. Add expiry dates when uploading documents to track renewals here.'
                : 'No documents match the selected filter criteria.'
            }
          />
        ) : (
          filteredReminders.map((item) => {
            const isExpired = item.status === 'EXPIRED';
            const isExpiringSoon = item.status === 'EXPIRING_SOON';

            return (
              <View key={item.id} style={styles.reminderCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.categoryBadge}>{item.documentType}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      isExpired
                        ? styles.badgeDanger
                        : isExpiringSoon
                        ? styles.badgeWarning
                        : styles.badgeSuccess,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusText,
                        isExpired
                          ? styles.textDanger
                          : isExpiringSoon
                          ? styles.textWarning
                          : styles.textSuccess,
                      ]}
                    >
                      {isExpired
                        ? `Expired ${Math.abs(item.daysRemaining)} Days Ago`
                        : `${item.daysRemaining} Days Left`}
                    </Text>
                  </View>
                </View>

                <Text style={styles.docTitle}>{item.documentName}</Text>
                <Text style={styles.expiryInfo}>
                  Expiry Date: <Text style={styles.boldDate}>{item.expiryDate}</Text>
                </Text>
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
  categoryBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.primary,
    backgroundColor: 'rgba(30, 58, 138, 0.1)',
    paddingHorizontal: theme.spacing.xs + 4,
    paddingVertical: 2,
    borderRadius: theme.radius.xs,
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
    marginVertical: 4,
  },
  expiryInfo: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  boldDate: {
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
});
