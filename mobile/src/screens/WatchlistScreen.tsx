import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { FavoriteItem } from '../api/types';

export default function WatchlistScreen() {
  const { client } = useClient();
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getFavorites()
      .then((resp) => {
        setFavorites(resp.favorites);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load watchlist');
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
    <ScrollView testID="favorites-list">
      {favorites.length === 0 ? (
        <View style={styles.empty} testID="empty-state">
          <Text style={styles.emptyText}>No favorites yet. Star stocks from the Screener.</Text>
        </View>
      ) : (
        favorites.map((item) => (
          <View key={item.ticker} style={styles.row} testID={`fav-row-${item.ticker}`}>
            <Text style={styles.ticker} testID={`fav-ticker-${item.ticker}`}>
              {item.ticker}
            </Text>
            <Text style={styles.kind} testID={`fav-kind-${item.ticker}`}>
              {item.kind}
            </Text>
            <Text testID={`fav-price-${item.ticker}`}>
              {item.last_price != null ? `$${item.last_price.toFixed(2)}` : '–'}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  errorText: { color: '#c00', fontSize: 16 },
  empty: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#888', textAlign: 'center' },
  row: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    flexDirection: 'row',
    alignItems: 'center',
  },
  ticker: { fontWeight: 'bold', width: 70 },
  kind: { flex: 1, color: '#888' },
});
