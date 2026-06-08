# Stock App — Mobile (Android)

React Native + Expo (TypeScript) client for the Stock App backend.

## Quick Start

```bash
cd mobile
npm install
```

## Type Check

```bash
npx tsc --noEmit
```

## Tests

```bash
npm test
```

All tests run offline with mocked HTTP — no live backend required.

## Build (Android)

Requires [EAS CLI](https://docs.expo.dev/eas/) and an Expo account:

```bash
npm install -g eas-cli
eas build -p android
```

## Configuration

Edit `src/config.ts` to set the backend base URL before building:

```typescript
export const API_BASE_URL = 'http://your-backend-host:5000';
```

## API Client

`src/api/client.ts` exports `StockAppClient`. Construct with an optional base URL (defaults to `http://localhost:5000`):

```typescript
import { StockAppClient } from './src/api/client';

const client = new StockAppClient('http://192.168.1.10:5000');
const { stocks } = await client.getStocks({ limit: 20, sort: 'score', order: 'desc' });
```

### Available methods

| Method | Endpoint |
|---|---|
| `getStocks(params?)` | `GET /api/stocks` |
| `getEtfs(params?)` | `GET /api/etfs` |
| `getEtfDetail(ticker)` | `GET /api/etf/:ticker` |
| `getFedSummary()` | `GET /api/fed/summary` |
| `getFedCalendar()` | `GET /api/fed/calendar` |
| `getFedHistory()` | `GET /api/fed/history` |
| `getFedSeries(id, limit?)` | `GET /api/fed/series/:id` |
| `getNews(limit?)` | `GET /api/news` |
| `getTickerNews(ticker, limit?)` | `GET /api/news/:ticker` |
| `getPolTrades(params?)` | `GET /api/pol/trades` |
| `getPolPolitician(bioguideId)` | `GET /api/pol/politician/:id` |
| `getInsiderTrades(params?)` | `GET /api/insider/trades` |
| `getInsiderTicker(ticker, days?)` | `GET /api/insider/ticker/:ticker` |

All response types are defined in `src/api/types.ts`.
