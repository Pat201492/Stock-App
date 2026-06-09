import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import PoliticiansScreen from '../src/screens/PoliticiansScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { PolTrade } from '../src/api/types';

const mockGetPolTrades = jest.fn();

const mockClient = {
  getPolTrades: mockGetPolTrades,
} as unknown as StockAppClient;

function renderScreen() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: jest.fn() }}
    >
      <PoliticiansScreen />
    </ClientContext.Provider>,
  );
}

const TRADE_A: PolTrade = {
  trade_id: 'trade-001',
  ticker: 'NVDA',
  asset_description: 'NVIDIA Corporation',
  transaction_date: '2024-01-10',
  disclosure_date: '2024-01-15',
  transaction_type: 'Purchase',
  amount_min: 1000,
  amount_max: 15000,
  owner: 'Self',
  bioguide_id: 'A000001',
  politician_name: 'Jane Smith',
  chamber: 'Senate',
  party: 'D',
  state: 'CA',
  sector: 'Technology',
  conflict: false,
};

const TRADE_B: PolTrade = {
  trade_id: 'trade-002',
  ticker: 'TSLA',
  asset_description: 'Tesla Inc.',
  transaction_date: '2024-01-08',
  disclosure_date: '2024-01-12',
  transaction_type: 'Sale',
  amount_min: 15001,
  amount_max: 50000,
  owner: 'Spouse',
  bioguide_id: 'B000002',
  politician_name: 'John Doe',
  chamber: 'House',
  party: 'R',
  state: 'TX',
  sector: 'Consumer Discretionary',
  conflict: true,
};

beforeEach(() => {
  mockGetPolTrades.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetPolTrades.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderScreen();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders politician trade rows from mocked response', async () => {
  mockGetPolTrades.mockResolvedValueOnce({
    total: 2,
    trades: [TRADE_A, TRADE_B],
    jurisdiction: null,
  });
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('pol-row-trade-001')).toBeTruthy();
  });
  expect(getByTestId('pol-row-trade-002')).toBeTruthy();
  expect(getByTestId('pol-name-trade-001')).toBeTruthy();
  expect(getByTestId('pol-ticker-trade-001')).toBeTruthy();
  expect(getByTestId('pol-type-trade-001')).toBeTruthy();
});

it('shows error state when fetch fails', async () => {
  mockGetPolTrades.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});
