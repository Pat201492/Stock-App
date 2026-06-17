import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import NewsScreen from '../src/screens/NewsScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { NewsItem } from '../src/api/types';

const mockGetNews = jest.fn();

const mockClient = {
  getNews: mockGetNews,
} as unknown as StockAppClient;

function renderScreen() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: jest.fn() }}
    >
      <NewsScreen />
    </ClientContext.Provider>,
  );
}

const NEWS_A: NewsItem = {
  id: 1,
  ticker: 'AAPL',
  title: 'Apple Reports Record Earnings',
  url: 'https://example.com/news/1',
  publisher: 'Reuters',
  published_at: '2024-01-15T10:00:00Z',
  sentiment: 0.6,
  source_trust: 0.8,
  summary: 'Apple Inc. reported record quarterly earnings.',
};

const NEWS_B: NewsItem = {
  id: 2,
  ticker: null,
  title: 'Fed Holds Rates Steady',
  url: 'https://example.com/news/2',
  publisher: 'Bloomberg',
  published_at: '2024-01-15T09:00:00Z',
  sentiment: 0,
  source_trust: null,
  summary: null,
};

beforeEach(() => {
  mockGetNews.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetNews.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderScreen();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders news rows from mocked response', async () => {
  mockGetNews.mockResolvedValueOnce([NEWS_A, NEWS_B]);
  const { getByTestId, getByText } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('news-0')).toBeTruthy();
  });
  expect(getByTestId('news-1')).toBeTruthy();
  expect(getByText('Apple Reports Record Earnings')).toBeTruthy();
  // sentiment + source-trust indicators render
  expect(getByText('Bullish')).toBeTruthy();
  expect(getByText('Source 80%')).toBeTruthy();
  expect(getByText('Source: unrated')).toBeTruthy();
});

it('shows error state when fetch fails', async () => {
  mockGetNews.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});
