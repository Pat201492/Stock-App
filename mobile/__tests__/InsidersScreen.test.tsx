import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import InsidersScreen from '../src/screens/InsidersScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { InsiderTrade } from '../src/api/types';

const mockGetInsiderTrades = jest.fn();

const mockClient = {
  getInsiderTrades: mockGetInsiderTrades,
} as unknown as StockAppClient;

function renderScreen() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: jest.fn() }}
    >
      <InsidersScreen />
    </ClientContext.Provider>,
  );
}

const INSIDER_A: InsiderTrade = {
  filing_id: 'filing-001',
  ticker: 'AAPL',
  company_name: 'Apple Inc.',
  insider_name: 'Tim Cook',
  insider_title: 'CEO',
  transaction_date: '2024-01-10',
  transaction_type: 'Sale',
  shares: 50000,
  price_per_share: 185.5,
  total_value: 9275000,
  shares_owned_after: 3200000,
};

const INSIDER_B: InsiderTrade = {
  filing_id: 'filing-002',
  ticker: 'MSFT',
  company_name: 'Microsoft Corporation',
  insider_name: 'Satya Nadella',
  insider_title: 'CEO',
  transaction_date: '2024-01-08',
  transaction_type: 'Purchase',
  shares: 10000,
  price_per_share: 375.0,
  total_value: 3750000,
  shares_owned_after: 860000,
};

beforeEach(() => {
  mockGetInsiderTrades.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetInsiderTrades.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderScreen();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders insider trade rows from mocked response', async () => {
  mockGetInsiderTrades.mockResolvedValueOnce({
    total: 2,
    trades: [INSIDER_A, INSIDER_B],
  });
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('insider-row-filing-001')).toBeTruthy();
  });
  expect(getByTestId('insider-row-filing-002')).toBeTruthy();
  expect(getByTestId('insider-name-filing-001')).toBeTruthy();
  expect(getByTestId('insider-ticker-filing-001')).toBeTruthy();
  expect(getByTestId('insider-type-filing-001')).toBeTruthy();
});

it('shows error state when fetch fails', async () => {
  mockGetInsiderTrades.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});
