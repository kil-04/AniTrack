import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Play } from "lucide-react";
import type { StreamingServiceLink } from "../../shared/types";

// Services that open inside the app's embedded browser instead of externally.
const IN_APP_SERVICES = new Set(["Anikoto"]);

interface Props {
  animeId: number;
}

export default function WatchOnMenu({ animeId }: Props) {
  const [links, setLinks] = useState<StreamingServiceLink[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    window.api.legal.links(animeId).then(setLinks);
  }, [animeId]);

  if (!links.length) return null;

  function handleClick(l: StreamingServiceLink) {
    if (IN_APP_SERVICES.has(l.service)) {
      navigate(`/stream?url=${encodeURIComponent(l.url)}`);
    } else {
      window.api.legal.open(l.url);
    }
  }

  const inApp = links.filter((l) => IN_APP_SERVICES.has(l.service));
  const external = links.filter((l) => !IN_APP_SERVICES.has(l.service));

  return (
    <div className="rounded-lg border border-white/10 bg-bg-card p-4">
      {inApp.length > 0 && (
        <>
          <div className="mb-2 text-sm font-semibold">Watch in-app</div>
          <div className="mb-4 grid grid-cols-1 gap-2">
            {inApp.map((l) => (
              <button
                key={l.service}
                onClick={() => handleClick(l)}
                className="flex items-center justify-between rounded-md bg-accent/20 border border-accent/30 px-3 py-2.5 text-sm text-white transition hover:bg-accent/30"
              >
                <span className="font-medium">{l.service}</span>
                <Play size={14} className="text-accent" fill="currentColor" />
              </button>
            ))}
          </div>
        </>
      )}

      {external.length > 0 && (
        <>
          <div className="mb-2 text-sm font-semibold text-white/60">Watch externally</div>
          <div className="grid grid-cols-2 gap-2">
            {external.map((l) => (
              <button
                key={l.service}
                onClick={() => handleClick(l)}
                className="flex items-center justify-between rounded-md bg-bg-elev px-3 py-2 text-sm text-white/90 transition hover:bg-white/10"
              >
                <span>{l.service}</span>
                <ExternalLink size={14} className="text-muted" />
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Opens service search in your browser.
          </p>
        </>
      )}
    </div>
  );
}
