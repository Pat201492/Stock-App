import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

// Official SEC EDGAR filing views, keyed by ticker. These are stable public URLs.
function edgar(ticker: string, type: string): string {
  const t = encodeURIComponent(ticker);
  const ty = type ? `&type=${encodeURIComponent(type)}` : '';
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${t}${ty}&dateb=&owner=include&count=40`;
}

export default function FederalFilings({ ticker }: { ticker: string }) {
  const links: { label: string; url: string }[] = [
    { label: 'All SEC filings', url: edgar(ticker, '') },
    { label: '10-K (annual report)', url: edgar(ticker, '10-K') },
    { label: '10-Q (quarterly report)', url: edgar(ticker, '10-Q') },
    { label: '8-K (material events)', url: edgar(ticker, '8-K') },
    { label: 'Form 4 (insider transactions)', url: edgar(ticker, '4') },
    { label: 'DEF 14A (proxy statement)', url: edgar(ticker, 'DEF 14A') },
    {
      label: 'EDGAR full-text search',
      url: `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22`,
    },
  ];
  return (
    <View>
      {links.map((l) => (
        <TouchableOpacity
          key={l.label}
          style={styles.row}
          onPress={() => Linking.openURL(l.url)}
          testID={`filing-${l.label}`}
        >
          <Text style={styles.label}>{l.label}</Text>
          <Text style={styles.ext}>↗</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  label: { flex: 1, fontSize: 14, color: colors.primary },
  ext: { fontSize: 13, color: colors.textMuted },
});
