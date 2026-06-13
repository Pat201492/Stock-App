import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useClient } from '../context/ClientContext';
import { PolTickerTrade, InsiderTickerTrade } from '../api/types';
import { shared, colors, spacing } from '../theme';
import { Section, ListSection, LineRow } from './DetailView';
import PolTimeline, { TLTrade, money } from '../components/PolTimeline';

function polToTimeline(trades: PolTickerTrade[]): TLTrade[] {
  return trades.map((t) => ({
    id: t.trade_id,
    date: t.transaction_date,
    politician: t.politician_name,
    party: t.party,
    chamber: t.chamber,
    ticker: '',
    type: t.transaction_type,
    amountMin: t.amount_min,
    amountMax: t.amount_max,
    bioguideId: t.bioguide_id,
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

export default function EtfDetailScreen({ route, navigation }: any) {
  const ticker: string = route?.params?.ticker ?? '';
  const { client } = useClient();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [pol, setPol] = useState<PolTickerTrade[]>([]);
  const [insider, setInsider] = useState<InsiderTickerTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      client.getEtfDetail(ticker),
      client.getPolByTicker(ticker).catch(() => ({ ticker, trades: [] })),
      client.getInsiderTicker(ticker).catch(() => ({ ticker, trades: [] })),
    ])
      .then(([d, p, ins]) => {
        setDetail((d ?? {}) as Record<string, unknown>);
        setPol(p.trades);
        setInsider(ins.trades);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load ETF');
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

  // The /api/etf/{ticker} response wraps the ETF's primitive fields under
  // `etf` and exposes nested `holdings` + `sector_weights` arrays.  Surface
  // them as their own sections — feeding the raw response to <Section> would
  // render nested objects/arrays as "[object Object]" rows.
  const etfFields = (detail?.etf ?? {}) as Record<string, unknown>;
  const holdings = (detail?.holdings ?? []) as Array<{
    ticker: string; name?: string | null;
    weight?: number | null; sector?: string | null;
    in_universe?: boolean;
  }>;
  const sectorWeights = (detail?.sector_weights ?? []) as Array<{
    sector: string; weight: number;
  }>;

  // Only stocks in our screener universe have a StockDetail page —
  // /api/stocks/{ticker} returns 404 for others. Skip the tap (and chevron)
  // for non-universe holdings so we don't navigate into a broken screen.
  const holdingRows: LineRow[] = holdings.slice(0, 15).map((h) => ({
    primary: h.ticker,
    secondary: h.name ?? undefined,
    right: h.weight != null ? `${(h.weight * 100).toFixed(2)}%` : undefined,
    sub: h.sector ?? undefined,
    onPress: h.in_universe
      ? () => navigation?.navigate('StockDetail', { ticker: h.ticker })
      : undefined,
    testID: `holding-${h.ticker}`,
  }));
  const sectorRows: LineRow[] = sectorWeights.map((s) => ({
    primary: s.sector,
    right: `${(s.weight * 100).toFixed(1)}%`,
  }));

  return (
    <ScrollView style={shared.screen} testID="etf-detail">
      {detail && <Section title={ticker} data={etfFields} />}
      {sectorRows.length > 0 ? (
        <ListSection
          title="Sector Weights"
          rows={sectorRows}
          emptyText="No sector data."
        />
      ) : null}
      {holdingRows.length > 0 ? (
        <ListSection
          title={`Top Holdings (${holdings.length})`}
          rows={holdingRows}
          emptyText="No holdings on record."
        />
      ) : null}
      <Text style={styles.sectionTitle}>Congress Trades</Text>
      <PolTimeline
        trades={polToTimeline(pol)}
        filterByPolitician
        emptyText="No congressional trades on record."
        onPressPolitician={(bioguideId, name) =>
          navigation?.navigate('PoliticianTrades', { bioguideId, name })
        }
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

const styles = {
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    marginLeft: spacing.md + spacing.xs,
  },
};
