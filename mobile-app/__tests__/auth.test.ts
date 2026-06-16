import { StockAppClient } from '../src/api/client';
import { saveToken, clearToken } from '../src/auth/session';

jest.mock('../src/auth/session', () => ({
  saveToken: jest.fn().mockResolvedValue(undefined),
  loadToken: jest.fn().mockResolvedValue(null),
  clearToken: jest.fn().mockResolvedValue(undefined),
}));

const mockSaveToken = saveToken as jest.Mock;
const mockClearToken = clearToken as jest.Mock;

const mockFetch = jest.fn();
(global as Record<string, unknown>).fetch = mockFetch;

function mockOk(body: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  });
}

function mockStatus(status: number): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'Error',
    json: () => Promise.resolve({}),
  });
}

describe('auth flow', () => {
  const BASE = 'http://localhost:9999';
  let client: StockAppClient;

  beforeEach(() => {
    client = new StockAppClient(BASE);
    mockFetch.mockReset();
    mockSaveToken.mockClear();
    mockClearToken.mockClear();
    (global as Record<string, unknown>).fetch = mockFetch;
  });

  it('successful login stores token', async () => {
    const resp = { token: 'tok-abc', email: 'user@example.com', display_name: 'Alice' };
    mockOk(resp);
    const result = await client.login('user@example.com', 'pass1234');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/auth/login`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'user@example.com', password: 'pass1234' }),
      }),
    );
    expect(mockSaveToken).toHaveBeenCalledWith('tok-abc');
    expect(client.getToken()).toBe('tok-abc');
    expect(result.token).toBe('tok-abc');
  });

  it('logout clears token', async () => {
    client.setToken('tok-xyz');
    mockOk({ ok: true });
    await client.logout();
    expect(mockClearToken).toHaveBeenCalled();
    expect(client.getToken()).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/auth/logout`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'tok-xyz' }),
      }),
    );
  });

  it('authenticated requests attach Authorization header', async () => {
    client.setToken('bearer-token-123');
    mockOk({ total: 0, stocks: [] });
    await client.getStocks();
    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/stocks`, {
      headers: { Authorization: 'Bearer bearer-token-123' },
    });
  });

  it('401 response clears session', async () => {
    client.setToken('expired-token');
    mockStatus(401);
    await expect(client.getStocks()).rejects.toThrow('HTTP 401');
    expect(mockClearToken).toHaveBeenCalled();
    expect(client.getToken()).toBeNull();
  });
});
