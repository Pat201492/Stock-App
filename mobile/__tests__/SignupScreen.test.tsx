import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SignupScreen from '../src/screens/SignupScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';

const mockSignup = jest.fn();
const mockSetAuthToken = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));

const mockClient = {
  signup: mockSignup,
} as unknown as StockAppClient;

function renderSignup() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: null, setAuthToken: mockSetAuthToken }}
    >
      <SignupScreen />
    </ClientContext.Provider>,
  );
}

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
  mockSignup.mockReset();
  mockSetAuthToken.mockReset();
});

it('renders email input, password input, and signup button', () => {
  const { getByTestId } = renderSignup();
  expect(getByTestId('email-input')).toBeTruthy();
  expect(getByTestId('password-input')).toBeTruthy();
  expect(getByTestId('signup-button')).toBeTruthy();
});

it('calls client.signup() with entered credentials on submit', async () => {
  mockSignup.mockResolvedValueOnce({
    token: 'tok-1',
    email: 'new@example.com',
    display_name: '',
  });
  const { getByTestId } = renderSignup();
  fireEvent.changeText(getByTestId('email-input'), 'new@example.com');
  fireEvent.changeText(getByTestId('password-input'), 'password123');
  fireEvent.press(getByTestId('signup-button'));
  await waitFor(() => {
    expect(mockSignup).toHaveBeenCalledWith('new@example.com', 'password123');
    expect(mockSetAuthToken).toHaveBeenCalledWith('tok-1');
  });
});

it('shows error message when signup fails', async () => {
  mockSignup.mockRejectedValueOnce(new Error('That email is already registered.'));
  const { getByTestId } = renderSignup();
  fireEvent.changeText(getByTestId('email-input'), 'exists@example.com');
  fireEvent.changeText(getByTestId('password-input'), 'password123');
  fireEvent.press(getByTestId('signup-button'));
  await waitFor(() => {
    expect(getByTestId('error-message')).toBeTruthy();
  });
});
