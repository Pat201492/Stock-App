import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { NewsItem } from '../api/types';
import { shared, colors } from '../theme';

export default function NewsScreen() {
  const { client } = useClient();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getNews()
      .then((items) => setNews(items))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load news');
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
    <ScrollView testID="news-list" style={shared.screen}>
      {news.map((item) => (
        <View key={item.id} style={styles.row} testID={`news-row-${item.id}`}>
          <Text style={styles.title} testID={`news-title-${item.id}`}>
            {item.title}
          </Text>
          <Text style={styles.meta} testID={`news-publisher-${item.id}`}>
            {item.publisher ?? ''}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  title: { fontSize: 14, color: colors.text, lineHeight: 20 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});
