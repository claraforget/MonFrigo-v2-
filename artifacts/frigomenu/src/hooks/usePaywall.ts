import { useState, useEffect } from "react";

const FREE_GENERATIONS = 2;
const STORAGE_COUNT_KEY = "frigomenu_generation_count";
const STORAGE_SUB_KEY = "frigomenu_subscribed";

export function usePaywall() {
  const [count, setCount] = useState<number>(() => {
    return parseInt(localStorage.getItem(STORAGE_COUNT_KEY) ?? "0", 10);
  });

  const [isSubscribed, setIsSubscribed] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_SUB_KEY) === "true";
  });

  const [showPaywall, setShowPaywall] = useState(false);

  const isBlocked = !isSubscribed && count >= FREE_GENERATIONS;
  const remainingFree = Math.max(0, FREE_GENERATIONS - count);

  const incrementCount = () => {
    const next = count + 1;
    setCount(next);
    localStorage.setItem(STORAGE_COUNT_KEY, String(next));
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
    localStorage.setItem(STORAGE_SUB_KEY, "true");
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
