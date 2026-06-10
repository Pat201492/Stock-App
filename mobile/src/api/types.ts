// ----- Stocks / Screener -----

export interface StockListItem {
  ticker: string;
  name: string;
  sector: string | null;
  cap_size: string | null;
  mkt_cap: number | null;
  price: number | null;
  rank: number | null;
  pe: number | null;
  roic: number | null;
  rev_cagr_5y: number | null;
  score: number | null;
  rec: string | null;
  stars: number | null;
  upside: number | null;
}

export interface StocksResponse {
  total: number;
  stocks: StockListItem[];
}

export interface StocksParams {
  sector?: string;
  cap_size?: string;
  search?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  min_score?: number;
  max_score?: number;
  conflicts_only?: boolean;
}

// ----- ETF -----

export interface EtfListItem {
  ticker: string;
  name: string;
  category: string | null;
  asset_class: string | null;
  aum: number | null;
  expense_ratio: number | null;
  yield_pct: number | null;
  ytd_return: number | null;
  price: number | null;
  weighted_score: number | null;
  covered_weight: number | null;
  holdings_count: number | null;
  top_holdings: string[] | null;
}

export interface EtfsResponse {
  total: number;
  etfs: EtfListItem[];
}

export interface EtfsParams {
  search?: string;
  category?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

// ----- Fed -----

export interface FedSeriesInfo {
  id: string;
  label: string;
  context: string;
  unit: string;
}

export interface FedSummaryResponse {
  configured: boolean;
  message?: string;
  series: FedSeriesInfo[];
}

export interface FedCalendarEvent {
  date: string;
  days_until: number;
}

export interface FedCalendarResponse {
  upcoming: FedCalendarEvent[];
}

export interface FedDecision {
  date: string;
  action: string;
  change_bps: number | null;
  range: string | null;
}

export interface FedHistoryResponse {
  configured: boolean;
  decisions: FedDecision[];
}

export interface FedSeriesPoint {
  date: string;
  value: number | null;
}

export interface FedSeriesResponse {
  configured: boolean;
  id: string;
  label: string;
  unit: string;
  points: FedSeriesPoint[];
}

// ----- News -----

export interface NewsItem {
  id: number;
  ticker: string | null;
  title: string;
  url: string;
  publisher: string | null;
  published_at: string | null;
  sentiment: string | null;
  summary: string | null;
}

// ----- Politicians -----

export interface PolTrade {
  trade_id: string;
  ticker: string;
  asset_description: string | null;
  transaction_date: string;
  disclosure_date: string | null;
  transaction_type: string;
  amount_min: number | null;
  amount_max: number | null;
  owner: string | null;
  bioguide_id: string;
  politician_name: string;
  chamber: string | null;
  party: string | null;
  state: string | null;
  sector: string | null;
  conflict: boolean;
}

export interface PolTradesResponse {
  total: number;
  trades: PolTrade[];
  jurisdiction: string | null;
}

export interface PolTradesParams {
  ticker?: string;
  bioguide?: string;
  chamber?: string;
  txn_type?: string;
  committee?: string;
  conflicts_only?: boolean;
  days?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PolCommittee {
  committee_id: string;
  name: string;
  role: string | null;
}

export interface PolTopTicker {
  ticker: string;
  count: number;
  volume: number | null;
}

export interface PolPoliticianTrade {
  trade_id: string;
  transaction_date: string;
  transaction_type: string;
  amount_min: number | null;
  amount_max: number | null;
  ticker: string;
}

export interface PolPolitician {
  bioguide_id: string;
  name: string;
  chamber: string | null;
  party: string | null;
  state: string | null;
}

export interface PolPoliticianResponse {
  politician: PolPolitician;
  committees: PolCommittee[];
  total_trades: number;
  top_tickers: PolTopTicker[];
  recent_trades: PolPoliticianTrade[];
}

// ----- Account / Favorites -----

export interface FavoriteItem {
  ticker: string;
  kind: string;
  last_price: number | null;
}

export interface FavoritesResponse {
  favorites: FavoriteItem[];
}

export interface ToggleFavoriteResponse {
  ticker: string;
  favorited: boolean;
}

// ----- Insiders -----

export interface InsiderTrade {
  filing_id: string;
  ticker: string;
  company_name: string | null;
  insider_name: string;
  insider_title: string | null;
  transaction_date: string;
  transaction_type: string;
  shares: number | null;
  price_per_share: number | null;
  total_value: number | null;
  shares_owned_after: number | null;
}

export interface InsiderTradesResponse {
  total: number;
  trades: InsiderTrade[];
}

export interface InsiderTradesParams {
  ticker?: string;
  txn_type?: string;
  days?: number;
  limit?: number;
  offset?: number;
}

export interface InsiderTickerTrade {
  filing_id: string;
  insider_name: string;
  insider_title: string | null;
  transaction_date: string;
  transaction_type: string;
  shares: number | null;
  price_per_share: number | null;
  total_value: number | null;
}

export interface InsiderTickerResponse {
  ticker: string;
  trades: InsiderTickerTrade[];
}
