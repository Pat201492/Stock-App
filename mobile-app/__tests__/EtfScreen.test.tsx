import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import EtfScreen from '../src/screens/EtfScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { EtfListItem } from '../src/api/types';

const mockGetEtfs = jest.fn();

const mockClient = {
  getEtfs: mockGetEtfs,
} as unknown as StockAppClient;

function renderScreen() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: jest.fn() }}
    >
      <EtfScreen />
    </ClientContext.Provider>,
  );
}

const ETF_A: EtfListItem = {
  ticker: 'SPY',
  name: 'SPDR S&P 500 ETF Trust',
  category: 'Large Blend',
  asset_class: 'Equity',
  aum: 500000000000,
  expense_ratio: 0.0009,
  yield_pct: 1.3,
  ytd_return: 12.5,
  price: 450.0,
  weighted_score: 80,
  covered_weight: 0.95,
  holdings_count: 500,
  top_holdings: ['AAPL', 'MSFT'],
};

const ETF_B: EtfListItem = {
  ticker: 'QQQ',
  name: 'Invesco QQQ Trust',
  category: 'Large Growth',
  asset_class: 'Equity',
  aum: 200000000000,
  expense_ratio: 0.002,
  yield_pct: 0.6,
  ytd_return: 18.0,
  price: 380.0,
  weighted_score: 75,
  covered_weight: 0.85,
  holdings_count: 100,
  top_holdings: ['AAPL', 'MSFT', 'NVDA'],
};

beforeEach(() => {
  mockGetEtfs.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetEtfs.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderScreen();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders ETF rows from mocked response', async () => {
  mockGetEtfs.mockResolvedValueOnce({ total: 2, etfs: [ETF_A, ETF_B] });
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('etf-row-SPY')).toBeTruthy();
  });
  expect(getByTestId('etf-row-QQQ')).toBeTruthy();
  expect(getByTestId('etf-ticker-SPY')).toBeTruthy();
  expect(getByTestId('etf-name-SPY')).toBeTruthy();
  expect(getByTestId('etf-price-SPY')).toBeTruthy();
});

it('shows error state when fetch fails', async () => {
  mockGetEtfs.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});
