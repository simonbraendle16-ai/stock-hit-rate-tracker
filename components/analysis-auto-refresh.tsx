"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Includes writes from API/another tab. No broker or market-data operation. */
export function AnalysisAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let last = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 1000) return;
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
