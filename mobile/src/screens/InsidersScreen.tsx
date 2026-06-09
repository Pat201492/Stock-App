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
      <View style={styles.center} testID="loading-state">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error != null) {
    return (
      <View style={styles.center} testID="error-state">
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView testID="insider-list">
      {trades.map((item) => (
        <View key={item.filing_id} style={styles.row} testID={`insider-row-${item.filing_id}`}>
          <Text style={styles.name} testID={`insider-name-${item.filing_id}`}>
            {item.insider_name}
          </Text>
          <Text style={styles.ticker} testID={`insider-ticker-${item.filing_id}`}>
            {item.ticker}
          </Text>
          <Text testID={`insider-type-${item.filing_id}`}>
            {item.transaction_type}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#c00', fontSize: 16 },
  row: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
  },
  name: { flex: 1 },
  ticker: { fontWeight: 'bold', width: 60 },
});
