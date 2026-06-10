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
import { shared, colors } from '../theme';

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
    <ScrollView testID="pol-list" style={shared.screen}>
      {trades.map((item) => (
        <View key={item.trade_id} style={shared.row} testID={`pol-row-${item.trade_id}`}>
          <Text style={styles.name} testID={`pol-name-${item.trade_id}`}>
            {item.politician_name}
          </Text>
          <Text style={styles.ticker} testID={`pol-ticker-${item.trade_id}`}>
            {item.ticker}
          </Text>
          <Text style={styles.type} testID={`pol-type-${item.trade_id}`}>
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
