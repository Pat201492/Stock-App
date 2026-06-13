import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { PolTrade } from '../api/types';
import { shared, colors, spacing } from '../theme';
import { money, isBuy, isSell, fmtDate } from '../components/PolTimeline';

interface PolAgg {
  bioguideId: string;
  name: string;
  party: string | null;
  chamber: string | null;
  count: number;
  buys: number;
  sells: number;
  volume: number;
}

interface StockAgg {
  ticker: string;
  count: number;
  buys: number;
  sells: number;
  volume: number;
}

function midpoint(t: PolTrade): number {
  if (t.amount_min != null && t.amount_max != null) {
    return (t.amount_min + t.amount_max) / 2;
  }
  return t.amount_min ?? 0;
}

function aggPoliticians(trades: PolTrade[]): PolAgg[] {
  const map = new Map<string, PolAgg>();
  for (const t of trades) {
    let a = map.get(t.bioguide_id);
    if (!a) {
      a = {
        bioguideId: t.bioguide_id,
        name: t.politician_name,
        party: t.party,
        chamber: t.chamber,
        count: 0,
        buys: 0,
        sells: 0,
        volume: 0,
      };
      map.set(t.bioguide_id, a);
    }
    a.count += 1;
    if (isBuy(t.transaction_type)) a.buys += 1;
    else if (isSell(t.transaction_type)) a.sells += 1;
    a.volume += midpoint(t);
  }
  return Array.from(map.values()).sort((x, y) => y.count - x.count);
}

function aggStocks(trades: PolTrade[]): StockAgg[] {
  const map = new Map<string, StockAgg>();
  for (const t of trades) {
    if (!t.ticker) continue;
    let a = map.get(t.ticker);
    if (!a) {
      a = { ticker: t.ticker, count: 0, buys: 0, sells: 0, volume: 0 };
      map.set(t.ticker, a);
    }
    a.count += 1;
    if (isBuy(t.transaction_type)) a.buys += 1;
    else if (isSell(t.transaction_type)) a.sells += 1;
    a.volume += midpoint(t);
  }
  return Array.from(map.values()).sort((x, y) => y.count - x.count);
}

type Mode = 'politician' | 'stock';
type SortKey = 'count' | 'volume';
type RangeKey = '7d' | '30d' | '90d' | '1y' | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string; days?: number }[] = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: '1y', label: '1y', days: 365 },
  { key: 'all', label: 'All' },
];

export default function PoliticiansScreen({ navigation }: any) {
  const { client } = useClient();
  const [trades, setTrades] = useState<PolTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('politician');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [range, setRange] = useState<RangeKey>('all');

  const load = useCallback(async () => {
    try {
      const days = RANGE_OPTIONS.find((r) => r.key === range)?.days;
      const resp = await client.getPolTrades(days != null ? { days } : undefined);
      setTrades(resp.trades);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load politician trades');
    }
  }, [client, range]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const politicians = useMemo(() => {
    const list = aggPoliticians(trades);
    return sortKey === 'volume'
      ? [...list].sort((a, b) => b.volume - a.volume)
      : list;
  }, [trades, sortKey]);
  const stocks = useMemo(() => {
    const list = aggStocks(trades);
    return sortKey === 'volume'
      ? [...list].sort((a, b) => b.volume - a.volume)
      : list;
  }, [trades, sortKey]);
  const latestDate = useMemo(() => {
    let max = '';
    for (const t of trades) {
      if (t.transaction_date && t.transaction_date > max) max = t.transaction_date;
    }
    return max;
  }, [trades]);

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
    <View style={shared.screen}>
      {latestDate ? (
        <View style={styles.dataDateBar} testID="pol-data-date">
          <Text style={styles.dataDateText}>
            Latest disclosed trade: {fmtDate(latestDate)}
          </Text>
        </View>
      ) : null}
      <View style={styles.toggle} testID="pol-toggle">
        <TouchableOpacity
          style={[styles.tab, mode === 'politician' && styles.tabActive]}
          onPress={() => setMode('politician')}
          testID="toggle-politician"
        >
          <Text style={[styles.tabText, mode === 'politician' && styles.tabTextActive]}>
            By Politician
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'stock' && styles.tabActive]}
          onPress={() => setMode('stock')}
          testID="toggle-stock"
        >
          <Text style={[styles.tabText, mode === 'stock' && styles.tabTextActive]}>
            By Stock
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow} testID="pol-range">
        {RANGE_OPTIONS.map((r) => (
          <TouchableOpacity
            key={r.key}
            style={[styles.chip, range === r.key && styles.chipActive]}
            onPress={() => setRange(r.key)}
            testID={`range-${r.key}`}
          >
            <Text style={[styles.chipText, range === r.key && styles.chipTextActive]}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.chip, sortKey === 'count' && styles.chipActive]}
          onPress={() => setSortKey('count')}
          testID="sort-count"
        >
          <Text style={[styles.chipText, sortKey === 'count' && styles.chipTextActive]}>
            # trades
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, sortKey === 'volume' && styles.chipActive]}
          onPress={() => setSortKey('volume')}
          testID="sort-volume"
        >
          <Text style={[styles.chipText, sortKey === 'volume' && styles.chipTextActive]}>
            $ vol
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        testID="pol-list"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            testID="pol-refresh"
          />
        }
      >
        {mode === 'politician'
          ? politicians.map((p) => (
              <TouchableOpacity
                key={p.bioguideId}
                style={shared.row}
                testID={`pol-agg-${p.bioguideId}`}
                onPress={() =>
                  navigation?.navigate('PoliticianTrades', {
                    bioguideId: p.bioguideId,
                    name: p.name,
                  })
                }
              >
                <View style={styles.left}>
                  <Text style={styles.title} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.sub}>
                    {[p.party, p.chamber].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.count}>{p.count} trades</Text>
                  <Text style={styles.sub}>
                    <Text style={styles.buy}>{p.buys}B</Text> ·{' '}
                    <Text style={styles.sell}>{p.sells}S</Text>
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))
          : stocks.map((s) => (
              <TouchableOpacity
                key={s.ticker}
                style={shared.row}
                testID={`stock-agg-${s.ticker}`}
                onPress={() =>
                  navigation?.navigate('PolStockTrades', { ticker: s.ticker })
                }
              >
                <Text style={styles.ticker}>{s.ticker}</Text>
                <View style={styles.left}>
                  <Text style={styles.sub}>{s.count} trades</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.sub}>
                    <Text style={styles.buy}>{s.buys}B</Text> ·{' '}
                    <Text style={styles.sell}>{s.sells}S</Text>
                  </Text>
                  <Text style={styles.sub}>
                    {s.volume > 0 ? money(s.volume) : '–'}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dataDateBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  dataDateText: { fontSize: 12, color: colors.textMuted },
  toggle: {
    flexDirection: 'row',
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: { backgroundColor: colors.primary },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  left: { flex: 1, marginRight: spacing.sm },
  right: { alignItems: 'flex-end', marginRight: spacing.sm },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  ticker: { fontSize: 15, fontWeight: '700', color: colors.text, width: 70 },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  count: { fontSize: 13, fontWeight: '600', color: colors.text },
  buy: { color: '#1b8a3a', fontWeight: '600' },
  sell: { color: colors.error, fontWeight: '600' },
  chevron: { fontSize: 20, color: colors.textMuted },
});
