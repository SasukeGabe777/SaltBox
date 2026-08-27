export function StatusBadge({ status }: { status: string | null }) {
  const normalized = status?.toLowerCase() ?? "pending";
  const tone = normalized === "qualified" ? "positive" : normalized === "rejected" ? "negative" : "neutral";
  return <span className={`status-badge status-${tone}`}>{normalized.replaceAll("_", " ")}</span>;
}
