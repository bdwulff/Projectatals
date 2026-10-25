import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updatedAt: Date | null;
}

/** Tiny polling hook: fetches on mount, every `intervalMs`, and on demand. */
export function usePoll<T>(fetcher: () => Promise<T>, deps: unknown[] = [], intervalMs = 30_000): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      if (!alive.current) return;
      setData(result);
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => {
      alive.current = false;
      window.clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh, updatedAt };
}

/** Ticks every `ms` so clocks re-render. */
export function useNow(ms = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
