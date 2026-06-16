import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useClient } from '../context/ClientContext';
import { PolPoliticianResponse } from '../api/types';
import { shared, colors, spacing } from '../theme';
import PolTimeline, { TLTrade } from '../components/PolTimeline';

export default function PoliticianTradesScreen({ route }: any) {
  const bioguideId: string = route?.params?.bioguideId ?? '';
  const { client } = useClient();
  const [data, setData] = useState<PolPoliticianResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getPolPolitician(bioguideId)
      .then(setData)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load politician');
      })
      .finally(() => setLoading(false));
  }, [bioguideId]);

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

  const trades: TLTrade[] = (data?.recent_trades ?? []).map((t) => ({
    id: t.trade_id,
    date: t.transaction_date,
    politician: '',
    ticker: t.ticker,
    type: t.transaction_type,
    amountMin: t.amount_min,
    amountMax: t.amount_max,
  }));

  return (
    <ScrollView style={shared.screen} testID="politician-trades">
      {data && (
        <View style={styles.header}>
          <Text style={styles.name}>{data.politician.name}</Text>
          <Text style={styles.meta}>
            {[data.politician.party, data.politician.chamber, data.politician.state]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text style={styles.count}>{data.total_trades} total trades</Text>
          {data.top_tickers.length > 0 && (
            <View style={styles.chips}>
              {data.top_tickers.slice(0, 5).map((t) => (
                <View key={t.ticker} style={styles.chip}>
                  <Text style={styles.chipText}>
                    {t.ticker} · {t.count}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      <PolTimeline trades={trades} emptyText="No recent trades." />
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
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  count: { fontSize: 13, color: colors.text, marginTop: spacing.sm, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  chip: {
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  chipText: { fontSize: 12, color: colors.text, fontWeight: '600' },
});
