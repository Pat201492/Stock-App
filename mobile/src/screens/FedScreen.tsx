import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { FedSummaryResponse } from '../api/types';
import { shared, colors } from '../theme';

export default function FedScreen() {
  const { client } = useClient();
  const [fed, setFed] = useState<FedSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const resp = await client.getFedSummary();
      setFed(resp);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load Fed data');
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
      testID="fed-list"
      style={shared.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
          testID="fed-refresh"
        />
      }
    >
      {fed?.series.map((item) => {
        const val =
          item.value != null ? `${item.value}${item.unit ?? ''}` : '–';
        const chg =
          item.change != null && item.change !== 0
            ? `${item.change > 0 ? '+' : ''}${item.change}${item.unit ?? ''}`
            : null;
        const up = (item.change ?? 0) > 0;
        return (
          <View key={item.id} style={styles.row} testID={`fed-row-${item.id}`}>
            <View style={styles.headerRow}>
              <Text style={styles.label} testID={`fed-label-${item.id}`}>
                {item.label}
              </Text>
              <View style={styles.valueWrap}>
                <Text style={styles.value} testID={`fed-value-${item.id}`}>
                  {val}
                </Text>
                {chg != null ? (
                  <Text
                    style={[styles.change, up ? styles.up : styles.down]}
                    testID={`fed-change-${item.id}`}
                  >
                    {chg}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={styles.context} testID={`fed-context-${item.id}`}>
              {item.context}
            </Text>
            {item.asof ? (
              <Text style={styles.asof}>as of {item.asof}</Text>
            ) : null}
          </View>
        );
      })}
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: { fontWeight: 'bold', fontSize: 15, color: colors.text, flex: 1 },
  valueWrap: { flexDirection: 'row', alignItems: 'baseline' },
  value: { fontWeight: '700', fontSize: 17, color: colors.text },
  change: { fontSize: 13, fontWeight: '600', marginLeft: 8 },
  up: { color: '#1b8a3a' },
  down: { color: colors.error },
  context: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  asof: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
