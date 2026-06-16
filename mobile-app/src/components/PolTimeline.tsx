import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${MONTHS[Number(mo) - 1]} ${Number(d)}, ${y}`;
}

export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

export function isBuy(t: string): boolean {
  return /purchase|buy/i.test(t);
}
export function isSell(t: string): boolean {
  return /sale|sell/i.test(t);
}

export interface TLTrade {
  id: string;
  date: string | null;
  /** politician name; '' when the context is a single politician */
  politician: string;
  party?: string | null;
  chamber?: string | null;
  /** ticker; '' when the context is a single ticker */
  ticker: string;
  type: string;
  amountMin: number | null;
  amountMax: number | null;
  bioguideId?: string;
}

function amountText(t: TLTrade): string | null {
  if (t.amountMin == null) return null;
  return `${money(t.amountMin)}–${money(t.amountMax ?? t.amountMin)}`;
}

export default function PolTimeline({
  trades,
  filterByPolitician = false,
  emptyText = 'No trades on record.',
  onPressPolitician,
}: {
  trades: TLTrade[];
  filterByPolitician?: boolean;
  emptyText?: string;
  onPressPolitician?: (bioguideId: string, name: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const politicians = useMemo(() => {
    const set = new Set<string>();
    trades.forEach((t) => t.politician && set.add(t.politician));
    return Array.from(set).sort();
  }, [trades]);

  const filtered = useMemo(
    () => (selected ? trades.filter((t) => t.politician === selected) : trades),
    [trades, selected],
  );

  const groups = useMemo(() => {
    const map = new Map<string, TLTrade[]>();
    for (const t of filtered) {
      const key = t.date || 'Unknown';
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, items]) => ({ date, items }));
  }, [filtered]);

  if (trades.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View testID="pol-timeline">
      {filterByPolitician && politicians.length > 1 && (
        <View style={styles.filterRow} testID="pol-filter">
          <Chip
            label="All"
            active={selected == null}
            onPress={() => setSelected(null)}
          />
          {politicians.map((p) => (
            <Chip
              key={p}
              label={p}
              active={selected === p}
              onPress={() => setSelected(p)}
            />
          ))}
        </View>
      )}

      {groups.map((g) => (
        <View key={g.date} style={styles.group} testID={`tl-group-${g.date}`}>
          <View style={styles.dateRow}>
            <View style={styles.dot} />
            <Text style={styles.dateLabel}>
              {g.date === 'Unknown' ? 'Undated' : fmtDate(g.date)}
            </Text>
          </View>
          {g.items.map((t) => {
            const buy = isBuy(t.type);
            const sell = isSell(t.type);
            const action = buy ? 'Bought' : sell ? 'Sold' : t.type;
            const amt = amountText(t);
            const primary = t.politician || t.ticker;
            const badge = t.politician ? t.ticker : '';
            const sub = [t.party, t.chamber].filter(Boolean).join(' · ');
            return (
              <View key={t.id} style={styles.row} testID={`tl-row-${t.id}`}>
                <View style={styles.rail}>
                  <View style={styles.railLine} />
                </View>
                <View style={styles.card}>
                  <View style={styles.cardTop}>
                    {t.politician && onPressPolitician && t.bioguideId ? (
                      <TouchableOpacity
                        style={styles.primaryWrap}
                        onPress={() =>
                          onPressPolitician(t.bioguideId as string, t.politician)
                        }
                        testID={`tl-politician-${t.id}`}
                      >
                        <Text style={[styles.primary, styles.link]} numberOfLines={1}>
                          {primary}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.primary} numberOfLines={1}>
                        {primary}
                      </Text>
                    )}
                    {badge ? <Text style={styles.badge}>{badge}</Text> : null}
                  </View>
                  <View style={styles.actionRow}>
                    <Text
                      style={[styles.action, buy && styles.buy, sell && styles.sell]}
                    >
                      {buy ? '▲ ' : sell ? '▼ ' : ''}
                      {action}
                      {amt ? ` ${amt}` : ''}
                    </Text>
                  </View>
                  {sub ? <Text style={styles.sub}>{sub}</Text> : null}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  empty: { padding: spacing.md },
  emptyText: { color: colors.textMuted, fontSize: 14 },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginRight: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  group: { paddingHorizontal: spacing.md },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    marginRight: spacing.sm,
  },
  dateLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row' },
  rail: { width: 10, alignItems: 'center', marginRight: spacing.sm },
  railLine: { width: 2, flex: 1, backgroundColor: colors.divider },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  primaryWrap: { flex: 1 },
  primary: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  link: { color: colors.primary },
  badge: { fontWeight: 'bold', color: colors.text, marginLeft: spacing.sm },
  actionRow: { marginTop: 3 },
  action: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  buy: { color: '#1b8a3a' },
  sell: { color: colors.error },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
