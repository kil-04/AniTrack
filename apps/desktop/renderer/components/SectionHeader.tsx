import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, type LucideIcon } from "lucide-react";

/** A section's title row: accent icon tile, title (optionally a link) and actions on the right. */
export default function SectionHeader({
  icon: Icon,
  title,
  to,
  subtitle,
  children,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  to?: string;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
}) {
  const heading = (
    <span className="flex min-w-0 items-center gap-3">
      {Icon && (
        <span className="icon-tile h-8 w-8 rounded-lg">
          <Icon size={16} strokeWidth={2.2} />
        </span>
      )}
      <span className="min-w-0">
        <span className="section-title flex items-center gap-1.5">
          <span className="truncate">{title}</span>
          {to && <ChevronRight size={20} className="shrink-0 text-ink-3 transition group-hover/sh:translate-x-0.5 group-hover/sh:text-accent" />}
        </span>
        {subtitle && <span className="block truncate text-xs text-ink-3">{subtitle}</span>}
      </span>
    </span>
  );
  return (
    <div className={`mb-4 flex items-center justify-between gap-4 ${className}`}>
      {to ? (
        <Link to={to} className="group/sh min-w-0 rounded-lg">{heading}</Link>
      ) : (
        heading
      )}
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </div>
  );
}
