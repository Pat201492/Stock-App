import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ScreenerScreen from '../src/screens/ScreenerScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { StockListItem } from '../src/api/types';

const mockGetStocks = jest.fn();
const mockLogout = jest.fn();
const mockSetAuthToken = jest.fn();

const mockClient = {
  getStocks: mockGetStocks,
  logout: mockLogout,
} as unknown as StockAppClient;

function renderScreener() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: mockSetAuthToken }}
    >
      <ScreenerScreen />
    </ClientContext.Provider>,
  );
}

const STOCK_A: StockListItem = {
  ticker: 'AAPL',
  name: 'Apple Inc.',
  sector: null,
  cap_size: null,
  mkt_cap: null,
  price: 150.0,
  rank: null,
  pe: null,
  roic: null,
  rev_cagr_5y: null,
  score: 85,
  rec: null,
  stars: null,
  upside: null,
};

const STOCK_B: StockListItem = {
  ticker: 'MSFT',
  name: 'Microsoft Corp.',
  sector: null,
  cap_size: null,
  mkt_cap: null,
  price: 300.0,
  rank: null,
  pe: null,
  roic: null,
  rev_cagr_5y: null,
  score: 90,
  rec: null,
  stars: null,
  upside: null,
};

beforeEach(() => {
  mockGetStocks.mockReset();
  mockLogout.mockReset();
  mockSetAuthToken.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetStocks.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderScreener();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders stock rows with ticker, name, score, and price', async () => {
  mockGetStocks.mockResolvedValueOnce({ total: 2, stocks: [STOCK_A, STOCK_B] });
  const { getByTestId } = renderScreener();
  await waitFor(() => {
    expect(getByTestId('stock-row-AAPL')).toBeTruthy();
  });
  expect(getByTestId('stock-row-MSFT')).toBeTruthy();
  expect(getByTestId('ticker-AAPL')).toBeTruthy();
  expect(getByTestId('name-AAPL')).toBeTruthy();
  expect(getByTestId('score-AAPL')).toBeTruthy();
  expect(getByTestId('price-AAPL')).toBeTruthy();
});

it('shows error state when fetch fails', async () => {
  mockGetStocks.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderScreener();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});

it('pressing logout calls client.logout() then setAuthToken(null)', async () => {
  mockGetStocks.mockResolvedValueOnce({ total: 0, stocks: [] });
  mockLogout.mockResolvedValueOnce(undefined);
  const { getByTestId } = renderScreener();
  await waitFor(() => expect(getByTestId('logout-button')).toBeTruthy());
  fireEvent.press(getByTestId('logout-button'));
  await waitFor(() => {
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockSetAuthToken).toHaveBeenCalledWith(null);
  });
});

it('calls setAuthToken(null) even when client.logout() rejects', async () => {
  mockGetStocks.mockResolvedValueOnce({ total: 0, stocks: [] });
  mockLogout.mockRejectedValueOnce(new Error('network timeout'));
  const { getByTestId } = renderScreener();
  await waitFor(() => expect(getByTestId('logout-button')).toBeTruthy());
  fireEvent.press(getByTestId('logout-button'));
  await waitFor(() => {
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockSetAuthToken).toHaveBeenCalledWith(null);
  });
});
