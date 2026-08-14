import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/types';
import { theme } from '../../constants/theme';
import { authService } from '../../services/auth/authService';

type Props = NativeStackScreenProps<AuthStackParamList, 'Splash'>;

export const SplashScreen: React.FC<Props> = ({ navigation }) => {
  const fadeAnim = new Animated.Value(0);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 1000,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      navigation.replace('Login');
    }, 1800);

    return () => clearTimeout(timer);
  }, [navigation, fadeAnim]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoIcon}>🛡️</Text>
        </View>
        <Text style={styles.title}>Digital Document Assistant</Text>
        <Text style={styles.subtitle}>Secure Personal Vault & Expiry Tracker</Text>
      </Animated.View>
      <Text style={styles.footer}>Powered by Security & AI • Phase 1</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  content: {
    alignItems: 'center',
  },
  logoBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  logoIcon: {
    fontSize: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: theme.colors.onPrimary,
    textAlign: 'center',
    marginBottom: theme.spacing.xs,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
});
