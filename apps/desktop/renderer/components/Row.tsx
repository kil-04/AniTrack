import React, { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pixelSpriteForSection } from "../../../../packages/shared/pixel-sprites";
import { useSkin } from "../lib/skin";
import { PixelSprite } from "./PixelSprite";

interface Props {
  /** Omitted when the caller puts its own header above the row. */
  title?: string;
  children: React.ReactNode;
}

const Row = React.memo(function Row({ title, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  };
  // Pixel mode puts the row's sprite beside its title ("Trending now": a flame).
  const skin = useSkin();
  const sprite = title && skin === "pixel" ? pixelSpriteForSection(title) : null;
  return (
    <section className="group/row mb-10">
      {title && <h2 className="section-title mb-3 flex items-center gap-3 px-8">{sprite && <PixelSprite id={sprite} scale={2} />}{title}</h2>}
      <div className="relative">
        <button
          onClick={() => scroll(-1)}
          className="absolute left-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop transition hover:scale-105 group-hover/row:flex"
        >
          <ChevronLeft />
        </button>
        <button
          onClick={() => scroll(1)}
          className="absolute right-2 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full glass shadow-pop transition hover:scale-105 group-hover/row:flex"
        >
          <ChevronRight />
        </button>
        <div
          ref={ref}
          className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-8 pb-4 pt-2"
        >
          {children}
        </div>
      </div>
    </section>
  );
});

export default Row;
