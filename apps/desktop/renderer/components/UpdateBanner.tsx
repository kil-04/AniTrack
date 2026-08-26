import { Download, X } from "lucide-react";
import { useUpdateCheck } from "../hooks/useUpdateCheck";

export default function UpdateBanner() {
  const { updateUrl, latestVersion, dismiss } = useUpdateCheck();

  if (!updateUrl || !latestVersion) return null;

  function openDownload() {
    import("@capacitor/browser").then(({ Browser }) => {
      Browser.open({ url: updateUrl! });
    });
  }

  return (
    <div className="flex items-center gap-3 bg-violet-600 px-4 py-2 text-sm text-white">
      <Download size={15} className="shrink-0" />
      <span className="flex-1">
        v{latestVersion} is available
      </span>
      <button
        onClick={openDownload}
        className="rounded bg-white/20 px-3 py-1 font-medium hover:bg-white/30"
      >
        Download
      </button>
      <button onClick={dismiss} className="opacity-60 hover:opacity-100">
        <X size={15} />
      </button>
    </div>
  );
}
