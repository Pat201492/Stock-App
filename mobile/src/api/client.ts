import { API_BASE_URL } from '../config';
import { saveToken, clearToken } from '../auth/session';
import {
  EtfsParams,
  EtfsResponse,
  FavoritesResponse,
  FedCalendarResponse,
  FedHistoryResponse,
  FedSeriesResponse,
  FedSummaryResponse,
  InsiderTickerResponse,
  InsiderTradesParams,
  InsiderTradesResponse,
  NewsItem,
  PolPoliticianResponse,
  PolTradesParams,
  PolTradesResponse,
  StocksParams,
  StocksResponse,
  ToggleFavoriteResponse,
  StockDetailResponse,
  PolTickerResponse,
} from './types';

export interface AuthUser {
  token: string;
  email: string;
  display_name: string;
}

export class StockAppClient {
  private readonly baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private buildUrl(path: string, params?: object): string {
    const base = `${this.baseUrl}${path}`;
    if (!params) return base;
    const entries = Object.entries(params).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return base;
    const qs = entries
      .map(
        ([k, v]) =>
          `${encodeURIComponent(k)}=${encodeURIComponent(String(v as string))}`,
      )
      .join('&');
    return `${base}?${qs}`;
  }

  private async clearSession(): Promise<void> {
    this.token = null;
    await clearToken();
  }

  private async get<T>(path: string, params?: object): Promise<T> {
    const url = this.buildUrl(path, params);
    const response = this.token
      ? await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } })
      : await fetch(url);
    if (response.status === 401) {
      await this.clearSession();
      throw new Error(`HTTP 401: ${response.statusText}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  private async postQuery<T>(path: string, params?: object): Promise<T> {
    const url = this.buildUrl(path, params);
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(url, { method: 'POST', headers });
    if (response.status === 401) {
      await this.clearSession();
      throw new Error(`HTTP 401: ${response.statusText}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (response.status === 401) {
      await this.clearSession();
      throw new Error(`HTTP 401: ${response.statusText}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  // ----- Push notifications -----

  registerFcmToken(fcmToken: string): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>('/api/push/register', { fcm_token: fcmToken });
  }

  // ----- Auth -----

  async signup(email: string, password: string, display_name?: string): Promise<AuthUser> {
    const data = await this.post<AuthUser>('/api/auth/signup', { email, password, display_name });
    this.token = data.token;
    await saveToken(data.token);
    return data;
  }

  async login(email: string, password: string): Promise<AuthUser> {
    const data = await this.post<AuthUser>('/api/auth/login', { email, password });
    this.token = data.token;
    await saveToken(data.token);
    return data;
  }

  async logout(): Promise<void> {
    const tok = this.token;
    await this.clearSession();
    if (tok) {
      await this.post<{ ok: boolean }>('/api/auth/logout', { token: tok });
    }
  }

  getMe(): Promise<{ email: string; display_name: string }> {
    return this.get('/api/auth/me');
  }

  // ----- Account / Favorites -----

  getFavorites(): Promise<FavoritesResponse> {
    return this.get<FavoritesResponse>('/api/account/favorites');
  }

  toggleFavorite(ticker: string, kind: string = 'stock'): Promise<ToggleFavoriteResponse> {
    return this.postQuery<ToggleFavoriteResponse>('/api/account/favorite', { ticker, kind });
  }

  // ----- Screener -----

  getStocks(params?: StocksParams): Promise<StocksResponse> {
    return this.get<StocksResponse>('/api/stocks', params);
  }

  getStockDetail(ticker: string): Promise<StockDetailResponse> {
    return this.get<StockDetailResponse>(
      `/api/stocks/${encodeURIComponent(ticker)}`,
    );
  }

  // ----- ETF -----

  getEtfs(params?: EtfsParams): Promise<EtfsResponse> {
    return this.get<EtfsResponse>('/api/etfs', params);
  }

  getEtfDetail(ticker: string): Promise<unknown> {
    return this.get(`/api/etf/${encodeURIComponent(ticker)}`);
  }

  // ----- Fed -----

  getFedSummary(): Promise<FedSummaryResponse> {
    return this.get<FedSummaryResponse>('/api/fed/summary');
  }

  getFedCalendar(): Promise<FedCalendarResponse> {
    return this.get<FedCalendarResponse>('/api/fed/calendar');
  }

  getFedHistory(): Promise<FedHistoryResponse> {
    return this.get<FedHistoryResponse>('/api/fed/history');
  }

  getFedSeries(seriesId: string, limit?: number): Promise<FedSeriesResponse> {
    return this.get<FedSeriesResponse>(
      `/api/fed/series/${encodeURIComponent(seriesId)}`,
      limit !== undefined ? { limit } : undefined,
    );
  }

  // ----- News -----

  getNews(limit?: number): Promise<NewsItem[]> {
    return this.get<NewsItem[]>(
      '/api/news',
      limit !== undefined ? { limit } : undefined,
    );
  }

  getTickerNews(ticker: string, limit?: number): Promise<NewsItem[]> {
    return this.get<NewsItem[]>(
      `/api/news/${encodeURIComponent(ticker)}`,
      limit !== undefined ? { limit } : undefined,
    );
  }

  // ----- Politicians -----

  getPolTrades(params?: PolTradesParams): Promise<PolTradesResponse> {
    return this.get<PolTradesResponse>('/api/pol/trades', params);
  }

  getPolPolitician(bioguideId: string): Promise<PolPoliticianResponse> {
    return this.get<PolPoliticianResponse>(
      `/api/pol/politician/${encodeURIComponent(bioguideId)}`,
    );
  }

  getPolByTicker(ticker: string, days?: number): Promise<PolTickerResponse> {
    return this.get<PolTickerResponse>(
      `/api/pol/ticker/${encodeURIComponent(ticker)}`,
      days !== undefined ? { days } : undefined,
    );
  }

  // ----- Insiders -----

  getInsiderTrades(params?: InsiderTradesParams): Promise<InsiderTradesResponse> {
    return this.get<InsiderTradesResponse>('/api/insider/trades', params);
  }

  getInsiderTicker(ticker: string, days?: number): Promise<InsiderTickerResponse> {
    return this.get<InsiderTickerResponse>(
      `/api/insider/ticker/${encodeURIComponent(ticker)}`,
      days !== undefined ? { days } : undefined,
    );
  }
}
