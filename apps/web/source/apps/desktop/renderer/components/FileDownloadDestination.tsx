import {useEffect,useState} from 'react';
import {FolderOpen,Loader2} from 'lucide-react';
import {chooseDownloadFolder,fileDestination,folderSavingAvailable,subscribeFileDestination} from '../../../../../lib/local-files';

export default function FileDownloadDestination(){
  const [destination,setDestination]=useState(fileDestination),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>subscribeFileDestination(()=>setDestination(fileDestination())),[]);
  async function choose(){setBusy(true);setError('');try{await chooseDownloadFolder();}catch(problem){setError(problem instanceof Error?problem.message:'The folder could not be selected.');}finally{setBusy(false);}}
  return <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.025] p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-semibold">Save files to your device</p><p className="mt-1 text-sm text-ink-2">{destination.folder?`${destination.name} · one folder per title`:'Title folders are saved as ZIP files in your browser downloads.'}</p></div>
      {folderSavingAvailable()&&<button type="button" onClick={()=>void choose()} disabled={busy} className="btn btn-secondary btn-sm">{busy?<Loader2 size={15} className="animate-spin"/>:<FolderOpen size={15}/>} {destination.folder?'Change folder':'Choose download folder'}</button>}
    </div>
    <p className="mt-2 text-xs text-ink-3">Episodes, chapters and subtitles stay as ordinary files. Keep this tab open until the download finishes. Open episodes with a media player and keep their accompanying files together.</p>
    {error&&<p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </div>;
}
