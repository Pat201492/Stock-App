import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { FedSeriesResponse } from '../api/types';
import { shared, colors, spacing } from '../theme';

const RANGES = [
  { key: '6m', label: '6m', limit: 130 },
  { key: '1y', label: '1y', limit: 260 },
  { key: '3y', label: '3y', limit: 780 },
  { key: '5y', label: '5y', limit: 1300 },
];

const CHART_HEIGHT = 180;

export default function FedMetricScreen({ route, navigation }: any) {
  const seriesId: string = route?.params?.seriesId ?? '';
  const titleHint: string = route?.params?.label ?? seriesId;
  const { client } = useClient();
  const [data, setData] = useState<FedSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<string>('1y');

  useEffect(() => {
    navigation?.setOptions?.({ title: titleHint });
  }, [navigation, titleHint]);

  useEffect(() => {
    setLoading(true);
    const limit = RANGES.find((r) => r.key === rangeKey)?.limit ?? 260;
    client
      .getFedSeries(seriesId, limit)
      .then((resp) => {
        setData(resp);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load series');
      })
      .finally(() => setLoading(false));
  }, [client, seriesId, rangeKey]);

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
  if (!data || data.points.length === 0) {
    return (
      <View style={shared.center}>
        <Text style={shared.errorText}>No data for {seriesId}.</Text>
      </View>
    );
  }

  const values = data.points.map((p) => p.value ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const latest = data.points[data.points.length - 1];
  const oldest = data.points[0];
  const change = latest.value != null && oldest.value != null
    ? latest.value - oldest.value : null;

  return (
    <ScrollView style={shared.screen} testID="fed-metric">
      <View style={styles.header}>
        <Text style={styles.label}>{data.label}</Text>
        <Text style={styles.latest}>
          {latest.value != null ? `${latest.value.toFixed(2)}${data.unit}` : '–'}
        </Text>
        <Text style={styles.asof}>as of {latest.date}</Text>
      </View>

      <View style={styles.rangeRow}>
        {RANGES.map((r) => (
          <Text
            key={r.key}
            style={[
              styles.rangeChip,
              rangeKey === r.key && styles.rangeChipActive,
            ]}
            onPress={() => setRangeKey(r.key)}
            testID={`range-${r.key}`}
          >
            {r.label}
          </Text>
        ))}
      </View>

      <View style={styles.chart} testID="chart">
        {data.points.map((p, i) => {
          const v = p.value ?? 0;
          const h = Math.max(2, ((v - min) / range) * (CHART_HEIGHT - 4));
          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: h,
                  width: `${100 / data.points.length}%`,
                },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.statsRow}>
        <Stat label="Min" value={`${min.toFixed(2)}${data.unit}`} />
        <Stat label="Max" value={`${max.toFixed(2)}${data.unit}`} />
        <Stat
          label="Change"
          value={
            change != null
              ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}${data.unit}`
              : '–'
          }
          tone={change != null && change > 0 ? 'up' : change != null && change < 0 ? 'down' : 'neutral'}
        />
      </View>

      <Text style={styles.windowNote}>
        {oldest.date} → {latest.date} · {data.points.length} obs
      </Text>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'neutral';
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text
        style={[
          styles.statValue,
          tone === 'up' && { color: '#1b8a3a' },
          tone === 'down' && { color: colors.error },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  label: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
  latest: { fontSize: 28, color: colors.text, fontWeight: '700', marginTop: 2 },
  asof: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  rangeRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 8,
  },
  rangeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.divider,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
  },
  rangeChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    color: '#fff',
  },

  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: CHART_HEIGHT,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 2,
  },
  bar: {
    backgroundColor: colors.primary,
    marginHorizontal: 0.5,
  },

  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  stat: { flex: 1 },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  statValue: { fontSize: 15, color: colors.text, fontWeight: '700', marginTop: 2 },

  windowNote: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
