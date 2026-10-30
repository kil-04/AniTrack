import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** A native select in the app's input style with its own chevron; a chosen value gets the accent edge. */
export default function SelectField({
  value,
  onChange,
  children,
  className = "",
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        title={title}
        onChange={(e) => onChange(e.target.value)}
        className={`input cursor-pointer appearance-none pr-9 ${value ? "border-accent/45 bg-accent/[0.08] text-white" : "text-ink-2"}`}
      >
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
    </div>
  );
}
