import { AppTheme } from '../types/theme';

export const theme: AppTheme = {
  colors: {
    primary: '#1E3A8A',          // Deep Indigo
    primaryVariant: '#1D4ED8',   // Rich Blue
    onPrimary: '#FFFFFF',
    secondary: '#0D9488',        // Material Teal
    secondaryVariant: '#0F766E', // Dark Teal
    onSecondary: '#FFFFFF',
    background: '#F8FAFC',       // Crisp Light Gray/Slate
    onBackground: '#0F172A',
    surface: '#FFFFFF',
    onSurface: '#1E293B',
    surfaceVariant: '#F1F5F9',
    onSurfaceVariant: '#475569',
    error: '#DC2626',            // Material Red
    onError: '#FFFFFF',
    outline: '#CBD5E1',          // Subtle Slate Border
    success: '#16A34A',          // Forest Green
    warning: '#D97706',          // Amber
    info: '#2563EB',             // Blue Accent
    card: '#FFFFFF',
    border: '#E2E8F0',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    textMuted: '#94A3B8',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
  },
};
