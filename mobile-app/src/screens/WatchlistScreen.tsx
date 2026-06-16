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
import { shared, colors } from '../theme';

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
    <ScrollView testID="favorites-list" style={shared.screen}>
      {favorites.length === 0 ? (
        <View style={shared.empty} testID="empty-state">
          <Text style={shared.emptyText}>No favorites yet. Star stocks from the Screener.</Text>
        </View>
      ) : (
        favorites.map((item) => (
          <View key={item.ticker} style={shared.row} testID={`fav-row-${item.ticker}`}>
            <Text style={styles.ticker} testID={`fav-ticker-${item.ticker}`}>
              {item.ticker}
            </Text>
            <Text style={styles.kind} testID={`fav-kind-${item.ticker}`}>
              {item.kind}
            </Text>
            <Text style={styles.price} testID={`fav-price-${item.ticker}`}>
              {item.last_price != null ? `$${item.last_price.toFixed(2)}` : '–'}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ticker: { fontWeight: 'bold', width: 70, color: colors.text },
  kind: { flex: 1, color: colors.textMuted, fontSize: 13 },
  price: { fontSize: 13, fontWeight: '600', color: colors.text },
});
