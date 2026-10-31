/** Keep long native chapter lists below the Worker's bounded catalogue size. */
export function chapterPage<T>(chapters: readonly T[],page:number) {
  const size=1000;
  return {chapters:chapters.slice((page-1)*size,page*size),totalPages:Math.max(1,Math.ceil(chapters.length/size))};
}
