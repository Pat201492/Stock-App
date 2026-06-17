import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { InsiderTrade } from '../api/types';
import { shared, colors, spacing } from '../theme';
import { insiderTypeLabel, insiderTypeColor, fmtVal, fmtShares } from '../lib/insider';

export default function InsidersScreen() {
  const { client } = useClient();
  const [trades, setTrades] = useState<InsiderTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getInsiderTrades()
      .then((resp) => setTrades(resp.trades))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load insider trades');
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

  return (
    <ScrollView testID="insider-list" style={shared.screen}>
      {trades.map((item) => (
        <View key={item.filing_id} style={styles.row} testID={`insider-row-${item.filing_id}`}>
          <View style={styles.top}>
            <Text style={styles.name} testID={`insider-name-${item.filing_id}`} numberOfLines={1}>
              {item.insider_name}
            </Text>
            <Text style={styles.ticker} testID={`insider-ticker-${item.filing_id}`}>
              {item.ticker}
            </Text>
            <Text
              style={[styles.type, { color: insiderTypeColor(item.transaction_type) }]}
              testID={`insider-type-${item.filing_id}`}
            >
              {insiderTypeLabel(item.transaction_type)}
            </Text>
          </View>
          {item.insider_title ? (
            <Text style={styles.title} numberOfLines={1}>{item.insider_title}</Text>
          ) : null}
          <View style={styles.stats}>
            <Text style={styles.stat}>
              <Text style={styles.statLabel}>Shares </Text>{fmtShares(item.shares)}
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.statLabel}>@ </Text>
              {item.price_per_share != null ? `$${item.price_per_share.toFixed(2)}` : '—'}
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.statLabel}>Value </Text>
              <Text style={styles.value}>{fmtVal(item.total_value)}</Text>
            </Text>
            <Text style={styles.date}>{item.transaction_date || ''}</Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  top: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  ticker: { fontWeight: 'bold', color: colors.text, fontSize: 13, marginHorizontal: spacing.sm },
  type: { fontSize: 12, fontWeight: '700' },
  title: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  stat: { fontSize: 12, color: colors.text, marginRight: spacing.md },
  statLabel: { color: colors.textMuted },
  value: { fontWeight: '600', color: colors.text },
  date: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto' },
});
