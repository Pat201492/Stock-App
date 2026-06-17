import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useClient } from '../context/ClientContext';
import {
  StockDetailResponse,
  PolTickerTrade,
  InsiderTickerTrade,
  NewsItem,
} from '../api/types';
import { shared, colors } from '../theme';
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

export default function StockDetailScreen({ route, navigation }: any) {
  const ticker: string = route?.params?.ticker ?? '';
  const { client } = useClient();
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [pol, setPol] = useState<PolTickerTrade[]>([]);
  const [insider, setInsider] = useState<InsiderTickerTrade[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      client.getStockDetail(ticker),
      client.getPolByTicker(ticker).catch(() => ({ ticker, trades: [] })),
      client.getInsiderTicker(ticker).catch(() => ({ ticker, trades: [] })),
      client.getTickerNews(ticker, 15).catch(() => [] as NewsItem[]),
    ])
      .then(([d, p, ins, nw]) => {
        setDetail(d);
        setPol(p.trades);
        setInsider(ins.trades);
        setNews(nw);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load stock');
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

  return (
    <ScrollView style={shared.screen} testID="stock-detail">
      {/* News — top, open by default */}
      <Collapsible title="News" defaultOpen count={news.length}>
        <NewsList items={news} />
      </Collapsible>

      {/* Snapshot — always visible */}
      {detail && <Section title="Overview" data={detail.stock} />}

      {/* Collapsible, collapsed by default */}
      <Collapsible title="Fundamentals">
        {detail && <Section data={detail.fundamentals} />}
      </Collapsible>
      <Collapsible title="Valuation">
        {detail && <Section data={detail.valuation} />}
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
