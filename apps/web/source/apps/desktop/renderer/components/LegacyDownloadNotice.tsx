import { hasLegacyPendingDownloads } from "../lib/downloads";

/** One explanation for the visible list, rather than a warning on every item. */
export default function LegacyDownloadNotice({ items }: {items: readonly unknown[]}) {
  if (!hasLegacyPendingDownloads(items)) return null;
  return (
    <p role="note" className="mb-5 rounded-xl border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100/90">
      An older tab may still be downloading these items. If you have closed it, remove the unfinished entries and download them again.
    </p>
  );
}
