import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { theme } from '../../constants/theme';

export interface LoadingIndicatorProps {
  message?: string;
  overlay?: boolean;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Loading...',
  overlay = false,
}) => {
  return (
    <View style={[styles.container, overlay && styles.overlayContainer]}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  overlayContainer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 999,
  },
  card: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    minWidth: 150,
  },
  message: {
    marginTop: theme.spacing.md,
    fontSize: 14,
    fontWeight: '500',
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});
