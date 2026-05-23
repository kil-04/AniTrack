import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  title: string;
  children: React.ReactNode;
}

export default function Row({ title, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <section className="group/row mb-8">
      <h2 className="mb-3 px-8 text-lg font-semibold">{title}</h2>
      <div className="relative">
        <button
          onClick={() => scroll(-1)}
          className="absolute left-0 top-0 z-10 hidden h-full w-12 items-center justify-center bg-gradient-to-r from-bg to-transparent opacity-0 transition group-hover/row:flex group-hover/row:opacity-100"
        >
          <ChevronLeft />
        </button>
        <button
          onClick={() => scroll(1)}
          className="absolute right-0 top-0 z-10 hidden h-full w-12 items-center justify-center bg-gradient-to-l from-bg to-transparent opacity-0 transition group-hover/row:flex group-hover/row:opacity-100"
        >
          <ChevronRight />
        </button>
        <div
          ref={ref}
          className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth px-8 pb-2"
        >
          {children}
        </div>
      </div>
    </section>
  );
}
