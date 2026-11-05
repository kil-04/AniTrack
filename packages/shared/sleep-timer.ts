/**
 * The player's sleep timer, as on Android (ui/PlayerScreen.kt): off, stop at the end of
 * this episode, or pause after a number of minutes. Desktop's StreamPlayer keeps the
 * mode and its deadline; this file decides labels and when to stop.
 */

/** 0 off, -1 the end of this episode, otherwise minutes. */
export type SleepMode = number;

export const SLEEP_OFF = 0;
export const SLEEP_END_OF_EPISODE = -1;

export const SLEEP_CHOICES: { mode: SleepMode; label: string }[] = [
  { mode: SLEEP_OFF, label: "Off" },
  { mode: SLEEP_END_OF_EPISODE, label: "End of episode" },
  { mode: 15, label: "15 minutes" },
  { mode: 30, label: "30 minutes" },
  { mode: 45, label: "45 minutes" },
  { mode: 60, label: "1 hour" },
];

export const isSleepMode = (value: unknown): value is SleepMode =>
  SLEEP_CHOICES.some((choice) => choice.mode === value);

/** When a timed mode should pause playback (epoch ms); null for off and end of episode. */
export function sleepDeadline(mode: SleepMode, now: number): number | null {
  return mode > 0 ? now + mode * 60_000 : null;
}

/** Whole minutes left, rounded up so the last minute reads "1 min left", never "0". */
export function sleepMinutesLeft(deadline: number | null, now: number): number | null {
  if (deadline == null) return null;
  return Math.max(1, Math.ceil((deadline - now) / 60_000));
}

/** The settings row's value: "Off", "End of episode" or "12 min left". */
export function sleepLabel(mode: SleepMode, deadline: number | null, now: number): string {
  if (mode === SLEEP_END_OF_EPISODE) return "End of episode";
  const left = mode > 0 ? sleepMinutesLeft(deadline, now) : null;
  return left == null ? "Off" : `${left} min left`;
}

/** Whether a timed mode's moment has come. */
export function sleepDue(mode: SleepMode, deadline: number | null, now: number): boolean {
  return mode > 0 && deadline != null && now >= deadline;
}

/** At the end of an episode: stop here instead of starting the next one. */
export const sleepStopsAtEpisodeEnd = (mode: SleepMode) => mode === SLEEP_END_OF_EPISODE;
