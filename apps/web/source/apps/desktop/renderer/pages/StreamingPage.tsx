import {Link, useNavigate} from 'react-router-dom';
import {ArrowLeft, Globe} from 'lucide-react';
import SourceOverview from '../components/SourceOverview';

export default function StreamingPage() {
  const navigate = useNavigate();
  return <div className="min-h-screen bg-bg px-5 py-8 text-white sm:px-8">
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
        <button className="btn btn-secondary btn-sm" onClick={()=>navigate(-1)}><ArrowLeft size={15}/> Back</button>
        <Link className="btn btn-ghost btn-sm" to="/">AniTrack Home</Link>
      </div>
      <header className="mb-8 max-w-3xl">
        <div className="mb-3 flex items-center gap-3"><span className="icon-tile"><Globe size={20}/></span><h1 className="text-3xl font-extrabold">All sources</h1></div>
        <p className="text-sm leading-relaxed text-ink-2">The anime and manga sources selected for the published app are listed here. Browser-ready connections play or read inside AniTrack. Connections that need a source's verified app session show that requirement explicitly; opening their website does not transfer a native session into this page.</p>
      </header>
      <SourceOverview />
      <p className="mt-9 text-sm text-ink-3">Your saved downloads remain available from Downloads. <a className="text-accent hover:underline" href="https://github.com/kil-04/AniTrack/releases/latest" target="_blank" rel="noreferrer">Installed AniTrack apps</a> support the native source connections.</p>
    </div>
  </div>;
}
