import { Loader2, type LucideIcon } from "lucide-react";

/**
 * A spinning icon. The spin is on a wrapper, not on the icon: Chromium animates an
 * HTML element's transform on the compositor, but an `<svg>`'s on the main thread,
 * where one spinning icon cost about 450 ms of every second (measured) and made the
 * rest of the window stutter for as long as something was loading. Classes (colour,
 * margins) go on the wrapper; the icon draws in the current colour.
 */
export default function Spinner({ icon: Icon = Loader2, size = 16, spinning = true, className = "" }: {
  icon?: LucideIcon;
  size?: number;
  /** False keeps the icon still (a Refresh button at rest). */
  spinning?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 ${spinning ? "animate-spin" : ""} ${className}`}>
      <Icon size={size} />
    </span>
  );
}
