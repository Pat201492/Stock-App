import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { InsiderTrade } from '../api/types';
import { shared, colors } from '../theme';

export default function InsidersScreen() {
  const { client } = useClient();
  const [trades, setTrades] = useState<InsiderTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await client.getInsiderTrades();
      setTrades(resp.trades);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load insider trades');
    }
  }, [client]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
    <ScrollView
      testID="insider-list"
      style={shared.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
          testID="insider-refresh"
        />
      }
    >
      {trades.map((item) => (
        <View key={item.filing_id} style={shared.row} testID={`insider-row-${item.filing_id}`}>
          <Text style={styles.name} testID={`insider-name-${item.filing_id}`}>
            {item.insider_name}
          </Text>
          <Text style={styles.ticker} testID={`insider-ticker-${item.filing_id}`}>
            {item.ticker}
          </Text>
          <Text style={styles.type} testID={`insider-type-${item.filing_id}`}>
            {item.transaction_type}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  name: { flex: 1, color: colors.text, fontSize: 14 },
  ticker: { fontWeight: 'bold', width: 60, color: colors.text },
  type: { fontSize: 12, color: colors.textMuted },
});
