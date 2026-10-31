export function secondsToTimestamp(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function minutesLeft(durationSec: number, positionSec: number): string {
  const left = Math.max(0, durationSec - positionSec);
  const m = Math.round(left / 60);
  return `${m} min left`;
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** AniList's media status as a short label: RELEASING → "Airing". */
export function animeStatusLabel(status?: string | null): string {
  switch (status) {
    case "RELEASING": return "Airing";
    case "FINISHED": return "Finished";
    case "NOT_YET_RELEASED": return "Upcoming";
    case "HIATUS": return "On hiatus";
    case "CANCELLED": return "Cancelled";
    default: return status ? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ") : "Airing";
  }
}
