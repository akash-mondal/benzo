/**
 * Activity — the full feed, grouped by day (Today / Yesterday / date). Pull-down
 * empty + skeleton states; everything in plain English.
 */
import { useMemo } from "react";
import { Clock } from "lucide-react";
import { useWallet } from "../lib/store";
import { dayBucket } from "../lib/format";
import { Screen, Stagger } from "../ui/motion";
import { EmptyState } from "../ui/primitives";
import { ActivityItem } from "../ui/ActivityItem";
import type { ActivityRow } from "../lib/api";

export function Activity() {
  const { history, loading, hidden } = useWallet();

  const groups = useMemo(() => {
    const m = new Map<string, ActivityRow[]>();
    for (const row of history) {
      const k = dayBucket(row.timestamp);
      (m.get(k) ?? m.set(k, []).get(k)!).push(row);
    }
    return [...m.entries()];
  }, [history]);

  return (
    <Screen>
      <div className="px-5 pb-1 pt-6">
        <h1 className="font-display text-2xl">Activity</h1>
      </div>
      <div className="px-5">
        {loading ? (
          <div className="space-y-3 px-2 pt-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton h-[42px] w-[42px] rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton h-3.5 w-32 rounded" />
                  <div className="skeleton h-3 w-24 rounded" />
                </div>
                <div className="skeleton h-4 w-16 rounded" />
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <EmptyState icon={<Clock size={28} />} title="No activity yet" hint="Money you send, receive, or add will show up here." />
        ) : (
          groups.map(([label, rows], gi) => (
            <Stagger key={label} className="mb-2">
              <div className="px-1 pb-1 pt-3 text-[12px] font-bold uppercase tracking-[0.05em] text-muted">{label}</div>
              <div className="rounded-[var(--radius-card)] bg-card px-4 shadow-[var(--shadow-card)]">
                {rows.map((row, i) => (
                  <Stagger.Item key={row.id} index={Math.min(gi * 2 + i, 6)}>
                    <ActivityItem row={hidden ? { ...row } : row} last={i === rows.length - 1} />
                  </Stagger.Item>
                ))}
              </div>
            </Stagger>
          ))
        )}
        <div className="h-6" />
      </div>
    </Screen>
  );
}
