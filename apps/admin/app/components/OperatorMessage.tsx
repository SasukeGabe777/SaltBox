import { Link } from "react-router";
import type { OperatorActionResult } from "../data/operator-types";

/** Result banner for an operator mutation (approval, run submission, …). */
export function OperatorMessage({ result }: { result: OperatorActionResult | null }) {
  if (!result) return null;
  const detail = [
    ...(result.detail ?? []),
    ...(result.errors ?? []).map((error) => `${error.field}: ${error.message}`),
  ];
  return (
    <div className={`operator-message ${result.ok ? "is-ok" : "is-blocked"}`} role="status">
      <strong>{result.message}</strong>
      {detail.length > 0 ? (
        <ul>
          {detail.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      {result.runId ? (
        <Link className="button button-quiet" to={`/runs/${result.runId}`}>
          Watch run
        </Link>
      ) : null}
    </div>
  );
}
