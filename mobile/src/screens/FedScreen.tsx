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
      <View style={styles.center} testID="loading-state">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error != null) {
    return (
      <View style={styles.center} testID="error-state">
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <ScrollView testID="fed-list">
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#c00', fontSize: 16 },
  row: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  label: { fontWeight: 'bold', fontSize: 14 },
  context: { fontSize: 12, color: '#666', marginTop: 4 },
});
