import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl } from 'react-native';
import { useClient } from '../context/ClientContext';
import { NewsItem } from '../api/types';
import { shared, colors } from '../theme';
import NewsList from '../components/NewsList';
import { useRefresh } from '../lib/useRefresh';

export default function NewsScreen() {
  const { client } = useClient();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNews(await client.getNews());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load news');
    }
  }, [client]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const { refreshing, onRefresh } = useRefresh(load);

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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <NewsList items={news} />
    </ScrollView>
  );
}
