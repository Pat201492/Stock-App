import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { NewsItem } from '../api/types';
import { shared, colors } from '../theme';
import NewsRow from '../components/NewsRow';

export default function NewsScreen() {
  const { client } = useClient();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await client.getNews();
      setNews(items);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load news');
    }
  }, [client]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
    <ScrollView
      testID="news-list"
      style={shared.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
          testID="news-refresh"
        />
      }
    >
      {news.map((item) => (
        <NewsRow key={item.id} item={item} />
      ))}
    </ScrollView>
  );
}
