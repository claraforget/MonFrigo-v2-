import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

const FREE_GENERATIONS = 2;
const UNLIMITED_EMAILS = ["claraforget@icloud.com"];

function keys(userId: string | null) {
  const suffix = userId ?? "anon";
  return {
    count: `monfrigo_generation_count_${suffix}`,
    sub: `monfrigo_subscribed_${suffix}`,
  };
}

// Migration: move legacy "frigomenu_*" keys to "monfrigo_*" on first load
function migrateLegacyKeys(userId: string | null) {
  const suffix = userId ?? "anon";
  const oldCount = `frigomenu_generation_count_${suffix}`;
  const oldSub   = `frigomenu_subscribed_${suffix}`;
  const newCount = `monfrigo_generation_count_${suffix}`;
  const newSub   = `monfrigo_subscribed_${suffix}`;

  const legacyCount = localStorage.getItem(oldCount);
  const legacySub   = localStorage.getItem(oldSub);
  if (legacyCount !== null) {
    if (!localStorage.getItem(newCount)) localStorage.setItem(newCount, legacyCount);
    localStorage.removeItem(oldCount);
  }
  if (legacySub !== null) {
    if (!localStorage.getItem(newSub)) localStorage.setItem(newSub, legacySub);
    localStorage.removeItem(oldSub);
  }
}

export function usePaywall() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const isLoaded = !loading;

  const [count, setCount] = useState<number>(0);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const countRef = useRef(count);
  const userIdRef = useRef(userId);
  const isSubscribedRef = useRef(isSubscribed);

  useEffect(() => { countRef.current = count; }, [count]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { isSubscribedRef.current = isSubscribed; }, [isSubscribed]);

  useEffect(() => {
    if (!isLoaded) return;
    // Migrate old "frigomenu_*" localStorage keys to "monfrigo_*"
    migrateLegacyKeys(userId);
    migrateLegacyKeys(null); // also migrate anon keys
    const k = keys(userId);
    const anonK = keys(null);

    // Migration : si l'abonnement avait été sauvé sous la clé "anon" (bug de timing Clerk),
    // le déplacer vers la vraie clé utilisateur.
    if (userId && localStorage.getItem(anonK.sub) === "true") {
      localStorage.setItem(k.sub, "true");
      localStorage.removeItem(anonK.sub);
    }

    // Migration : idem pour le compteur "anon" → l'additionner à la clé utilisateur
    const anonCount = parseInt(localStorage.getItem(anonK.count) ?? "0", 10);
    if (userId && anonCount > 0) {
      const userCount = parseInt(localStorage.getItem(k.count) ?? "0", 10);
      const merged = Math.max(userCount, anonCount);
      localStorage.setItem(k.count, String(merged));
      localStorage.removeItem(anonK.count);
    }

    const stored = parseInt(localStorage.getItem(k.count) ?? "0", 10);
    setCount(stored);
    countRef.current = stored;
    setIsSubscribed(localStorage.getItem(k.sub) === "true");
  }, [isLoaded, userId]);

  const isUnlimited = UNLIMITED_EMAILS.includes((user?.email ?? "").toLowerCase());
  const isBlocked = isLoaded && !isSubscribed && !isUnlimited && count >= FREE_GENERATIONS;
  const remainingFree = isUnlimited ? Infinity : Math.max(0, FREE_GENERATIONS - count);

  const incrementCount = useCallback(() => {
    const next = countRef.current + 1;
    setCount(next);
    countRef.current = next;
    localStorage.setItem(keys(userIdRef.current).count, String(next));
    if (!isSubscribedRef.current && !isUnlimited && next >= FREE_GENERATIONS) {
      setShowPaywall(true);
    }
  }, [isUnlimited]);

  const checkAndGenerate = useCallback((generate: () => void) => {
    if (isLoaded && !isSubscribedRef.current && !isUnlimited && countRef.current >= FREE_GENERATIONS) {
      setShowPaywall(true);
      return;
    }
    generate();
  }, [isLoaded, isUnlimited]);

  const subscribe = useCallback(() => {
    setIsSubscribed(true);
    isSubscribedRef.current = true;
    localStorage.setItem(keys(userIdRef.current).sub, "true");
    setShowPaywall(false);
  }, []);

  // Permet de réinitialiser manuellement si besoin (ex: débogage)
  const resetCount = useCallback(() => {
    setCount(0);
    countRef.current = 0;
    localStorage.setItem(keys(userIdRef.current).count, "0");
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
    resetCount,
  };
}
