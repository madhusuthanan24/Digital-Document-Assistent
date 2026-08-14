import React from 'react';
import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { theme } from '../../constants/theme';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outlined' | 'text';
  disabled?: boolean;
  loading?: boolean;
  isLoading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  isLoading = false,
  style,
  textStyle,
  fullWidth = true,
}) => {
  const isSpinnerActive = loading || isLoading;
  const getButtonStyle = (): ViewStyle => {
    switch (variant) {
      case 'secondary':
        return {
          backgroundColor: theme.colors.secondary,
        };
      case 'outlined':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: theme.colors.primary,
        };
      case 'text':
        return {
          backgroundColor: 'transparent',
          elevation: 0,
          shadowOpacity: 0,
        };
      case 'primary':
      default:
        return {
          backgroundColor: theme.colors.primary,
        };
    }
  };

  const getTextStyle = (): TextStyle => {
    switch (variant) {
      case 'outlined':
        return { color: theme.colors.primary };
      case 'text':
        return { color: theme.colors.primary };
      case 'secondary':
        return { color: theme.colors.onSecondary };
      case 'primary':
      default:
        return { color: theme.colors.onPrimary };
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || isSpinnerActive}
      style={[
        styles.button,
        getButtonStyle(),
        fullWidth && styles.fullWidth,
        disabled && styles.disabledButton,
        style,
      ]}
    >
      {isSpinnerActive ? (
        <ActivityIndicator
          size="small"
          color={
            variant === 'outlined' || variant === 'text'
              ? theme.colors.primary
              : theme.colors.onPrimary
          }
        />
      ) : (
        <Text style={[styles.text, getTextStyle(), textStyle]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 50,
    borderRadius: theme.radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    marginVertical: theme.spacing.xs,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  fullWidth: {
    width: '100%',
  },
  disabledButton: {
    backgroundColor: theme.colors.outline,
    borderColor: theme.colors.outline,
    elevation: 0,
    shadowOpacity: 0,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});
