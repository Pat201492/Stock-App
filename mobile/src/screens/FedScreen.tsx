import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useClient } from '../context/ClientContext';
import { FedSummaryResponse } from '../api/types';
import { shared, colors } from '../theme';

export default function FedScreen() {
  const { client } = useClient();
  const [fed, setFed] = useState<FedSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    client
      .getFedSummary()
      .then((resp) => setFed(resp))
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
      {fed?.series.map((item) => (
        <View key={item.id} style={styles.row} testID={`fed-row-${item.id}`}>
          <Text style={styles.label} testID={`fed-label-${item.id}`}>
            {item.label}
          </Text>
          <Text style={styles.context} testID={`fed-context-${item.id}`}>
            {item.context}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  label: { fontWeight: 'bold', fontSize: 14, color: colors.text },
  context: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
});
