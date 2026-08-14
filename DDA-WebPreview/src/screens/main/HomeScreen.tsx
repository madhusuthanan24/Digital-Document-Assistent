import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { MainTabParamList } from '../../navigation/types';
import { theme } from '../../constants/theme';
import { documentService } from '../../services/document/documentService';
import { DocumentMetadata } from '../../types/document';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { useAuth } from '../../context/AuthContext';

type Props = BottomTabScreenProps<MainTabParamList, 'HomeTab'>;

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchDocs = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    try {
      const docs = await documentService.getDocuments(user.uid);
      setDocuments(docs);
    } catch {
      // Keep empty array on error
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      fetchDocs();
    }, [fetchDocs])
  );

  if (isLoading) {
    return <LoadingIndicator message="Loading your personal vault..." />;
  }

  const categoryIcons: Record<string, string> = {
    Aadhaar: '🆔',
    PAN: '💳',
    Passport: '✈️',
    DrivingLicence: '🚗',
    VehicleRC: '🏎️',
    Insurance: '🛡️',
    EducationalCertificate: '🎓',
    Other: '📁',
  };

  const recentDocs = documents.slice(0, 5);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Banner */}
      <View style={styles.headerCard}>
        <View style={styles.headerTextWrapper}>
          <Text style={styles.greeting}>
            {user?.displayName ? `Hello, ${user.displayName}` : 'Digital Document Assistant'}
          </Text>
          <Text style={styles.headerSubtitle}>
            Secure Vault • {documents.length} {documents.length === 1 ? 'Active Document' : 'Active Documents'}
          </Text>
        </View>
        <View style={styles.shieldIconWrapper}>
          <Text style={styles.shieldIcon}>🔐</Text>
        </View>
      </View>

      {/* Quick Action Grid */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionGrid}>
        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('ScanTab')}
        >
          <Text style={styles.actionIcon}>📷</Text>
          <Text style={styles.actionTitle}>Scan New</Text>
          <Text style={styles.actionDesc}>Camera / Gallery</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('DocumentsTab')}
        >
          <Text style={styles.actionIcon}>📁</Text>
          <Text style={styles.actionTitle}>All Documents</Text>
          <Text style={styles.actionDesc}>Organized list</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('RemindersTab')}
        >
          <Text style={styles.actionIcon}>⏰</Text>
          <Text style={styles.actionTitle}>Expiries</Text>
          <Text style={styles.actionDesc}>Track dates</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCard}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('ProfileTab')}
        >
          <Text style={styles.actionIcon}>⚙️</Text>
          <Text style={styles.actionTitle}>Settings</Text>
          <Text style={styles.actionDesc}>Security & Auth</Text>
        </TouchableOpacity>
      </View>

      {/* Document Overview */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Stored Documents</Text>
        <TouchableOpacity onPress={() => navigation.navigate('DocumentsTab')}>
          <Text style={styles.seeAllText}>View All →</Text>
        </TouchableOpacity>
      </View>

      {recentDocs.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyTitle}>No Documents Uploaded Yet</Text>
          <Text style={styles.emptySub}>
            Tap "Scan New" to add your Aadhaar, PAN, Passport, or Insurance document.
          </Text>
        </View>
      ) : (
        recentDocs.map((doc) => (
          <TouchableOpacity
            key={doc.id}
            style={styles.docCard}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('DocumentsTab')}
          >
            <View style={styles.docIconBadge}>
              <Text style={styles.docIcon}>
                {categoryIcons[doc.documentType] || '📄'}
              </Text>
            </View>
            <View style={styles.docInfo}>
              <Text style={styles.docTitle}>{doc.documentName}</Text>
              <Text style={styles.docNumber}>
                {doc.documentNumber || (doc.fileName ? `File: ${doc.fileName}` : 'Saved in Vault')}
              </Text>
            </View>
            <View style={styles.docStatusBadge}>
              <Text style={styles.docStatusText}>Secured</Text>
            </View>
          </TouchableOpacity>
        ))
      )}

      {/* Security Notice */}
      <View style={styles.tipCard}>
        <Text style={styles.tipTitle}>💡 Private User Vault</Text>
        <Text style={styles.tipText}>
          Your document records are isolated strictly within your authenticated Firestore subcollection.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
  },
  headerCard: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.lg,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  headerTextWrapper: {
    flex: 1,
  },
  greeting: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.onPrimary,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
  },
  shieldIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: theme.spacing.sm,
  },
  shieldIcon: {
    fontSize: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginVertical: theme.spacing.xs,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  actionCard: {
    width: '48%',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 1,
  },
  actionIcon: {
    fontSize: 28,
    marginBottom: theme.spacing.xs,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  actionDesc: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
  docCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  docIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  docIcon: {
    fontSize: 22,
  },
  docInfo: {
    flex: 1,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  docNumber: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  docStatusBadge: {
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    paddingHorizontal: theme.spacing.xs + 4,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  docStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.success,
  },
  tipCard: {
    backgroundColor: '#EFF6FF',
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    marginTop: theme.spacing.md,
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.primary,
  },
  tipTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.primary,
    marginBottom: 4,
  },
  tipText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    lineHeight: 18,
  },
});
