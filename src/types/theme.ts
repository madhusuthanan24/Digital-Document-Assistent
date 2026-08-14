export interface ThemeColors {
  primary: string;
  primaryVariant: string;
  onPrimary: string;
  secondary: string;
  secondaryVariant: string;
  onSecondary: string;
  background: string;
  onBackground: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  error: string;
  onError: string;
  outline: string;
  success: string;
  warning: string;
  info: string;
  card: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface ThemeRadius {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  pill: number;
}

export interface AppTheme {
  colors: ThemeColors;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
}
