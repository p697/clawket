import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { requestAutomaticAppReview } from '../services/auto-app-review';

/** Only a return from a thread offers a review opportunity; launch/foreground never do. */
export function useAutomaticAppReview(route: string | null, safe: boolean): () => void {
  const previousRoute = useRef(route);
  const opportunity = useRef(false);
  const generation = useRef(0);
  const latest = useRef({ route, safe });
  latest.current = { route, safe };
  const cancel = useCallback(() => { opportunity.current = false; generation.current += 1; }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') cancel(); });
    return () => subscription.remove();
  }, [cancel]);

  useEffect(() => {
    if (route !== previousRoute.current) {
      opportunity.current = route === 'Roster' && previousRoute.current === 'Thread';
      previousRoute.current = route;
    }
    const revision = ++generation.current;
    if (!safe || route !== 'Roster' || !opportunity.current) return;
    const isSafe = () => generation.current === revision && opportunity.current
      && latest.current.route === 'Roster' && latest.current.safe;
    const timer = setTimeout(() => {
      void requestAutomaticAppReview(isSafe).finally(() => {
        if (generation.current === revision) opportunity.current = false;
      });
    }, 2000);
    return () => { clearTimeout(timer); generation.current += 1; };
  }, [route, safe]);
  return cancel;
}
