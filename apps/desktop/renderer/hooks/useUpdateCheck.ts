import { useEffect, useState } from "react";
import { isAndroid } from "../lib/platform";
import { version as currentVersion } from "../../../../package.json";

const OWNER = "kil-04";
const REPO  = "AniTrack";
const DISMISS_KEY = "update_dismissed";

function newerThan(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, "").split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true;
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false;
  }
  return false;
}

export function useUpdateCheck() {
  const [updateUrl, setUpdateUrl] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isAndroid) return;

    const dismissed = sessionStorage.getItem(DISMISS_KEY);
    if (dismissed) return;

    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((r) => r.json())
      .then((data) => {
        const tag = data.tag_name as string;
        if (!tag) return;
        if (newerThan(tag, currentVersion)) {
          setLatestVersion(tag.replace(/^v/, ""));
          const apk = (data.assets as any[])?.find((a: any) =>
            a.name.endsWith(".apk")
          );
          setUpdateUrl(apk?.browser_download_url ?? data.html_url);
        }
      })
      .catch(() => {});
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setUpdateUrl(null);
    setLatestVersion(null);
  }

  return { updateUrl, latestVersion, dismiss };
}
