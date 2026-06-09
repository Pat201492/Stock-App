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
    <ScrollView testID="news-list">
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#c00', fontSize: 16 },
  row: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: { fontSize: 14, flex: 1 },
  meta: { fontSize: 12, color: '#666', marginTop: 4 },
});
