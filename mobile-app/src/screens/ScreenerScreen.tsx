import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { StockListItem } from '../api/types';
import { shared, colors } from '../theme';
import { useRefresh } from '../lib/useRefresh';

export default function ScreenerScreen({ navigation }: any) {
  const { client, setAuthToken } = useClient();
  const [stocks, setStocks] = useState<StockListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const resp = await client.getStocks();
      setStocks(resp.stocks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stocks');
    }
  }, [client]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const { refreshing, onRefresh } = useRefresh(load);

  async function handleLogout() {
    try {
      await client.logout();
    } catch {
      // server-side logout failure is acceptable; local session cleared below
    } finally {
      setAuthToken(null);
    }
  }

  async function handleToggleFavorite(ticker: string) {
    try {
      const result = await client.toggleFavorite(ticker);
      setFavorites((prev) => ({ ...prev, [ticker]: result.favorited }));
    } catch {
      // ignore toggle errors silently
    }
  }

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
    <View style={shared.screen}>
      <TouchableOpacity
        onPress={handleLogout}
        style={shared.logoutButton}
        testID="logout-button"
      >
        <Text style={shared.logoutText}>Log Out</Text>
      </TouchableOpacity>
      <ScrollView
        testID="stock-list"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {stocks.map((item) => (
          <View key={item.ticker} style={shared.row} testID={`stock-row-${item.ticker}`}>
            <TouchableOpacity
              style={styles.rowMain}
              onPress={() =>
                navigation?.navigate('StockDetail', { ticker: item.ticker })
              }
              testID={`stock-open-${item.ticker}`}
            >
              <Text style={styles.ticker} testID={`ticker-${item.ticker}`}>
                {item.ticker}
              </Text>
              <Text style={styles.name} testID={`name-${item.ticker}`}>
                {item.name}
              </Text>
              <Text style={styles.score} testID={`score-${item.ticker}`}>
                {item.score != null ? String(item.score) : '–'}
              </Text>
              <Text style={styles.price} testID={`price-${item.ticker}`}>
                {item.price != null ? `$${item.price.toFixed(2)}` : '–'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleToggleFavorite(item.ticker)}
              testID={`fav-${item.ticker}`}
            >
              <Text style={styles.star}>{favorites[item.ticker] ? '★' : '☆'}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  ticker: { fontWeight: 'bold', width: 60, color: colors.text },
  name: { flex: 1, color: colors.textSecondary, fontSize: 13 },
  score: { width: 36, textAlign: 'right', fontSize: 13, color: colors.textMuted },
  price: { width: 60, textAlign: 'right', fontSize: 13, fontWeight: '600', color: colors.text },
  star: { fontSize: 18, color: colors.primary, paddingLeft: 8 },
});
