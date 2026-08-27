import { useEffect } from "react";
import { useRevalidator } from "react-router";
import { formatClockTime } from "../utils/format";

export function RefreshControl({ updatedAt, intervalMs = 3000 }: { updatedAt: string; intervalMs?: number }) {
  const revalidator = useRevalidator();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        void revalidator.revalidate();
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, revalidator]);

  return (
    <div className="refresh-control" aria-live="polite">
      <span className={revalidator.state === "idle" ? "refresh-indicator" : "refresh-indicator is-refreshing"} />
      <span>{revalidator.state === "idle" ? `Updated ${formatClockTime(updatedAt)}` : "Refreshing…"}</span>
      <button className="button button-quiet" type="button" onClick={() => void revalidator.revalidate()}>
        Refresh now
      </button>
    </div>
  );
}
