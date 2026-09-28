import React, { useEffect, useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Keyboard,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { theme } from '../../constants/theme';

interface FloatingAssistantButtonProps {
  navigation?: any;
}

export const FloatingAssistantButton: React.FC<FloatingAssistantButtonProps> = ({ navigation: propNav }) => {
  const hookNav = useNavigation<any>();
  const nav = propNav || hookNav;
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (isKeyboardVisible) {
    return null;
  }

  const handlePress = () => {
    console.log('[GLOBAL_AI_ASSISTANT] Floating button pressed');
    nav?.navigate?.('Assistant', {});
  };

  return (
    <TouchableOpacity
      style={styles.floatingButton}
      activeOpacity={0.8}
      onPress={handlePress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Open AI Document Assistant"
      testID="global-ai-assistant-fab"
    >
      <Text style={styles.floatingButtonIcon}>🤖</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  floatingButton: {
    position: 'absolute',
    bottom: 80, // Sits 16dp above the 64dp bottom tab bar
    right: 18,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: theme.colors.primary, // #1E3A8A (Deep Indigo)
    borderWidth: 1.5,
    borderColor: '#3B82F6', // Crisp Blue accent border
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
    elevation: 10,
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  floatingButtonIcon: {
    fontSize: 26,
  },
});
