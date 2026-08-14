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
import {
  validateName,
  validateEmail,
  validatePassword,
  validateConfirmPassword,
} from '../../utils/validation';
import { useAuth } from '../../context/AuthContext';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [formError, setFormError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const clearFormError = () => {
    if (formError) setFormError('');
  };

  const handleRegister = async () => {
    setFormError('');

    // Field-level validation
    const nameRes = validateName(name);
    const emailRes = validateEmail(email);
    const passRes = validatePassword(password);
    const confirmRes = validateConfirmPassword(password, confirmPassword);

    setNameError(nameRes.error ?? '');
    setEmailError(emailRes.error ?? '');
    setPasswordError(passRes.error ?? '');
    setConfirmError(confirmRes.error ?? '');

    if (!nameRes.isValid || !emailRes.isValid || !passRes.isValid || !confirmRes.isValid) {
      return;
    }

    setIsLoading(true);
    try {
      // register() in AuthContext:
      //   1. Creates Firebase Auth account
      //   2. Updates displayName on Auth profile
      //   3. Writes Firestore document at users/{uid} with uid, fullName, email, createdAt
      //   Passwords are NEVER stored.
      await register(name.trim(), email.trim(), password);
      // Auth state listener fires → AppNavigator switches to Main automatically
    } catch (err: any) {
      setFormError(err.message ?? 'Registration failed. Please try again.');
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
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>
            Store and manage your documents securely
          </Text>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <Input
            label="Full Name"
            placeholder="John Doe"
            value={name}
            onChangeText={(text) => { setName(text); setNameError(''); clearFormError(); }}
            error={nameError}
            autoCapitalize="words"
          />

          <Input
            label="Email Address"
            placeholder="name@example.com"
            value={email}
            onChangeText={(text) => { setEmail(text); setEmailError(''); clearFormError(); }}
            error={emailError}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Input
            label="Password"
            placeholder="Min. 6 characters"
            value={password}
            onChangeText={(text) => { setPassword(text); setPasswordError(''); clearFormError(); }}
            error={passwordError}
            isPassword
          />

          <Input
            label="Confirm Password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChangeText={(text) => { setConfirmPassword(text); setConfirmError(''); clearFormError(); }}
            error={confirmError}
            isPassword
          />

          {/* Form-level error (Firebase errors) */}
          {formError.length > 0 && (
            <View style={styles.formErrorBox}>
              <Text style={styles.formErrorText}>⚠️  {formError}</Text>
            </View>
          )}

          <View style={styles.buttonWrapper}>
            <Button
              title="Create Account"
              onPress={handleRegister}
              loading={isLoading}
              disabled={isLoading}
              variant="primary"
            />
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Button
            title="Sign In"
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
    marginBottom: theme.spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
  },
  formErrorText: {
    fontSize: 13,
    color: theme.colors.error,
    fontWeight: '500',
  },
  buttonWrapper: {
    marginTop: theme.spacing.md,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xl,
  },
  footerText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
});
