import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import FedScreen from '../src/screens/FedScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';
import type { FedSummaryResponse } from '../src/api/types';

const mockGetFedSummary = jest.fn();

const mockClient = {
  getFedSummary: mockGetFedSummary,
  getFedCalendar: jest.fn().mockResolvedValue({ upcoming: [] }),
  getFedHistory: jest.fn().mockResolvedValue({ configured: true, decisions: [] }),
  getFedNews: jest.fn().mockResolvedValue([]),
} as unknown as StockAppClient;

function renderScreen() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: 'tok', setAuthToken: jest.fn() }}
    >
      <FedScreen />
    </ClientContext.Provider>,
  );
}

const FED_RESPONSE: FedSummaryResponse = {
  configured: true,
  series: [
    {
      id: 'FEDFUNDS',
      label: 'Federal Funds Rate',
      context: 'Target range for the federal funds rate',
      unit: '%',
      value: 3.62,
      asof: '2026-06-09',
      change: 0,
    },
    {
      id: 'T10Y2Y',
      label: '10Y-2Y Treasury Spread',
      context: 'Difference between 10-year and 2-year Treasury yields',
      unit: '%',
      value: 0.45,
      asof: '2026-06-09',
      change: 0.32,
    },
  ],
};

beforeEach(() => {
  mockGetFedSummary.mockReset();
});

it('shows loading state before fetch completes', () => {
  mockGetFedSummary.mockReturnValue(new Promise(() => {}));
  const { getByTestId } = renderScreen();
  expect(getByTestId('loading-state')).toBeTruthy();
});

it('renders Fed series rows from mocked response', async () => {
  mockGetFedSummary.mockResolvedValueOnce(FED_RESPONSE);
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('fed-row-FEDFUNDS')).toBeTruthy();
  });
  expect(getByTestId('fed-row-T10Y2Y')).toBeTruthy();
  expect(getByTestId('fed-label-FEDFUNDS')).toBeTruthy();
  expect(getByTestId('fed-context-FEDFUNDS')).toBeTruthy();
  // the actual metric value must render, not just the label
  expect(getByTestId('fed-value-FEDFUNDS').props.children).toBe('3.62%');
  expect(getByTestId('fed-change-T10Y2Y').props.children).toBe('+0.32%');
});

it('shows error state when fetch fails', async () => {
  mockGetFedSummary.mockRejectedValueOnce(new Error('Network error'));
  const { getByTestId } = renderScreen();
  await waitFor(() => {
    expect(getByTestId('error-state')).toBeTruthy();
  });
});
