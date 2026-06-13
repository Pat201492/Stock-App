import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Pressable,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { PolTrade } from '../api/types';
import { shared, colors, spacing } from '../theme';
import { money, isBuy, isSell, fmtDate } from '../components/PolTimeline';

interface PolAgg {
  bioguideId: string;
  name: string;
  party: string | null;
  chamber: string | null;
  count: number;
  buys: number;
  sells: number;
  volume: number;
}

interface StockAgg {
  ticker: string;
  count: number;
  buys: number;
  sells: number;
  volume: number;
}

function midpoint(t: PolTrade): number {
  if (t.amount_min != null && t.amount_max != null) {
    return (t.amount_min + t.amount_max) / 2;
  }
  return t.amount_min ?? 0;
}

function aggPoliticians(trades: PolTrade[]): PolAgg[] {
  const map = new Map<string, PolAgg>();
  for (const t of trades) {
    let a = map.get(t.bioguide_id);
    if (!a) {
      a = {
        bioguideId: t.bioguide_id,
        name: t.politician_name,
        party: t.party,
        chamber: t.chamber,
        count: 0,
        buys: 0,
        sells: 0,
        volume: 0,
      };
      map.set(t.bioguide_id, a);
    }
    a.count += 1;
    if (isBuy(t.transaction_type)) a.buys += 1;
    else if (isSell(t.transaction_type)) a.sells += 1;
    a.volume += midpoint(t);
  }
  return Array.from(map.values()).sort((x, y) => y.count - x.count);
}

function aggStocks(trades: PolTrade[]): StockAgg[] {
  const map = new Map<string, StockAgg>();
  for (const t of trades) {
    if (!t.ticker) continue;
    let a = map.get(t.ticker);
    if (!a) {
      a = { ticker: t.ticker, count: 0, buys: 0, sells: 0, volume: 0 };
      map.set(t.ticker, a);
    }
    a.count += 1;
    if (isBuy(t.transaction_type)) a.buys += 1;
    else if (isSell(t.transaction_type)) a.sells += 1;
    a.volume += midpoint(t);
  }
  return Array.from(map.values()).sort((x, y) => y.count - x.count);
}

type Mode = 'politician' | 'stock';
type SortKey = 'count' | 'volume';
type RangeKey = '7d' | '30d' | '90d' | '1y' | 'all';

const RANGE_OPTIONS: { key: RangeKey; label: string; days?: number }[] = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: '1y', label: '1y', days: 365 },
  { key: 'all', label: 'All' },
];

interface Committee {
  committee_id: string;
  name: string;
  chamber: string | null;
  trade_count: number;
  sectors: string[];
}

type FilterSheet = 'range' | 'committee' | 'sort' | null;

const RANGE_LABEL: Record<RangeKey, string> = {
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '1y':  'Last year',
  'all': 'All time',
};
const SORT_LABEL: Record<SortKey, string> = {
  count: 'Most trades',
  volume: 'Highest $ volume',
};

function FilterPill({
  icon, label, active, onPress, testID,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[pillStyles.pill, active && pillStyles.pillActive]}
      testID={testID}
    >
      <Text style={pillStyles.icon}>{icon}</Text>
      <Text
        style={[pillStyles.text, active && pillStyles.textActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={[pillStyles.caret, active && pillStyles.textActive]}>▾</Text>
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: 6,
    flexShrink: 1,
    maxWidth: 180,
  },
  pillActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,120,212,0.08)',
  },
  icon: { fontSize: 13, marginRight: 4 },
  text: { fontSize: 13, color: colors.text, fontWeight: '600', flexShrink: 1 },
  textActive: { color: colors.primary },
  caret: { fontSize: 11, color: colors.textMuted, marginLeft: 4 },
});

export default function PoliticiansScreen({ navigation }: any) {
  const { client } = useClient();
  const [trades, setTrades] = useState<PolTrade[]>([]);
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('politician');
  const [sortKey, setSortKey] = useState<SortKey>('count');
  const [range, setRange] = useState<RangeKey>('all');
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [sheet, setSheet] = useState<FilterSheet>(null);
  const [committeeQuery, setCommitteeQuery] = useState('');

  // Committees are stable across filters — fetched once.  Keep the full list
  // (sorted by trade_count) so the bottom-sheet picker can search across all,
  // not just a top-12 slice.
  useEffect(() => {
    client
      .getPolCommittees()
      .then((r) =>
        setCommittees(
          [...r.committees].sort((a, b) => b.trade_count - a.trade_count),
        ),
      )
      .catch(() => undefined);
  }, [client]);

  const load = useCallback(async () => {
    try {
      const days = RANGE_OPTIONS.find((r) => r.key === range)?.days;
      const params: Record<string, unknown> = {};
      if (days != null) params.days = days;
      if (committeeId) params.committee = committeeId;
      if (conflictsOnly) params.conflicts_only = true;
      const resp = await client.getPolTrades(
        Object.keys(params).length ? params : undefined,
      );
      setTrades(resp.trades);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load politician trades');
    }
  }, [client, range, committeeId, conflictsOnly]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const politicians = useMemo(() => {
    const list = aggPoliticians(trades);
    return sortKey === 'volume'
      ? [...list].sort((a, b) => b.volume - a.volume)
      : list;
  }, [trades, sortKey]);
  const stocks = useMemo(() => {
    const list = aggStocks(trades);
    return sortKey === 'volume'
      ? [...list].sort((a, b) => b.volume - a.volume)
      : list;
  }, [trades, sortKey]);
  const latestDate = useMemo(() => {
    let max = '';
    for (const t of trades) {
      if (t.transaction_date && t.transaction_date > max) max = t.transaction_date;
    }
    return max;
  }, [trades]);

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
    <View style={shared.screen}>
      {latestDate ? (
        <View style={styles.dataDateBar} testID="pol-data-date">
          <Text style={styles.dataDateText}>
            Latest disclosed trade: {fmtDate(latestDate)}
          </Text>
        </View>
      ) : null}
      <View style={styles.toggle} testID="pol-toggle">
        <TouchableOpacity
          style={[styles.tab, mode === 'politician' && styles.tabActive]}
          onPress={() => setMode('politician')}
          testID="toggle-politician"
        >
          <Text style={[styles.tabText, mode === 'politician' && styles.tabTextActive]}>
            By Politician
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, mode === 'stock' && styles.tabActive]}
          onPress={() => setMode('stock')}
          testID="toggle-stock"
        >
          <Text style={[styles.tabText, mode === 'stock' && styles.tabTextActive]}>
            By Stock
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.summaryRow}
        testID="pol-filters"
      >
        <FilterPill
          icon="⏱"
          label={RANGE_LABEL[range]}
          onPress={() => setSheet('range')}
          testID="filter-range"
        />
        <FilterPill
          icon="🏛"
          label={
            committeeId
              ? (committees.find((c) => c.committee_id === committeeId)?.name
                  .replace(/Committee on /i, '') ?? 'Committee')
              : 'All committees'
          }
          active={committeeId != null}
          onPress={() => setSheet('committee')}
          testID="filter-committee"
        />
        <FilterPill
          icon="⇅"
          label={SORT_LABEL[sortKey]}
          onPress={() => setSheet('sort')}
          testID="filter-sort"
        />
        <TouchableOpacity
          onPress={() => setConflictsOnly((v) => !v)}
          style={[
            styles.conflictBtn,
            conflictsOnly && styles.conflictBtnActive,
          ]}
          testID="conflicts-only"
        >
          <Text
            style={[
              styles.conflictText,
              conflictsOnly && styles.conflictTextActive,
            ]}
          >
            {conflictsOnly ? '⚖ Conflicts ✓' : '⚖ Conflicts'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <ScrollView
        testID="pol-list"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
            testID="pol-refresh"
          />
        }
      >
        {mode === 'politician'
          ? politicians.map((p) => (
              <TouchableOpacity
                key={p.bioguideId}
                style={shared.row}
                testID={`pol-agg-${p.bioguideId}`}
                onPress={() =>
                  navigation?.navigate('PoliticianTrades', {
                    bioguideId: p.bioguideId,
                    name: p.name,
                  })
                }
              >
                <View style={styles.left}>
                  <Text style={styles.title} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.sub}>
                    {[p.party, p.chamber].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.count}>{p.count} trades</Text>
                  <Text style={styles.sub}>
                    <Text style={styles.buy}>{p.buys}B</Text> ·{' '}
                    <Text style={styles.sell}>{p.sells}S</Text>
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))
          : stocks.map((s) => (
              <TouchableOpacity
                key={s.ticker}
                style={shared.row}
                testID={`stock-agg-${s.ticker}`}
                onPress={() =>
                  navigation?.navigate('PolStockTrades', { ticker: s.ticker })
                }
              >
                <Text style={styles.ticker}>{s.ticker}</Text>
                <View style={styles.left}>
                  <Text style={styles.sub}>{s.count} trades</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.sub}>
                    <Text style={styles.buy}>{s.buys}B</Text> ·{' '}
                    <Text style={styles.sell}>{s.sells}S</Text>
                  </Text>
                  <Text style={styles.sub}>
                    {s.volume > 0 ? money(s.volume) : '–'}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
        <View style={{ height: 24 }} />
      </ScrollView>

      <Modal
        visible={sheet !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setSheet(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSheet(null)} />
        <View style={styles.modalSheet} testID="filter-sheet">
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>
            {sheet === 'range'
              ? 'Time range'
              : sheet === 'sort'
              ? 'Sort by'
              : 'Committee'}
          </Text>

          {sheet === 'range' ? (
            <View testID="sheet-range-list">
              {RANGE_OPTIONS.map((r) => (
                <SheetOption
                  key={r.key}
                  label={RANGE_LABEL[r.key]}
                  selected={range === r.key}
                  onPress={() => {
                    setRange(r.key);
                    setSheet(null);
                  }}
                  testID={`sheet-range-${r.key}`}
                />
              ))}
            </View>
          ) : null}

          {sheet === 'sort' ? (
            <View testID="sheet-sort-list">
              {(['count', 'volume'] as SortKey[]).map((k) => (
                <SheetOption
                  key={k}
                  label={SORT_LABEL[k]}
                  selected={sortKey === k}
                  onPress={() => {
                    setSortKey(k);
                    setSheet(null);
                  }}
                  testID={`sheet-sort-${k}`}
                />
              ))}
            </View>
          ) : null}

          {sheet === 'committee' ? (
            <>
              <TextInput
                value={committeeQuery}
                onChangeText={setCommitteeQuery}
                placeholder="Search committees…"
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                testID="sheet-committee-search"
              />
              <ScrollView style={{ maxHeight: 380 }}>
                <SheetOption
                  label="All committees"
                  selected={committeeId == null}
                  onPress={() => {
                    setCommitteeId(null);
                    setSheet(null);
                  }}
                  testID="sheet-committee-all"
                />
                {committees
                  .filter((c) =>
                    c.name
                      .toLowerCase()
                      .includes(committeeQuery.trim().toLowerCase()),
                  )
                  .map((c) => (
                    <SheetOption
                      key={c.committee_id}
                      label={c.name.replace(/Committee on /i, '')}
                      sub={`${c.trade_count} trades${c.chamber ? ` · ${c.chamber}` : ''}`}
                      selected={committeeId === c.committee_id}
                      onPress={() => {
                        setCommitteeId(c.committee_id);
                        setSheet(null);
                      }}
                      testID={`sheet-committee-${c.committee_id}`}
                    />
                  ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

function SheetOption({
  label, sub, selected, onPress, testID,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={sheetStyles.row}
      testID={testID}
    >
      <View style={{ flex: 1 }}>
        <Text style={[sheetStyles.label, selected && sheetStyles.labelSelected]}>
          {label}
        </Text>
        {sub ? <Text style={sheetStyles.sub}>{sub}</Text> : null}
      </View>
      {selected ? <Text style={sheetStyles.check}>✓</Text> : null}
    </TouchableOpacity>
  );
}

const sheetStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  label: { fontSize: 15, color: colors.text },
  labelSelected: { color: colors.primary, fontWeight: '700' },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  check: { fontSize: 18, color: colors.primary, marginLeft: spacing.sm },
});

const styles = StyleSheet.create({
  dataDateBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  dataDateText: { fontSize: 12, color: colors.textMuted },
  toggle: {
    flexDirection: 'row',
    padding: spacing.sm,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: { backgroundColor: colors.primary },
  summaryRow: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    alignItems: 'center',
    flexDirection: 'row',
  },
  conflictBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  conflictBtnActive: {
    backgroundColor: colors.error,
    borderColor: colors.error,
  },
  conflictText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  conflictTextActive: { color: '#fff' },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    maxHeight: '80%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: spacing.sm,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchInput: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    color: colors.text,
    fontSize: 14,
  },
  tabText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: '#fff' },
  left: { flex: 1, marginRight: spacing.sm },
  right: { alignItems: 'flex-end', marginRight: spacing.sm },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  ticker: { fontSize: 15, fontWeight: '700', color: colors.text, width: 70 },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  count: { fontSize: 13, fontWeight: '600', color: colors.text },
  buy: { color: '#1b8a3a', fontWeight: '600' },
  sell: { color: colors.error, fontWeight: '600' },
  chevron: { fontSize: 20, color: colors.textMuted },
});
