import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useClient } from '../context/ClientContext';
import { HoldingsResponse } from '../api/types';
import { shared, colors, spacing } from '../theme';
import AuthGate from '../components/AuthGate';

function money(v: number | null | undefined): string {
  if (v == null) return '—';
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0);
  return `$${s}`;
}

function pl(v: number | null | undefined): string {
  return v == null ? colors.text : v >= 0 ? '#1b8a3a' : colors.error;
}

function PortfolioContent() {
  const { client } = useClient();
  const [data, setData] = useState<HoldingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getHoldings()
      .then(setData)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load portfolio');
      })
      .finally(() => setLoading(false));
  }, []);

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

  const positions = data?.positions ?? [];
  const t = data?.totals;
  const retPct = t && t.cost_basis ? (t.unrealized_pl / t.cost_basis) * 100 : null;

  return (
    <ScrollView style={shared.screen} testID="portfolio">
      {t ? (
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>Portfolio Value</Text>
          <Text style={styles.heroValue}>{money(t.market_value)}</Text>
          <Text style={[styles.heroRet, { color: pl(t.unrealized_pl) }]}>
            {t.unrealized_pl >= 0 ? '▲' : '▼'} {money(t.unrealized_pl)}
            {retPct != null ? ` (${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%)` : ''} unrealized
          </Text>
          <Text style={styles.heroCost}>Cost basis {money(t.cost_basis)}</Text>
        </View>
      ) : null}

      {positions.length === 0 ? (
        <Text style={styles.empty}>
          No holdings yet. Upload a holdings CSV on the web dashboard (Account → Imported
          Holdings) and it'll appear here.
        </Text>
      ) : (
        positions.map((p) => (
          <View key={p.ticker} style={styles.row} testID={`holding-${p.ticker}`}>
            <Text style={styles.ticker}>{p.ticker}</Text>
            <View style={styles.mid}>
              <Text style={styles.sub}>
                {p.shares} sh{p.cost_basis != null ? ` @ $${p.cost_basis.toFixed(2)}` : ''}
              </Text>
              <Text style={styles.sub}>
                {p.last_price != null ? `Last $${p.last_price.toFixed(2)}` : ''}
                {p.score != null ? `  ·  Score ${p.score}` : ''}
              </Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.mv}>{money(p.market_value)}</Text>
              <Text style={[styles.plv, { color: pl(p.unrealized_pl) }]}>
                {money(p.unrealized_pl)}
                {p.unrealized_pct != null ? ` (${p.unrealized_pct >= 0 ? '+' : ''}${p.unrealized_pct}%)` : ''}
              </Text>
            </View>
          </View>
        ))
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

export default function PortfolioScreen({ navigation }: any) {
  return (
    <AuthGate navigation={navigation} feature="portfolio">
      <PortfolioContent />
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.surface,
    margin: spacing.md,
    borderRadius: 12,
    padding: spacing.md,
  },
  heroLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroValue: { fontSize: 34, fontWeight: '800', color: colors.text, marginVertical: 2 },
  heroRet: { fontSize: 14, fontWeight: '600' },
  heroCost: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  empty: { color: colors.textMuted, fontSize: 14, padding: spacing.lg, textAlign: 'center', lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  ticker: { width: 64, fontWeight: '700', fontSize: 14, color: colors.text },
  mid: { flex: 1, marginRight: spacing.sm },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  right: { alignItems: 'flex-end' },
  mv: { fontSize: 14, fontWeight: '700', color: colors.text },
  plv: { fontSize: 12, fontWeight: '600', marginTop: 2 },
});
