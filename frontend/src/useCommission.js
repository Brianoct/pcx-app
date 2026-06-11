import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './apiClient';

export function useCommission(token, user, role) {
  const [commission, setCommission] = useState(0);
  const [isTopSeller, setIsTopSeller] = useState(false);

  const refresh = useCallback(async () => {
    if (!token || !user) return;
    try {
      const params = new URLSearchParams({
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      });
      const data = await apiRequest(`/api/commission/current?${params.toString()}`, {
        token,
        timeoutMs: 10000
      });
      setCommission(Number(data?.commission || 0));
      setIsTopSeller(Boolean(data?.isTopSeller));
    } catch (err) {
      console.error('Error fetching personal commission:', err);
      setCommission(0);
      setIsTopSeller(false);
    }
  }, [token, user]);

  const reset = useCallback(() => {
    setCommission(0);
    setIsTopSeller(false);
  }, []);

  useEffect(() => {
    // refresh() only sets state after awaiting the API response, so it does not
    // trigger the cascading-render hazard this rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [token, user, role, refresh]);

  return { commission, isTopSeller, refresh, reset };
}
