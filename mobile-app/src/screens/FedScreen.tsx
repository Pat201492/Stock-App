import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useClient } from '../context/ClientContext';
import {
  FedSummaryResponse,
  FedCalendarEvent,
  FedDecision,
  NewsLike,
} from '../api/types';
import { shared, colors, spacing } from '../theme';
import NewsList from '../components/NewsList';

function actionColor(action: string): string {
  const a = (action || '').toLowerCase();
  if (a.includes('cut')) return '#1b8a3a';
  if (a.includes('hike') || a.includes('raise')) return '#c00';
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

  useEffect(() => {
    Promise.all([
      client.getFedSummary(),
      client.getFedCalendar().catch(() => ({ upcoming: [] })),
      client.getFedHistory().catch(() => ({ configured: false, decisions: [] })),
      client.getFedNews().catch(() => [] as NewsLike[]),
    ])
      .then(([s, cal, hist, nw]) => {
        setFed(s);
        setMeetings(cal.upcoming ?? []);
        setDecisions(hist.decisions ?? []);
        setNews(nw);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load Fed data');
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
    <ScrollView testID="fed-list" style={shared.screen}>
      {/* Macro metric series */}
      <Text style={styles.section}>Key Indicators</Text>
      {fed?.series.map((item) => {
        const val = item.value != null ? `${item.value}${item.unit ?? ''}` : '–';
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
                <Text style={styles.value} testID={`fed-value-${item.id}`}>{val}</Text>
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
            {item.asof ? <Text style={styles.asof}>as of {item.asof}</Text> : null}
          </View>
        );
      })}

      {/* Upcoming FOMC meetings */}
      <Text style={styles.section}>FOMC Meetings</Text>
      {meetings.length === 0 ? (
        <Text style={styles.empty}>No scheduled meetings.</Text>
      ) : (
        meetings.map((m) => (
          <View key={m.date} style={styles.lineRow} testID={`fomc-${m.date}`}>
            <Text style={styles.lineMain}>{m.date}</Text>
            <Text style={styles.lineSub}>
              {m.days_until <= 0 ? 'today' : `in ${m.days_until} days`}
            </Text>
          </View>
        ))
      )}

      {/* Past rate decisions */}
      <Text style={styles.section}>Rate Decisions</Text>
      {decisions.length === 0 ? (
        <Text style={styles.empty}>No decisions on record.</Text>
      ) : (
        decisions.map((d) => (
          <View key={d.date} style={styles.lineRow} testID={`decision-${d.date}`}>
            <Text style={styles.lineMain}>{d.date}</Text>
            <Text style={[styles.action, { color: actionColor(d.action) }]}>
              {d.action}
              {d.change_bps ? ` ${d.change_bps > 0 ? '+' : ''}${d.change_bps}bps` : ''}
            </Text>
            <Text style={styles.lineSub}>{d.range ?? ''}</Text>
          </View>
        ))
      )}

      {/* Fed news */}
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
  valueWrap: { flexDirection: 'row', alignItems: 'baseline' },
  value: { fontWeight: '700', fontSize: 17, color: colors.text },
  change: { fontSize: 13, fontWeight: '600', marginLeft: 8 },
  up: { color: '#1b8a3a' },
  down: { color: colors.error },
  context: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
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
  action: { fontSize: 13, fontWeight: '700', flex: 1 },
  lineSub: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto' },
});
