import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useClient } from '../context/ClientContext';
import LoginScreen from '../screens/LoginScreen';
import ScreenerScreen from '../screens/ScreenerScreen';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  const { authToken } = useClient();
  return (
    <Stack.Navigator>
      {authToken == null ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <Stack.Screen
          name="Screener"
          component={ScreenerScreen}
          options={{ title: 'Stock Screener' }}
        />
      )}
    </Stack.Navigator>
  );
}
