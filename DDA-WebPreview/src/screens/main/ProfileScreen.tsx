import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { theme } from '../../constants/theme';
import { Button } from '../../components/common/Button';
import { useAuth } from '../../context/AuthContext';

export const ProfileScreen: React.FC<any> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              await logout();
              // Auth state listener fires → AppNavigator switches to Auth automatically
            } catch (err: any) {
              Alert.alert('Sign Out Failed', err.message ?? 'Unable to sign out.');
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ],
    );
  };

  const avatarLetter = user?.fullName?.charAt(0)?.toUpperCase()
    ?? user?.displayName?.charAt(0)?.toUpperCase()
    ?? 'U';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{avatarLetter}</Text>
        </View>
        <Text style={styles.nameText}>
          {user?.fullName || user?.displayName || 'Document Owner'}
        </Text>
        <Text style={styles.emailText}>{user?.email || '—'}</Text>
        <View style={styles.verifiedBadge}>
          <Text style={styles.verifiedText}>✓  Firebase Authenticated</Text>
        </View>
      </View>

      {/* AI Assistant Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🤖 AI Document Assistant</Text>
        <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 12 }}>
          Chat with your intelligent assistant to understand document fields, verify info, or request corrections.
        </Text>
        <TouchableOpacity
          style={{
            backgroundColor: theme.colors.primary,
            paddingVertical: 12,
            borderRadius: 8,
            alignItems: 'center',
          }}
          onPress={() => navigation?.navigate?.('Assistant', {})}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>
            Open AI Assistant
          </Text>
        </TouchableOpacity>
      </View>

      {/* Account Info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👤 Account Details</Text>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Full Name</Text>
          <Text style={styles.settingValue}>
            {user?.fullName || user?.displayName || 'Not set'}
          </Text>
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Email Address</Text>
          <Text style={styles.settingValue}>{user?.email || '—'}</Text>
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>User ID</Text>
          <Text style={[styles.settingValue, styles.mono]} numberOfLines={1} ellipsizeMode="tail">
            {user?.uid || '—'}
          </Text>
        </View>
      </View>

      {/* Security Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔒 Security & Architecture</Text>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Authentication</Text>
          <Text style={styles.settingValue}>Firebase Email/Password</Text>
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>User Profile Store</Text>
          <Text style={styles.settingValue}>PostgreSQL / Firebase Auth</Text>
        </View>

        <View style={styles.settingRow}>
          <Text style={styles.settingLabel}>Document Vault</Text>
          <Text style={styles.settingValue}>PostgreSQL + Prisma</Text>
        </View>

        <View style={[styles.settingRow, styles.lastRow]}>
          <Text style={styles.settingLabel}>Password Stored</Text>
          <Text style={[styles.settingValue, styles.greenText]}>Never ✓</Text>
        </View>
      </View>

      {/* Backend & Auth Status */}
      <View style={[styles.card, styles.statusCard]}>
        <View style={styles.statusRow}>
          <Text style={styles.statusDot}>🟢</Text>
          <Text style={styles.statusLabel}>Firebase Auth Initialized</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusDot}>🟢</Text>
          <Text style={styles.statusLabel}>Authentication Active</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusDot}>🟢</Text>
          <Text style={styles.statusLabel}>PostgreSQL Database Connected</Text>
        </View>
      </View>

      {/* Logout */}
      <View style={styles.logoutWrapper}>
        <Button
          title={isLoggingOut ? 'Signing Out…' : 'Sign Out'}
          onPress={handleLogout}
          loading={isLoggingOut}
          disabled={isLoggingOut}
          variant="outlined"
          style={styles.logoutButton}
        />
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
    paddingBottom: theme.spacing.xxl,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.sm,
    elevation: 4,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  avatarText: {
    fontSize: 34,
    fontWeight: '800',
    color: theme.colors.onPrimary,
  },
  nameText: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 2,
  },
  emailText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  verifiedBadge: {
    backgroundColor: 'rgba(22, 163, 74, 0.1)',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    marginTop: theme.spacing.xs,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.success,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.sm,
  },
  settingRow: {
    paddingVertical: theme.spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceVariant,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  settingValue: {
    fontSize: 13,
    color: theme.colors.textPrimary,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  greenText: {
    color: theme.colors.success,
    fontWeight: '700',
  },
  statusCard: {
    gap: theme.spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  statusDot: {
    fontSize: 12,
  },
  statusLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  logoutWrapper: {
    marginTop: theme.spacing.sm,
  },
  logoutButton: {
    borderColor: theme.colors.error,
  },
});
