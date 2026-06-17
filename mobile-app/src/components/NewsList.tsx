import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { NewsLike } from '../api/types';
import { colors, spacing } from '../theme';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

// red (0) -> amber (0.5) -> green (1)
function scale(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  return `hsl(${Math.round(c * 120)}, 65%, 42%)`;
}

function sentimentChip(s: number | null | undefined) {
  if (s == null) return null;
  const label = s > 0.1 ? 'Bullish' : s < -0.1 ? 'Bearish' : 'Neutral';
  const color = scale((s + 1) / 2);
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </View>
  );
}

function trustChip(t: number | null | undefined) {
  if (t == null) {
    return (
      <View style={[styles.chip, { borderColor: colors.border }]}>
        <Text style={styles.unrated}>Source: unrated</Text>
      </View>
    );
  }
  const color = scale(t);
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <View style={styles.trackBg}>
        <View style={[styles.trackFill, { width: `${Math.round(t * 100)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.chipText, { color }]}>Source {Math.round(t * 100)}%</Text>
    </View>
  );
}

export default function NewsList({ items }: { items: NewsLike[] }) {
  if (!items || items.length === 0) {
    return (
      <Text style={styles.empty} testID="news-empty">
        No recent news.
      </Text>
    );
  }
  return (
    <View>
      {items.map((n, i) => (
        <TouchableOpacity
          key={n.url ?? i}
          style={styles.row}
          onPress={() => n.url && Linking.openURL(n.url)}
          testID={`news-${i}`}
        >
          <Text style={styles.title} numberOfLines={3}>
            {n.title}
          </Text>
          <Text style={styles.meta}>
            {[n.publisher, fmtDate(n.published_at)].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.chips}>
            {sentimentChip(n.sentiment)}
            {trustChip(n.source_trust)}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  title: { fontSize: 14, color: colors.text, fontWeight: '500' },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  chips: { flexDirection: 'row', marginTop: 6, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  chipText: { fontSize: 11, fontWeight: '700' },
  trackBg: {
    width: 28,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.divider,
    marginRight: 6,
    overflow: 'hidden',
  },
  trackFill: { height: 5, borderRadius: 3 },
  unrated: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
});
