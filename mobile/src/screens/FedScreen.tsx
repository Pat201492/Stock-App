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
import {
  FedSummaryResponse,
  FedCalendarResponse,
  FedHistoryResponse,
} from '../api/types';
import { shared, colors, spacing } from '../theme';

export default function FedScreen({ navigation }: any) {
  const { client } = useClient();
  const [fed, setFed] = useState<FedSummaryResponse | null>(null);
  const [calendar, setCalendar] = useState<FedCalendarResponse | null>(null);
  const [history, setHistory] = useState<FedHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Summary is required; calendar+history are best-effort.
      const [summary, cal, hist] = await Promise.all([
        client.getFedSummary(),
        client.getFedCalendar().catch(() => null),
        client.getFedHistory().catch(() => null),
      ]);
      setFed(summary);
      setCalendar(cal);
      setHistory(hist);
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
      {calendar && calendar.upcoming.length > 0 ? (
        <View style={styles.section} testID="fed-upcoming">
          <Text style={styles.sectionTitle}>Upcoming FOMC Meetings</Text>
          {calendar.upcoming.map((m) => (
            <View key={m.date} style={styles.calendarRow}>
              <Text style={styles.calendarDate}>{m.date}</Text>
              <Text style={styles.calendarDays}>
                {m.days_until === 0
                  ? 'today'
                  : m.days_until === 1
                  ? 'tomorrow'
                  : `in ${m.days_until} days`}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {history && history.decisions && history.decisions.length > 0 ? (
        <View style={styles.section} testID="fed-decisions">
          <Text style={styles.sectionTitle}>Recent Decisions</Text>
          {history.decisions.slice(0, 6).map((d) => {
            const action = d.action;
            const tone =
              action === 'Hike' ? styles.badgeUp
              : action === 'Cut' ? styles.badgeDown
              : styles.badgeHold;
            return (
              <View key={d.date} style={styles.decisionRow}>
                <Text style={styles.calendarDate}>{d.date}</Text>
                <Text style={[styles.actionBadge, tone]}>
                  {action}
                  {d.change_bps != null && d.change_bps !== 0
                    ? ` ${d.change_bps > 0 ? '+' : ''}${d.change_bps}bps`
                    : ''}
                </Text>
                <Text style={styles.decisionRange}>{d.range ?? ''}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Indicators</Text>
      {fed?.series.map((item) => {
        const val =
          item.value != null ? `${item.value}${item.unit ?? ''}` : '–';
        const chg =
          item.change != null && item.change !== 0
            ? `${item.change > 0 ? '+' : ''}${item.change}${item.unit ?? ''}`
            : null;
        const up = (item.change ?? 0) > 0;
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.row}
            testID={`fed-row-${item.id}`}
            onPress={() =>
              navigation?.navigate('FedMetric', {
                seriesId: item.id,
                label: item.label,
              })
            }
          >
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
                <Text style={styles.chevron}>›</Text>
              </View>
            </View>
            <Text style={styles.context} testID={`fed-context-${item.id}`}>
              {item.context}
            </Text>
            {item.asof ? (
              <Text style={styles.asof}>as of {item.asof}</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    letterSpacing: 0.5,
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  calendarDate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  calendarDays: {
    fontSize: 12,
    color: colors.textMuted,
  },
  decisionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  actionBadge: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginHorizontal: spacing.sm,
    overflow: 'hidden',
    minWidth: 70,
    textAlign: 'center',
  },
  decisionRange: {
    fontSize: 12,
    color: colors.textMuted,
    minWidth: 90,
    textAlign: 'right',
  },
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
  chevron: {
    fontSize: 20,
    color: colors.textMuted,
    marginLeft: spacing.sm,
    lineHeight: 17,
  },
  up: { color: '#1b8a3a' },
  down: { color: colors.error },
  badgeUp: { color: '#1b8a3a', backgroundColor: 'rgba(27,138,58,0.12)' },
  badgeDown: { color: colors.error, backgroundColor: 'rgba(220,53,69,0.12)' },
  badgeHold: { color: colors.textMuted, backgroundColor: 'rgba(120,120,120,0.12)' },
  context: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  asof: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
