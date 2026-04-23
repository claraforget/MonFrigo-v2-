import { useState, useEffect } from "react";
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

  useEffect(() => {
    if (!isLoaded) return;
    const k = keys(userId);
    setCount(parseInt(localStorage.getItem(k.count) ?? "0", 10));
    setIsSubscribed(localStorage.getItem(k.sub) === "true");
  }, [isLoaded, userId]);

  const isBlocked = isLoaded && !isSubscribed && count >= FREE_GENERATIONS;
  const remainingFree = Math.max(0, FREE_GENERATIONS - count);

  const incrementCount = () => {
    const next = count + 1;
    setCount(next);
    localStorage.setItem(keys(userId).count, String(next));
    if (!isSubscribed && next >= FREE_GENERATIONS) {
      setShowPaywall(true);
    }
  };

  const checkAndGenerate = (generate: () => void) => {
    if (isBlocked) {
      setShowPaywall(true);
      return;
    }
    generate();
  };

  const subscribe = () => {
    setIsSubscribed(true);
    localStorage.setItem(keys(userId).sub, "true");
    setShowPaywall(false);
  };

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
