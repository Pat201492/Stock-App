import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useClient } from '../context/ClientContext';
import {
  StockDetailResponse,
  PolTickerTrade,
  InsiderTickerTrade,
} from '../api/types';
import { shared, colors } from '../theme';
import { Section, ListSection, LineRow } from './DetailView';

function money(n: number | null): string {
  if (n == null) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function polRows(trades: PolTickerTrade[]): LineRow[] {
  return trades.map((t) => ({
    primary: t.politician_name,
    secondary: [t.party, t.chamber].filter(Boolean).join(' · ') || undefined,
    right: `${t.transaction_type}`,
    sub:
      t.amount_min != null
        ? `${money(t.amount_min)}–${money(t.amount_max)} · ${t.transaction_date ?? ''}`
        : t.transaction_date ?? undefined,
  }));
}

function insiderRows(trades: InsiderTickerTrade[]): LineRow[] {
  return trades.map((t) => ({
    primary: t.insider_name,
    secondary: t.insider_title ?? undefined,
    right: t.transaction_type,
    sub: [
      t.shares != null ? `${t.shares} sh` : null,
      t.total_value != null ? money(t.total_value) : null,
      t.transaction_date,
    ]
      .filter(Boolean)
      .join(' · '),
  }));
}

export default function StockDetailScreen({ route }: any) {
  const ticker: string = route?.params?.ticker ?? '';
  const { client } = useClient();
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [pol, setPol] = useState<PolTickerTrade[]>([]);
  const [insider, setInsider] = useState<InsiderTickerTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      client.getStockDetail(ticker),
      client.getPolByTicker(ticker).catch(() => ({ ticker, trades: [] })),
      client.getInsiderTicker(ticker).catch(() => ({ ticker, trades: [] })),
    ])
      .then(([d, p, ins]) => {
        setDetail(d);
        setPol(p.trades);
        setInsider(ins.trades);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load stock');
      })
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <View style={shared.center} testID="loading-state">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error != null) {
    return (
      <View style={shared.center} testID="error-state">
        <Text style={shared.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={shared.screen} testID="stock-detail">
      {detail && (
        <>
          <Section title="Overview" data={detail.stock} />
          <Section title="Fundamentals" data={detail.fundamentals} />
          <Section title="Valuation" data={detail.valuation} />
        </>
      )}
      <ListSection
        title="Congress Trades"
        rows={polRows(pol)}
        emptyText="No congressional trades on record."
      />
      <ListSection
        title="Insider Trades"
        rows={insiderRows(insider)}
        emptyText="No insider trades on record."
      />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}
