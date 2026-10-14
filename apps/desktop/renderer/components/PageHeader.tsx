import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** A page's title block: a large accent icon tile, the title, a subtitle line and actions on the right. */
export default function PageHeader({
  icon: Icon,
  title,
  subtitle,
  children,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-8 flex flex-wrap items-center justify-between gap-4 ${className}`}>
      <div className="flex min-w-0 items-center gap-4">
        {Icon && (
          <span className="icon-tile h-12 w-12 rounded-2xl shadow-[0_0_32px_-10px_rgb(var(--accent)/0.6)]">
            <Icon size={22} strokeWidth={2.1} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[30px] font-extrabold leading-tight tracking-tight text-white">{title}</h1>
          {subtitle && <div className="mt-0.5 truncate text-sm text-ink-3">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
