import { useEffect, useState } from "react";
// Seconds until a unix time, ticking once a second; null once it has passed.
export function useCountdown(at: number | null | undefined) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now() / 1000), 1000); return () => window.clearInterval(t); }, []);
  if (!at) return null;
  const s = Math.floor(at - now);
  return s > 0 ? s : null;
}
export const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${String(x).padStart(2, "0")}s` : `${x}s`; };
