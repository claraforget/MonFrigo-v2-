import { useState, useEffect, useCallback, useRef } from "react";
import { useUser } from "@clerk/react";

const FREE_GENERATIONS = 2;

function keys(userId: string | null) {
  const suffix = userId ?? "anon";
  return {
    count: `frigomenu_generation_count_${suffix}`,
    sub: `frigomenu_subscribed_${suffix}`,
  };
}

export function usePaywall() {
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? null;

  const [count, setCount] = useState<number>(0);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [showPaywall, setShowPaywall] = useState(false);

  // Refs to always have fresh values in callbacks without stale closures
  const countRef = useRef(count);
  const userIdRef = useRef(userId);
  const isSubscribedRef = useRef(isSubscribed);

  useEffect(() => { countRef.current = count; }, [count]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { isSubscribedRef.current = isSubscribed; }, [isSubscribed]);

  useEffect(() => {
    if (!isLoaded) return;
    const k = keys(userId);
    const stored = parseInt(localStorage.getItem(k.count) ?? "0", 10);
    setCount(stored);
    countRef.current = stored;
    setIsSubscribed(localStorage.getItem(k.sub) === "true");
  }, [isLoaded, userId]);

  const isBlocked = isLoaded && !isSubscribed && count >= FREE_GENERATIONS;
  const remainingFree = Math.max(0, FREE_GENERATIONS - count);

  const incrementCount = useCallback(() => {
    const next = countRef.current + 1;
    setCount(next);
    countRef.current = next;
    localStorage.setItem(keys(userIdRef.current).count, String(next));
    if (!isSubscribedRef.current && next >= FREE_GENERATIONS) {
      setShowPaywall(true);
    }
  }, []);

  const checkAndGenerate = useCallback((generate: () => void) => {
    if (isLoaded && !isSubscribedRef.current && countRef.current >= FREE_GENERATIONS) {
      setShowPaywall(true);
      return;
    }
    generate();
  }, [isLoaded]);

  const subscribe = useCallback(() => {
    setIsSubscribed(true);
    isSubscribedRef.current = true;
    localStorage.setItem(keys(userIdRef.current).sub, "true");
    setShowPaywall(false);
  }, []);

  return {
    count,
    isSubscribed,
    isBlocked,
    remainingFree,
    showPaywall,
    setShowPaywall,
    incrementCount,
    checkAndGenerate,
    subscribe,
  };
}
