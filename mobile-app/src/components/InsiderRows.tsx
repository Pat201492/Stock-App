import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InsiderTickerTrade } from '../api/types';
import { colors, spacing } from '../theme';
import { insiderTypeLabel, insiderTypeColor, fmtVal, fmtShares } from '../lib/insider';

export default function InsiderRows({
  trades,
  emptyText = 'No insider trades on record.',
}: {
  trades: InsiderTickerTrade[];
  emptyText?: string;
}) {
  if (!trades || trades.length === 0) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }
  return (
    <View>
      {trades.map((t, i) => (
        <View key={t.filing_id ?? i} style={styles.row} testID={`insider-${t.filing_id ?? i}`}>
          <View style={styles.top}>
            <Text style={styles.name} numberOfLines={1}>{t.insider_name}</Text>
            <Text style={[styles.type, { color: insiderTypeColor(t.transaction_type) }]}>
              {insiderTypeLabel(t.transaction_type)}
            </Text>
          </View>
          {t.insider_title ? (
            <Text style={styles.title} numberOfLines={1}>{t.insider_title}</Text>
          ) : null}
          <View style={styles.stats}>
            <Text style={styles.stat}>
              <Text style={styles.lbl}>Shares </Text>{fmtShares(t.shares)}
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.lbl}>@ </Text>
              {t.price_per_share != null ? `$${t.price_per_share.toFixed(2)}` : '—'}
            </Text>
            <Text style={styles.stat}>
              <Text style={styles.lbl}>Value </Text>
              <Text style={styles.val}>{fmtVal(t.total_value)}</Text>
            </Text>
            <Text style={styles.date}>{t.transaction_date || ''}</Text>
          </View>
        </View>
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
  top: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  type: { fontSize: 12, fontWeight: '700', marginLeft: spacing.sm },
  title: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  stats: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
  stat: { fontSize: 12, color: colors.text, marginRight: spacing.md },
  lbl: { color: colors.textMuted },
  val: { fontWeight: '600', color: colors.text },
  date: { fontSize: 12, color: colors.textMuted, marginLeft: 'auto' },
});
