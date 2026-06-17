import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useClient } from '../context/ClientContext';
import {
  PolTickerTrade,
  InsiderTickerTrade,
  NewsItem,
  EtfDetailResponse,
  EtfHolding,
} from '../api/types';
import { shared, colors, spacing } from '../theme';
import { Section } from './DetailView';
import PolTimeline, { TLTrade } from '../components/PolTimeline';
import Collapsible from '../components/Collapsible';
import NewsList from '../components/NewsList';
import FederalFilings from '../components/FederalFilings';
import InsiderRows from '../components/InsiderRows';

function polToTimeline(trades: PolTickerTrade[]): TLTrade[] {
  return trades.map((t) => ({
    id: t.trade_id,
    date: t.transaction_date,
    politician: t.politician_name,
    party: t.party,
    chamber: t.chamber,
    ticker: '',
    type: t.transaction_type,
    amountMin: t.amount_min,
    amountMax: t.amount_max,
    bioguideId: t.bioguide_id,
  }));
}

function HoldingsList({ holdings }: { holdings: EtfHolding[] }) {
  if (!holdings || holdings.length === 0) {
    return <Text style={styles.empty}>No holdings on record.</Text>;
  }
  return (
    <View>
      {holdings.map((h) => (
        <View key={h.ticker} style={styles.row} testID={`holding-${h.ticker}`}>
          <Text style={styles.ticker}>{h.ticker}</Text>
          <View style={styles.mid}>
            <Text style={styles.name} numberOfLines={1}>
              {h.name}
            </Text>
            {h.sector ? <Text style={styles.sector}>{h.sector}</Text> : null}
          </View>
          {h.score != null ? <Text style={styles.score}>{Math.round(h.score)}</Text> : null}
          <Text style={styles.weight}>
            {h.weight != null ? `${(h.weight * 100).toFixed(2)}%` : '–'}
          </Text>
        </View>
      ))}
    </View>
  );
}

export default function EtfDetailScreen({ route, navigation }: any) {
  const ticker: string = route?.params?.ticker ?? '';
  const { client } = useClient();
  const [detail, setDetail] = useState<EtfDetailResponse | null>(null);
  const [pol, setPol] = useState<PolTickerTrade[]>([]);
  const [insider, setInsider] = useState<InsiderTickerTrade[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      client.getEtfDetail(ticker),
      client.getPolByTicker(ticker).catch(() => ({ ticker, trades: [] })),
      client.getInsiderTicker(ticker).catch(() => ({ ticker, trades: [] })),
      client.getTickerNews(ticker, 15).catch(() => [] as NewsItem[]),
    ])
      .then(([d, p, ins, nw]) => {
        setDetail((d ?? {}) as EtfDetailResponse);
        setPol(p.trades);
        setInsider(ins.trades);
        setNews(nw);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load ETF');
      })
      .finally(() => setLoading(false));
  }, [ticker]);

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

  const holdings = detail?.holdings ?? [];

  return (
    <ScrollView style={shared.screen} testID="etf-detail">
      <Collapsible title="News" defaultOpen count={news.length}>
        <NewsList items={news} />
      </Collapsible>

      {detail?.etf && <Section title="Overview" data={detail.etf as Record<string, unknown>} />}

      {/* Holdings — visible (the bug was these never rendered) */}
      <Collapsible title="Holdings" defaultOpen count={holdings.length}>
        <HoldingsList holdings={holdings} />
      </Collapsible>

      <Collapsible title="Congress Trades" count={pol.length}>
        <PolTimeline
          trades={polToTimeline(pol)}
          filterByPolitician
          emptyText="No congressional trades on record."
          onPressPolitician={(bioguideId, name) =>
            navigation?.navigate('PoliticianTrades', { bioguideId, name })
          }
        />
      </Collapsible>
      <Collapsible title="Insider Trades" count={insider.length}>
        <InsiderRows trades={insider} emptyText="No insider trades on record." />
      </Collapsible>
      <Collapsible title="Federal Filings">
        <FederalFilings ticker={ticker} />
      </Collapsible>
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { color: colors.textMuted, fontSize: 14, padding: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  ticker: { width: 64, fontWeight: '700', color: colors.text, fontSize: 14 },
  mid: { flex: 1, marginRight: spacing.sm },
  name: { color: colors.textSecondary, fontSize: 13 },
  sector: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  score: { width: 34, textAlign: 'right', color: colors.textMuted, fontSize: 13 },
  weight: { width: 62, textAlign: 'right', fontWeight: '600', color: colors.text, fontSize: 13 },
});
