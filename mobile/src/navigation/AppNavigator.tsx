import React from 'react';
import { StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useClient } from '../context/ClientContext';
import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ScreenerScreen from '../screens/ScreenerScreen';
import StockDetailScreen from '../screens/StockDetailScreen';
import EtfScreen from '../screens/EtfScreen';
import EtfDetailScreen from '../screens/EtfDetailScreen';
import NewsScreen from '../screens/NewsScreen';
import PoliticiansScreen from '../screens/PoliticiansScreen';
import InsidersScreen from '../screens/InsidersScreen';
import FedScreen from '../screens/FedScreen';
import WatchlistScreen from '../screens/WatchlistScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const NestedStack = createNativeStackNavigator();

const nestedStackOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600' as const },
};

function ScreenerStack() {
  return (
    <NestedStack.Navigator screenOptions={nestedStackOptions}>
      <NestedStack.Screen
        name="ScreenerList"
        component={ScreenerScreen}
        options={{ title: 'Screener' }}
      />
      <NestedStack.Screen
        name="StockDetail"
        component={StockDetailScreen}
        options={({ route }: any) => ({ title: route?.params?.ticker ?? 'Stock' })}
      />
    </NestedStack.Navigator>
  );
}

function EtfStack() {
  return (
    <NestedStack.Navigator screenOptions={nestedStackOptions}>
      <NestedStack.Screen
        name="EtfList"
        component={EtfScreen}
        options={{ title: 'ETF' }}
      />
      <NestedStack.Screen
        name="EtfDetail"
        component={EtfDetailScreen}
        options={({ route }: any) => ({ title: route?.params?.ticker ?? 'ETF' })}
      />
    </NestedStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Screener"
        component={ScreenerStack}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="ETF"
        component={EtfStack}
        options={{ headerShown: false }}
      />
      <Tab.Screen name="News" component={NewsScreen} />
      <Tab.Screen name="Politicians" component={PoliticiansScreen} />
      <Tab.Screen name="Insiders" component={InsidersScreen} />
      <Tab.Screen name="Fed" component={FedScreen} />
      <Tab.Screen name="Watchlist" component={WatchlistScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { authToken } = useClient();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      {authToken == null ? (
        <>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Signup"
            component={SignupScreen}
            options={{ title: 'Create Account' }}
          />
        </>
      ) : (
        <Stack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
      )}
    </Stack.Navigator>
  );
}
