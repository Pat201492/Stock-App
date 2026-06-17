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
import {
  FedSummaryResponse,
  FedCalendarEvent,
  FedDecision,
  NewsLike,
} from '../api/types';
import { shared, colors, spacing } from '../theme';
import NewsList from '../components/NewsList';
import Sparkline from '../components/Sparkline';
import { useRefresh } from '../lib/useRefresh';

const GREEN = '#1b8a3a';
const RED = '#c00';

function actionColor(action: string): string {
  const a = (action || '').toLowerCase();
  if (a.includes('cut')) return GREEN;
  if (a.includes('hike') || a.includes('raise')) return RED;
  return colors.textMuted;
}

export default function FedScreen() {
  const { client } = useClient();
  const [fed, setFed] = useState<FedSummaryResponse | null>(null);
  const [meetings, setMeetings] = useState<FedCalendarEvent[]>([]);
  const [decisions, setDecisions] = useState<FedDecision[]>([]);
  const [news, setNews] = useState<NewsLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, cal, hist, nw] = await Promise.all([
        client.getFedSummary(),
        client.getFedCalendar().catch(() => ({ upcoming: [] })),
        client.getFedHistory().catch(() => ({ configured: false, decisions: [] })),
        client.getFedNews().catch(() => [] as NewsLike[]),
      ]);
      setFed(s);
      setMeetings(cal.upcoming ?? []);
      setDecisions(hist.decisions ?? []);
      setNews(nw);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Fed data');
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
      testID="fed-list"
      style={shared.screen}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.section}>Key Indicators</Text>
      {fed?.series.map((item) => {
        const isCurve = item.id === 'T10Y2Y';
        const inverted = isCurve && (item.value ?? 0) < 0;
        const valColor = inverted ? RED : colors.text;
        const val = item.value != null ? `${item.value}${item.unit ?? ''}` : '–';
        const chg =
          item.change != null && item.change !== 0
            ? `${Math.abs(item.change)}${item.unit ?? ''}`
            : null;
        const up = (item.change ?? 0) >= 0;
        return (
          <View key={item.id} style={styles.row} testID={`fed-row-${item.id}`}>
            <View style={styles.headerRow}>
              <Text style={styles.label} testID={`fed-label-${item.id}`}>
                {item.label}
              </Text>
              <Text style={[styles.value, { color: valColor }]} testID={`fed-value-${item.id}`}>
                {val}
              </Text>
            </View>
            {chg != null ? (
              <Text
                style={[styles.change, { color: up ? GREEN : RED }]}
                testID={`fed-change-${item.id}`}
              >
                {up ? '▲' : '▼'} {chg} since prior
              </Text>
            ) : null}
            {item.history && item.history.length > 1 ? (
              <View style={styles.spark}>
                <Sparkline data={item.history} color={inverted ? RED : colors.primary} />
              </View>
            ) : null}
            <Text style={styles.context} testID={`fed-context-${item.id}`}>
              {item.context}
            </Text>
            {inverted ? (
              <Text style={styles.warn}>⚠ Inverted — recession signal</Text>
            ) : null}
            {item.asof ? <Text style={styles.asof}>as of {item.asof}</Text> : null}
          </View>
        );
      })}

      <Text style={styles.section}>FOMC Meetings</Text>
      {meetings.length === 0 ? (
        <Text style={styles.empty}>No scheduled meetings.</Text>
      ) : (
        meetings.map((m, i) => (
          <View key={m.date} style={styles.lineRow} testID={`fomc-${m.date}`}>
            <Text style={[styles.lineMain, i === 0 && styles.bold]}>{m.date}</Text>
            <Text style={[styles.lineSub, i === 0 && { color: colors.primary }]}>
              {m.days_until <= 0 ? 'today' : `in ${m.days_until} days`}
              {i === 0 ? ' · next' : ''}
            </Text>
          </View>
        ))
      )}

      <Text style={styles.section}>Rate Decisions</Text>
      {decisions.length === 0 ? (
        <Text style={styles.empty}>No decisions on record.</Text>
      ) : (
        decisions.map((d) => (
          <View key={d.date} style={styles.lineRow} testID={`decision-${d.date}`}>
            <Text style={styles.lineMain}>{d.date}</Text>
            <Text style={[styles.action, { color: actionColor(d.action) }]}>
              {d.action === 'Hold' ? 'Held' : d.action}
              {d.change_bps ? ` ${Math.abs(d.change_bps)}bps` : ''}
            </Text>
            <Text style={styles.lineSub}>→ {d.range ?? ''}</Text>
          </View>
        ))
      )}

      <Text style={styles.section}>Fed News</Text>
      <NewsList items={news} />
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontWeight: 'bold', fontSize: 15, color: colors.text, flex: 1 },
  value: { fontWeight: '700', fontSize: 20 },
  change: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  spark: { marginVertical: 8 },
  context: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  warn: { fontSize: 11, fontWeight: '700', color: RED, marginTop: 4 },
  asof: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  empty: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  lineMain: { fontSize: 14, color: colors.text, fontWeight: '600', width: 100 },
  bold: { fontWeight: '800' },
  action: { fontSize: 13, fontWeight: '700', flex: 1 },
  lineSub: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto' },
});
