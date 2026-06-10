import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useClient } from '../context/ClientContext';
import LoginScreen from '../screens/LoginScreen';
import SignupScreen from '../screens/SignupScreen';
import ScreenerScreen from '../screens/ScreenerScreen';
import EtfScreen from '../screens/EtfScreen';
import NewsScreen from '../screens/NewsScreen';
import PoliticiansScreen from '../screens/PoliticiansScreen';
import InsidersScreen from '../screens/InsidersScreen';
import FedScreen from '../screens/FedScreen';
import WatchlistScreen from '../screens/WatchlistScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Screener" component={ScreenerScreen} />
      <Tab.Screen name="ETF" component={EtfScreen} />
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
    <Stack.Navigator>
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
