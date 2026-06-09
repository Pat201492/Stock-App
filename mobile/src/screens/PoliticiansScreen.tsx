import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { PolTrade } from '../api/types';

export default function PoliticiansScreen() {
  const { client } = useClient();
  const [trades, setTrades] = useState<PolTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getPolTrades()
      .then((resp) => setTrades(resp.trades))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load politician trades');
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
    <ScrollView testID="pol-list">
      {trades.map((item) => (
        <View key={item.trade_id} style={styles.row} testID={`pol-row-${item.trade_id}`}>
          <Text style={styles.name} testID={`pol-name-${item.trade_id}`}>
            {item.politician_name}
          </Text>
          <Text style={styles.ticker} testID={`pol-ticker-${item.trade_id}`}>
            {item.ticker}
          </Text>
          <Text testID={`pol-type-${item.trade_id}`}>
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
