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
import { EtfListItem } from '../api/types';
import { shared, colors } from '../theme';

export default function EtfScreen({ navigation }: any) {
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
    <ScrollView testID="etf-list" style={shared.screen}>
      {etfs.map((item) => (
        <TouchableOpacity
          key={item.ticker}
          style={shared.row}
          testID={`etf-row-${item.ticker}`}
          onPress={() => navigation?.navigate('EtfDetail', { ticker: item.ticker })}
        >
          <Text style={styles.ticker} testID={`etf-ticker-${item.ticker}`}>
            {item.ticker}
          </Text>
          <Text style={styles.name} testID={`etf-name-${item.ticker}`}>
            {item.name}
          </Text>
          <Text style={styles.price} testID={`etf-price-${item.ticker}`}>
            {item.price != null ? `$${item.price.toFixed(2)}` : '–'}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ticker: { fontWeight: 'bold', width: 60, color: colors.text },
  name: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  price: { fontSize: 13, fontWeight: '600', color: colors.text },
});
