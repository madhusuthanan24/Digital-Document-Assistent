import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { theme } from '../../constants/theme';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { validateEmail } from '../../utils/validation';
import { useAuth } from '../../context/AuthContext';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleResetPassword = async () => {
    setFormError('');
    const emailRes = validateEmail(email);
    setEmailError(emailRes.error ?? '');
    if (!emailRes.isValid) {
      return;
    }

    setIsLoading(true);
    try {
      await forgotPassword(email.trim());
      setIsSubmitted(true);
    } catch (err: any) {
      setFormError(err.message ?? 'Could not send reset email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>🔑</Text>
          </View>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter your registered email to receive password reset instructions.
          </Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          {isSubmitted ? (
            /* Success state */
            <View style={styles.successWrapper}>
              <Text style={styles.successIcon}>✅</Text>
              <Text style={styles.successTitle}>Reset Email Sent!</Text>
              <Text style={styles.successText}>
                We sent a password reset link to{' '}
                <Text style={styles.boldText}>{email}</Text>.{'\n'}
                Check your inbox and spam folder.
              </Text>
              <Button
                title="Back to Sign In"
                onPress={() => navigation.navigate('Login')}
                variant="primary"
                style={styles.backButton}
              />
            </View>
          ) : (
            <>
              <Input
                label="Registered Email"
                placeholder="name@example.com"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  if (emailError) setEmailError('');
                  if (formError) setFormError('');
                }}
                error={emailError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {formError.length > 0 && (
                <View style={styles.formErrorBox}>
                  <Text style={styles.formErrorText}>⚠️  {formError}</Text>
                </View>
              )}

              <Button
                title="Send Reset Instructions"
                onPress={handleResetPassword}
                loading={isLoading}
                disabled={isLoading}
                variant="primary"
                style={styles.submitButton}
              />
            </>
          )}
        </View>

        {/* Back link */}
        <View style={styles.footer}>
          <Button
            title="← Back to Sign In"
            onPress={() => navigation.navigate('Login')}
            variant="text"
            fullWidth={false}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    padding: theme.spacing.lg,
    justifyContent: 'center',
    flexGrow: 1,
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  icon: {
    fontSize: 30,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  formErrorBox: {
    backgroundColor: 'rgba(220, 38, 38, 0.08)',
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
  },
  formErrorText: {
    fontSize: 13,
    color: theme.colors.error,
    fontWeight: '500',
  },
  submitButton: {
    marginTop: theme.spacing.sm,
  },
  successWrapper: {
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
  },
  successIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.sm,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  successText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  boldText: {
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  backButton: {
    marginTop: theme.spacing.lg,
  },
  footer: {
    alignItems: 'center',
    marginTop: theme.spacing.xl,
  },
});
