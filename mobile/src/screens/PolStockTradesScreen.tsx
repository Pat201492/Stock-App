import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useClient } from '../context/ClientContext';
import { PolTickerTrade } from '../api/types';
import { shared, colors, spacing } from '../theme';
import PolTimeline, { TLTrade, isBuy, isSell } from '../components/PolTimeline';

export default function PolStockTradesScreen({ route, navigation }: any) {
  const ticker: string = route?.params?.ticker ?? '';
  const { client } = useClient();
  const [trades, setTrades] = useState<PolTickerTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getPolByTicker(ticker)
      .then((r) => setTrades(r.trades))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load trades');
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

  const buys = trades.filter((t) => isBuy(t.transaction_type)).length;
  const sells = trades.filter((t) => isSell(t.transaction_type)).length;
  const members = new Set(trades.map((t) => t.bioguide_id)).size;

  const tl: TLTrade[] = trades.map((t) => ({
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

  return (
    <ScrollView style={shared.screen} testID="pol-stock-trades">
      <View style={styles.header}>
        <Text style={styles.ticker}>{ticker}</Text>
        <Text style={styles.meta}>
          {members} members · {buys} buys · {sells} sells
        </Text>
      </View>
      <PolTimeline
        trades={tl}
        filterByPolitician
        emptyText="No congressional trades on record."
        onPressPolitician={(bioguideId, name) =>
          navigation?.navigate('PoliticianTrades', { bioguideId, name })
        }
      />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    margin: spacing.md,
    borderRadius: 12,
    padding: spacing.md,
  },
  ticker: { fontSize: 22, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
});
