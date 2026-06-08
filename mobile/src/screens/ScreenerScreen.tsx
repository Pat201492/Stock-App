import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { StockListItem } from '../api/types';

export default function ScreenerScreen() {
  const { client, setAuthToken } = useClient();
  const [stocks, setStocks] = useState<StockListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getStocks()
      .then((resp) => {
        setStocks(resp.stocks);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load stocks');
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await client.logout();
    setAuthToken(null);
  }

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
    <View style={styles.container}>
      <TouchableOpacity
        onPress={handleLogout}
        style={styles.logoutButton}
        testID="logout-button"
      >
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>
      <ScrollView testID="stock-list">
        {stocks.map((item) => (
          <View key={item.ticker} style={styles.row} testID={`stock-row-${item.ticker}`}>
            <Text style={styles.ticker} testID={`ticker-${item.ticker}`}>
              {item.ticker}
            </Text>
            <Text style={styles.name} testID={`name-${item.ticker}`}>
              {item.name}
            </Text>
            <Text testID={`score-${item.ticker}`}>
              {item.score != null ? String(item.score) : '–'}
            </Text>
            <Text testID={`price-${item.ticker}`}>
              {item.price != null ? `$${item.price.toFixed(2)}` : '–'}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#c00', fontSize: 16 },
  logoutButton: { padding: 16, alignItems: 'flex-end' },
  logoutText: { color: '#007aff' },
  row: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
  },
  ticker: { fontWeight: 'bold', width: 60 },
  name: { flex: 1 },
});
