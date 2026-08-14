import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from './types';
import { HomeScreen } from '../screens/main/HomeScreen';
import { DocumentsScreen } from '../screens/main/DocumentsScreen';
import { ScanScreen } from '../screens/main/ScanScreen';
import { RemindersScreen } from '../screens/main/RemindersScreen';
import { ProfileScreen } from '../screens/main/ProfileScreen';
import { theme } from '../constants/theme';

const Tab = createBottomTabNavigator<MainTabParamList>();

const getTabIcon = (routeName: string, focused: boolean) => {
  let icon = '📄';
  switch (routeName) {
    case 'HomeTab':
      icon = '🏠';
      break;
    case 'DocumentsTab':
      icon = '📁';
      break;
    case 'ScanTab':
      icon = '📷';
      break;
    case 'RemindersTab':
      icon = '⏰';
      break;
    case 'ProfileTab':
      icon = '👤';
      break;
  }
  return (
    <View style={[styles.iconContainer, focused && styles.focusedIconContainer]}>
      <Text style={[styles.iconText, focused && styles.focusedIconText]}>{icon}</Text>
    </View>
  );
};

export const MainNavigator: React.FC = () => {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => getTabIcon(route.name, focused),
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
          backgroundColor: theme.colors.surface,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          elevation: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: theme.colors.surface,
          elevation: 1,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.05,
        },
        headerTitleStyle: {
          fontWeight: '700',
          fontSize: 18,
          color: theme.colors.textPrimary,
        },
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: 'Home', headerTitle: 'Digital Document Assistant' }}
      />
      <Tab.Screen
        name="DocumentsTab"
        component={DocumentsScreen}
        options={{ title: 'Documents', headerTitle: 'Personal Vault' }}
      />
      <Tab.Screen
        name="ScanTab"
        component={ScanScreen}
        options={{ title: 'Scan', headerTitle: 'Scan Document' }}
      />
      <Tab.Screen
        name="RemindersTab"
        component={RemindersScreen}
        options={{ title: 'Reminders', headerTitle: 'Expiry Tracker' }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: 'Profile', headerTitle: 'My Profile' }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusedIconContainer: {
    transform: [{ scale: 1.15 }],
  },
  iconText: {
    fontSize: 20,
  },
  focusedIconText: {
    fontSize: 22,
  },
});
