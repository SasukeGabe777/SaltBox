export function formatDateTime(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function formatClockTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function formatLocation(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join(", ") || "Not observed";
}

export function humanizeCode(code: string): string {
  return code
    .replace(/[._-]+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function formatObservationValue(value: unknown, unit: string | null): string {
  let formatted: string;
  if (value === null || value === undefined) formatted = "Not recorded";
  else if (typeof value === "boolean") formatted = value ? "YES" : "NO";
  else if (typeof value === "object") formatted = "Structured details";
  else formatted = String(value);
  return unit && formatted !== "Not recorded" ? `${formatted} ${unit}` : formatted;
}
