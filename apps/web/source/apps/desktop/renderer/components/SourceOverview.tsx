import {Link} from 'react-router-dom';
import {browserAnimeSources} from '../../../../../lib/anime-source-info';
import {browserMangaSources} from '../../../../../lib/manga-source-info';

export default function SourceOverview() {
  const groups = [
    {title:'Anime sources',browse:'/filter',items:browserAnimeSources().map(source=>({id:source.id,name:source.name,web:source.web}))},
    {title:'Manga sources',browse:'/manga/search',items:browserMangaSources().map(source=>({id:source.id,name:source.label,web:source.web}))},
  ];
  return <div className="space-y-9">
    {groups.map(group=><section key={group.title}>
      <h2 className="mb-4 text-xl font-bold">{group.title}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {group.items.map(source=><article key={source.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold">{source.name}</h3>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${source.web.state==='available'?'bg-emerald-400/10 text-emerald-300':'bg-amber-300/10 text-amber-200'}`}>{source.web.state==='available'?'Browser support':source.web.state==='limited'?'Source restricted':'Connection needed'}</span>
          </div>
          <p className="flex-1 text-sm leading-relaxed text-ink-2">{source.web.description}</p>
          <p className="mt-3 text-xs text-ink-3">{source.web.downloads?'Offline downloads supported':'New browser downloads unavailable for this connection'}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {source.web.state==='available'&&<Link className="btn btn-primary btn-sm" to={group.browse}>Browse in AniTrack</Link>}
            <a className="btn btn-secondary btn-sm" href={source.web.website} target="_blank" rel="noreferrer">Open source</a>
          </div>
        </article>)}
      </div>
    </section>)}
  </div>;
}
