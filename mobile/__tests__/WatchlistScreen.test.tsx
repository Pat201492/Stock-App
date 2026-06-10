import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import WatchlistScreen from '../src/screens/WatchlistScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { FavoriteItem } from '../src/api/types';

const mockGetFavorites = jest.fn();
const mockSetAuthToken = jest.fn();

const mockClient = {
  getFavorites: mockGetFavorites,
} as unknown as StockAppClient;

function renderWatchlist() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: mockSetAuthToken }}
    >
      <WatchlistScreen />
    </ClientContext.Provider>,
  );
}

const FAV_AAPL: FavoriteItem = { ticker: 'AAPL', kind: 'stock', last_price: 150.0 };
const FAV_MSFT: FavoriteItem = { ticker: 'MSFT', kind: 'stock', last_price: 300.0 };

const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: Parameters<typeof console.error>) => {
    if (typeof args[0] === 'string' && args[0].includes('act(...)')) return;
    originalConsoleError(...args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});

beforeEach(() => {
  mockGetFavorites.mockReset();
  mockSetAuthToken.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetFavorites.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderWatchlist();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders favorite rows from response', async () => {
  mockGetFavorites.mockResolvedValueOnce({ favorites: [FAV_AAPL, FAV_MSFT] });
  const { getByTestId } = renderWatchlist();
  await waitFor(() => {
    expect(getByTestId('fav-row-AAPL')).toBeTruthy();
  });
  expect(getByTestId('fav-row-MSFT')).toBeTruthy();
  expect(getByTestId('fav-ticker-AAPL')).toBeTruthy();
  expect(getByTestId('fav-price-AAPL')).toBeTruthy();
});

it('shows error state when fetch fails', async () => {
  mockGetFavorites.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderWatchlist();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});

it('renders empty state when favorites list is empty', async () => {
  mockGetFavorites.mockResolvedValueOnce({ favorites: [] });
  const { getByTestId } = renderWatchlist();
  await waitFor(() => {
    expect(getByTestId('empty-state')).toBeTruthy();
  });
});
