import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
} from 'react-native';
import { NewsItem } from '../api/types';
import { colors } from '../theme';

interface Props {
  item: NewsItem;
  testID?: string;
  // If the item carries no `url`, we fall back to a Google News search for the
  // headline. The user prefers everything to deep-link "somewhere on Google".
  fallbackGoogle?: boolean;
}

function googleSearchUrl(title: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(title)}&tbm=nws`;
}

function sentimentTone(s: string | null) {
  if (!s) return null;
  const v = s.toLowerCase();
  if (['positive', 'bullish', 'pos', 'up'].includes(v)) return 'pos';
  if (['negative', 'bearish', 'neg', 'down'].includes(v)) return 'neg';
  // numeric ("0.42")
  const n = Number(v);
  if (Number.isFinite(n)) {
    if (n > 0.1) return 'pos';
    if (n < -0.1) return 'neg';
    return 'neu';
  }
  return 'neu';
}

export default function NewsRow({ item, testID, fallbackGoogle = true }: Props) {
  const onPress = useCallback(async () => {
    const target = item.url || (fallbackGoogle ? googleSearchUrl(item.title) : '');
    if (!target) return;
    try {
      await Linking.openURL(target);
    } catch {
      // Linking can throw on malformed URLs; falling back to a Google search
      // keeps the tap responsive instead of silently swallowing the press.
      if (fallbackGoogle) {
        await Linking.openURL(googleSearchUrl(item.title)).catch(() => undefined);
      }
    }
  }, [item.url, item.title, fallbackGoogle]);

  const tone = sentimentTone(item.sentiment);
  const sentChip =
    tone === 'pos' ? styles.sentPos
    : tone === 'neg' ? styles.sentNeg
    : tone === 'neu' ? styles.sentNeu
    : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.row}
      testID={testID ?? `news-row-${item.id}`}
    >
      <View style={styles.badgeRow}>
        {item.ticker ? (
          <Text style={styles.tickerBadge} testID={`news-ticker-${item.id}`}>
            {item.ticker}
          </Text>
        ) : null}
        {sentChip ? (
          <Text style={[styles.sentBadge, sentChip]} testID={`news-sent-${item.id}`}>
            {tone === 'pos' ? '▲ positive' : tone === 'neg' ? '▼ negative' : '— neutral'}
          </Text>
        ) : null}
      </View>
      <Text style={styles.title} testID={`news-title-${item.id}`}>
        {item.title}
      </Text>
      <Text style={styles.meta} testID={`news-publisher-${item.id}`}>
        {[item.publisher, item.published_at?.slice(0, 10)].filter(Boolean).join(' · ')}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  tickerBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: 'rgba(0,120,212,0.10)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  sentBadge: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  sentPos: { color: '#1b8a3a', backgroundColor: 'rgba(27,138,58,0.12)' },
  sentNeg: { color: colors.error, backgroundColor: 'rgba(220,53,69,0.12)' },
  sentNeu: { color: colors.textMuted, backgroundColor: 'rgba(120,120,120,0.10)' },
  title: { fontSize: 14, color: colors.text, lineHeight: 20 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});

