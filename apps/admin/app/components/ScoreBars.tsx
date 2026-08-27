export interface ScoreBreakdown {
  need: number | null;
  value: number | null;
  activity: number | null;
  reachability: number | null;
}

export function ScoreBars({ scores, compact = false }: { scores: ScoreBreakdown; compact?: boolean }) {
  const items = [
    ["Need", scores.need],
    ["Value", scores.value],
    ["Activity", scores.activity],
    ["Reachability", scores.reachability],
  ] as const;

  return (
    <div className={compact ? "score-bars score-bars-compact" : "score-bars"}>
      {items.map(([label, value]) => (
        <div className="score-dimension" key={label}>
          <div className="score-dimension-head">
            <span>{label}</span>
            <strong>{value ?? "—"}</strong>
          </div>
          <div
            className="score-track"
            role="meter"
            aria-label={`${label} heuristic score`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value ?? 0}
          >
            <span className="score-fill" style={{ width: `${value ?? 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
