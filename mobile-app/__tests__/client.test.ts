import { StockAppClient } from '../src/api/client';

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

function mockError(status: number): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({}),
  });
}

describe('StockAppClient', () => {
  const BASE = 'http://localhost:9999';
  let client: StockAppClient;

  beforeEach(() => {
    client = new StockAppClient(BASE);
    mockFetch.mockReset();
    (global as Record<string, unknown>).fetch = mockFetch;
  });

  describe('getStocks', () => {
    it('calls /api/stocks with no params', async () => {
      const data = { total: 0, stocks: [] };
      mockOk(data);
      const result = await client.getStocks();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/stocks`);
      expect(result).toEqual(data);
    });

    it('appends query params', async () => {
      mockOk({ total: 0, stocks: [] });
      await client.getStocks({ limit: 10, sector: 'Technology' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('sector=Technology');
    });

    it('omits undefined params', async () => {
      mockOk({ total: 0, stocks: [] });
      await client.getStocks({ limit: 5, sector: undefined });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=5');
      expect(url).not.toContain('sector');
    });
  });

  describe('getEtfs', () => {
    it('calls /api/etfs', async () => {
      mockOk({ total: 0, etfs: [] });
      const result = await client.getEtfs();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/etfs`);
      expect(result.total).toBe(0);
    });

    it('appends category param', async () => {
      mockOk({ total: 0, etfs: [] });
      await client.getEtfs({ category: 'Bond' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('category=Bond');
    });
  });

  describe('getEtfDetail', () => {
    it('calls /api/etf/:ticker', async () => {
      mockOk({});
      await client.getEtfDetail('SPY');
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/etf/SPY`);
    });
  });

  describe('getFedSummary', () => {
    it('calls /api/fed/summary', async () => {
      const data = { configured: true, series: [] };
      mockOk(data);
      const result = await client.getFedSummary();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/fed/summary`);
      expect(result.configured).toBe(true);
    });
  });

  describe('getFedCalendar', () => {
    it('calls /api/fed/calendar', async () => {
      mockOk({ upcoming: [] });
      await client.getFedCalendar();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/fed/calendar`);
    });
  });

  describe('getFedHistory', () => {
    it('calls /api/fed/history', async () => {
      mockOk({ configured: false, decisions: [] });
      await client.getFedHistory();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/fed/history`);
    });
  });

  describe('getFedSeries', () => {
    it('calls /api/fed/series/:id with no limit', async () => {
      mockOk({ configured: true, id: 'FEDFUNDS', label: 'Fed Funds', unit: '%', points: [] });
      await client.getFedSeries('FEDFUNDS');
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/fed/series/FEDFUNDS`);
    });

    it('appends limit param when provided', async () => {
      mockOk({ configured: true, id: 'FEDFUNDS', label: '', unit: '', points: [] });
      await client.getFedSeries('FEDFUNDS', 90);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=90');
    });
  });

  describe('getNews', () => {
    it('calls /api/news with no params', async () => {
      mockOk([]);
      await client.getNews();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/news`);
    });

    it('appends limit param', async () => {
      mockOk([]);
      await client.getNews(20);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('limit=20');
    });
  });

  describe('getTickerNews', () => {
    it('calls /api/news/:ticker', async () => {
      mockOk([]);
      await client.getTickerNews('AAPL');
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/news/AAPL`);
    });
  });

  describe('getPolTrades', () => {
    it('calls /api/pol/trades', async () => {
      mockOk({ total: 0, trades: [], jurisdiction: null });
      const result = await client.getPolTrades();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/pol/trades`);
      expect(result.total).toBe(0);
    });

    it('appends filter params', async () => {
      mockOk({ total: 0, trades: [], jurisdiction: null });
      await client.getPolTrades({ ticker: 'AAPL', chamber: 'House', limit: 50 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('ticker=AAPL');
      expect(url).toContain('chamber=House');
      expect(url).toContain('limit=50');
    });
  });

  describe('getPolPolitician', () => {
    it('calls /api/pol/politician/:id', async () => {
      const data = {
        politician: { bioguide_id: 'A000001', name: 'Alice', chamber: null, party: null, state: null },
        committees: [],
        total_trades: 5,
        top_tickers: [],
        recent_trades: [],
      };
      mockOk(data);
      const result = await client.getPolPolitician('A000001');
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/pol/politician/A000001`);
      expect(result.total_trades).toBe(5);
    });
  });

  describe('getInsiderTrades', () => {
    it('calls /api/insider/trades', async () => {
      mockOk({ total: 0, trades: [] });
      const result = await client.getInsiderTrades();
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/insider/trades`);
      expect(result.total).toBe(0);
    });

    it('appends ticker param', async () => {
      mockOk({ total: 0, trades: [] });
      await client.getInsiderTrades({ ticker: 'MSFT', limit: 25 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('ticker=MSFT');
      expect(url).toContain('limit=25');
    });
  });

  describe('getInsiderTicker', () => {
    it('calls /api/insider/ticker/:ticker', async () => {
      mockOk({ ticker: 'AAPL', trades: [] });
      const result = await client.getInsiderTicker('AAPL');
      expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/insider/ticker/AAPL`);
      expect(result.ticker).toBe('AAPL');
    });

    it('appends days param', async () => {
      mockOk({ ticker: 'AAPL', trades: [] });
      await client.getInsiderTicker('AAPL', 30);
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('days=30');
    });
  });

  describe('error handling', () => {
    it('throws on HTTP 404', async () => {
      mockError(404);
      await expect(client.getStocks()).rejects.toThrow('HTTP 404');
    });

    it('throws on HTTP 500', async () => {
      mockError(500);
      await expect(client.getEtfs()).rejects.toThrow('HTTP 500');
    });
  });

  describe('base URL trailing slash', () => {
    it('strips trailing slash from baseUrl', async () => {
      const slashedClient = new StockAppClient('http://localhost:9999/');
      mockOk({ total: 0, stocks: [] });
      await slashedClient.getStocks();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:9999/api/stocks');
    });
  });
});
