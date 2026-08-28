import type { AnimeRecommendation } from "../../../../packages/shared/types";
import Card from "./Card";

export default function RecommendationCard({ recommendation }: { recommendation: AnimeRecommendation }) {
  return (
    <div className="w-36 shrink-0">
      <Card anime={recommendation.anime} size="sm" />
      <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-white/45">
        {recommendation.reason}
      </p>
    </div>
  );
}
