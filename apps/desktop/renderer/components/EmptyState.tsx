import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** The panel shown when a list is empty or failed: a glowing icon, a title, a line of help and actions. */
export default function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  tone = "accent",
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "accent" | "danger";
  className?: string;
}) {
  const tile =
    tone === "danger"
      ? "bg-red-500/[0.12] text-red-300 ring-red-400/20 shadow-[0_0_40px_-10px_rgb(239_68_68/0.5)]"
      : "bg-accent/[0.12] text-accent ring-accent/20 shadow-[0_0_40px_-10px_rgb(var(--accent)/0.6)]";
  return (
    <div className={`panel flex flex-col items-center px-8 py-14 text-center ${className}`}>
      <span className={`mb-5 grid h-16 w-16 place-items-center rounded-3xl ring-1 ring-inset ${tile}`}>
        <Icon size={28} strokeWidth={1.8} />
      </span>
      <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-3">{children}</div>}
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
