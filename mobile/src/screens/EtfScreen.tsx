import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { EtfListItem } from '../api/types';

export default function EtfScreen() {
  const { client } = useClient();
  const [etfs, setEtfs] = useState<EtfListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getEtfs()
      .then((resp) => setEtfs(resp.etfs))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load ETFs');
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
    <ScrollView testID="etf-list">
      {etfs.map((item) => (
        <View key={item.ticker} style={styles.row} testID={`etf-row-${item.ticker}`}>
          <Text style={styles.ticker} testID={`etf-ticker-${item.ticker}`}>
            {item.ticker}
          </Text>
          <Text style={styles.name} testID={`etf-name-${item.ticker}`}>
            {item.name}
          </Text>
          <Text testID={`etf-price-${item.ticker}`}>
            {item.price != null ? `$${item.price.toFixed(2)}` : '–'}
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
  ticker: { fontWeight: 'bold', width: 60 },
  name: { flex: 1 },
});
