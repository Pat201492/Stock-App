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
import { shared, colors } from '../theme';

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
