/**
 * GET /orders/estimate for the cart and dish details (part 7d): when an order placed now would
 * arrive. Refreshes when the screen comes into view, when the address changes, and every minute.
 * Never throws: on any error the estimate is just left out (the server checks again on order).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useApp } from '@/context/AppContext';
import { orderApi } from '@/services/api';
import { withAuth } from '@/services/session';
import type { DeliveryEstimate, ID } from '@/types';

const REFRESH_MS = 60000;

export function useDeliveryEstimate(addressId?: ID | null, enabled = true): DeliveryEstimate | null {
  const { currentUser } = useApp();
  const [estimate, setEstimate] = useState<DeliveryEstimate | null>(null);
  const latest = useRef(0);
  const active = enabled && currentUser !== null;

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await withAuth((t) => orderApi.estimate(t, addressId ?? undefined));
      if (request === latest.current) setEstimate(next);
    } catch {
      if (request === latest.current) setEstimate(null);
    }
  }, [addressId]);

  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      load();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') load();
      }, REFRESH_MS);
      return () => clearInterval(timer);
    }, [active, load]),
  );

  return active ? estimate : null;
}
