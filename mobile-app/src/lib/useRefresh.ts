import { useCallback, useState } from 'react';

/** Pull-to-refresh state for a ScrollView's RefreshControl. */
export function useRefresh(load: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  return { refreshing, onRefresh };
}
