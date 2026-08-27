import type { FormEventHandler } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { streamVariant } from "../../lib/provider-api";

export interface EpisodeRange {
  start: number;
  end: number;
}

interface StreamEpisodePanelProps {
  mobile: boolean;
  sources: any[];
  providerId: string;
  providerLabel: (providerId: string) => string;
  onSwitchProvider: (source: any) => void;
  streamVariants?: "quality" | "subtitle-type";
  links: any[];
  selectedLink: number;
  onChangeVariant: (index: number) => void;
  ranges: EpisodeRange[];
  rangeStart: number;
  rangeLabel: string;
  rangeOpen: boolean;
  onToggleRange: () => void;
  onSelectRange: (start: number) => void;
  findNumber: string;
  onFindNumber: (value: string) => void;
  onFindSubmit: FormEventHandler<HTMLFormElement>;
  loading: boolean;
  episodes: any[];
  currentEpisode: any | null;
  watchedEpisodes: Map<number, number>;
  onPlayEpisode: (episode: any) => void;
}

export function StreamEpisodePanel({
  mobile,
  sources,
  providerId,
  providerLabel,
  onSwitchProvider,
  streamVariants,
  links,
  selectedLink,
  onChangeVariant,
  ranges,
  rangeStart,
  rangeLabel,
  rangeOpen,
  onToggleRange,
  onSelectRange,
  findNumber,
  onFindNumber,
  onFindSubmit,
  loading,
  episodes,
  currentEpisode,
  watchedEpisodes,
  onPlayEpisode,
}: StreamEpisodePanelProps) {
  return (
    <div className={`flex flex-col ${mobile ? "flex-1 overflow-hidden" : "w-[260px] flex-shrink-0 border-r border-white/10"} bg-[#000000]`}>
      {sources.length > 0 && (
        <div className="border-b border-white/10 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">Servers</div>
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => {
              const id = source.providerId || "animepahe";
              const active = id === providerId;
              return (
                <button
                  key={id}
                  onClick={() => { if (!active) onSwitchProvider(source); }}
                  className={`flex h-8 items-center gap-2 rounded px-3 text-xs font-medium transition-colors ${
                    active
                      ? "bg-[#e50914] text-white"
                      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {providerLabel(id)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {streamVariants === "subtitle-type" && links.length > 1 && (
        <div className="border-b border-white/10 p-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/50">Sub Type</div>
          <div className="flex gap-2">
            {links.map((link, index) => {
              const variant = streamVariant(link);
              const label = variant === "hard" ? "Hard Sub" : variant === "dub" ? "Dub" : "Soft Sub";
              return (
                <button
                  key={index}
                  onClick={() => onChangeVariant(index)}
                  className={`flex h-8 flex-1 items-center justify-center rounded text-xs font-semibold transition-all duration-200 ${
                    selectedLink === index
                      ? "bg-[#e50914] text-white shadow-[0_0_12px_rgba(229,9,20,0.4)]"
                      : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="relative flex gap-2 border-b border-white/10 p-2">
        <div className="relative">
          <button
            onClick={onToggleRange}
            disabled={ranges.length <= 1}
            className="flex h-8 items-center gap-1 rounded border border-white/10 bg-white/5 px-2 text-xs text-white/80 hover:bg-white/10 disabled:opacity-60"
          >
            <span>{rangeLabel}</span>
            {ranges.length > 1 && (
              <ChevronDown size={12} className={`transition-transform ${rangeOpen ? "rotate-180" : ""}`} />
            )}
          </button>
          {rangeOpen && ranges.length > 1 && (
            <>
              <div className="fixed inset-0 z-20" onClick={onToggleRange} />
              <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-32 overflow-y-auto rounded-md border border-white/10 bg-[#222222] shadow-xl">
                {ranges.map((range) => (
                  <button
                    key={range.start}
                    onClick={() => onSelectRange(range.start)}
                    className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-white/10 ${
                      range.start === rangeStart ? "bg-white/10 text-white" : "text-white/70"
                    }`}
                  >
                    {`${String(range.start).padStart(3, "0")}-${String(range.end).padStart(3, "0")}`}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <form onSubmit={onFindSubmit} className="flex-1">
          <input
            value={findNumber}
            onChange={(event) => onFindNumber(event.target.value)}
            placeholder="Find number"
            className="h-8 w-full rounded border border-white/10 bg-white/5 px-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
            type="number"
            min={1}
          />
        </form>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex h-20 items-center justify-center">
            <Loader2 size={16} className="animate-spin text-white/40" />
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {episodes.map((episode) => {
              const current = (currentEpisode?.id ?? currentEpisode?.session) === (episode.id ?? episode.session);
              const watchedPercent = watchedEpisodes.get(episode.episodeNumber ?? episode.episode) ?? 0;
              const watched = !current && watchedPercent >= 85;
              return (
                <button
                  key={episode.id ?? episode.session}
                  onClick={() => onPlayEpisode(episode)}
                  className={`flex h-9 items-center justify-center rounded text-xs font-medium transition ${
                    current
                      ? "bg-[#e50914] text-white"
                      : watched
                        ? "bg-green-500/20 text-green-400 ring-1 ring-green-500/30 hover:bg-green-500/30"
                        : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {episode.episodeNumber ?? episode.episode}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
