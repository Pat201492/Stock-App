import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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

export default function PoliticiansScreen({ navigation }: any) {
  const { client } = useClient();
  const [trades, setTrades] = useState<PolTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('politician');

  useEffect(() => {
    client
      .getPolTrades()
      .then((resp) => setTrades(resp.trades))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load politician trades');
      })
      .finally(() => setLoading(false));
  }, []);

  const politicians = useMemo(() => aggPoliticians(trades), [trades]);
  const stocks = useMemo(() => aggStocks(trades), [trades]);
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

      <ScrollView testID="pol-list">
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
