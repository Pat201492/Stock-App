import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import LoginScreen from '../src/screens/LoginScreen';
import { ClientContext } from '../src/context/ClientContext';
import type { StockAppClient } from '../src/api/client';

const mockLogin = jest.fn();
const mockSetAuthToken = jest.fn();

const mockClient = {
  login: mockLogin,
} as unknown as StockAppClient;

function renderLogin() {
  return render(
    <ClientContext.Provider
      value={{ client: mockClient, authToken: null, setAuthToken: mockSetAuthToken }}
    >
      <LoginScreen />
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
  mockLogin.mockReset();
  mockSetAuthToken.mockReset();
});

it('renders email input, password input, and login button', () => {
  const { getByTestId } = renderLogin();
  expect(getByTestId('email-input')).toBeTruthy();
  expect(getByTestId('password-input')).toBeTruthy();
  expect(getByTestId('login-button')).toBeTruthy();
});

it('calls client.login() with entered credentials on submit', async () => {
  mockLogin.mockResolvedValueOnce({
    token: 'tok-1',
    email: 'u@example.com',
    display_name: 'User',
  });
  const { getByTestId } = renderLogin();
  fireEvent.changeText(getByTestId('email-input'), 'u@example.com');
  fireEvent.changeText(getByTestId('password-input'), 'secret');
  fireEvent.press(getByTestId('login-button'));
  await waitFor(() => {
    expect(mockLogin).toHaveBeenCalledWith('u@example.com', 'secret');
    expect(mockSetAuthToken).toHaveBeenCalledWith('tok-1');
  });
});

it('shows error message when login fails', async () => {
  mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
  const { getByTestId } = renderLogin();
  fireEvent.changeText(getByTestId('email-input'), 'u@example.com');
  fireEvent.changeText(getByTestId('password-input'), 'wrong');
  fireEvent.press(getByTestId('login-button'));
  await waitFor(() => {
    expect(getByTestId('error-message')).toBeTruthy();
  });
});
