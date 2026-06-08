import { StockAppClient } from '../src/api/client';
import { registerFcmToken } from '../src/api/fcm';

jest.mock('../src/auth/session', () => ({
  saveToken: jest.fn().mockResolvedValue(undefined),
  loadToken: jest.fn().mockResolvedValue(null),
  clearToken: jest.fn().mockResolvedValue(undefined),
}));

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

describe('registerFcmToken', () => {
  const BASE = 'http://localhost:9999';
  let client: StockAppClient;

  beforeEach(() => {
    client = new StockAppClient(BASE);
    client.setToken('session-token-abc');
    mockFetch.mockReset();
    (global as Record<string, unknown>).fetch = mockFetch;
  });

  it('posts fcm_token to /api/push/register', async () => {
    mockOk({ ok: true });
    await registerFcmToken(client, 'device-fcm-token-123');
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/push/register`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ fcm_token: 'device-fcm-token-123' }),
      }),
    );
  });

  it('includes Authorization header from client token', async () => {
    mockOk({ ok: true });
    await registerFcmToken(client, 'another-device-token');
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer session-token-abc');
  });

  it('payload body contains only fcm_token key', async () => {
    mockOk({ ok: true });
    await registerFcmToken(client, 'tok-xyz');
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ fcm_token: 'tok-xyz' });
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: () => Promise.resolve({ error: 'fcm_token required' }),
    });
    await expect(registerFcmToken(client, '')).rejects.toThrow('HTTP 422');
  });

  it('resolves without error on success', async () => {
    mockOk({ ok: true });
    await expect(registerFcmToken(client, 'valid-token')).resolves.toBeUndefined();
  });
});
