import React, { createContext, useContext, useState } from 'react';
import { StockAppClient } from '../api/client';
import { API_BASE_URL } from '../config';

interface ClientContextValue {
  client: StockAppClient;
  authToken: string | null;
  setAuthToken: (token: string | null) => void;
}

export const ClientContext = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new StockAppClient(API_BASE_URL));
  const [authToken, setAuthTokenState] = useState<string | null>(null);

  function setAuthToken(token: string | null) {
    client.setToken(token);
    setAuthTokenState(token);
  }

  return (
    <ClientContext.Provider value={{ client, authToken, setAuthToken }}>
      {children}
    </ClientContext.Provider>
  );
}

export function useClient(): ClientContextValue {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error('useClient must be used within ClientProvider');
  return ctx;
}
