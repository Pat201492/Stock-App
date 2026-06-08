import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { ClientProvider, useClient } from './src/context/ClientContext';
import { loadToken } from './src/auth/session';
import AppNavigator from './src/navigation/AppNavigator';

function HydratedApp() {
  const { setAuthToken } = useClient();
  useEffect(() => {
    loadToken().then((token) => {
      if (token) setAuthToken(token);
    });
  }, [setAuthToken]);
  return <AppNavigator />;
}

export default function App() {
  return (
    <ClientProvider>
      <NavigationContainer>
        <HydratedApp />
      </NavigationContainer>
    </ClientProvider>
  );
}
