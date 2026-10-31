import {SourceServiceClient,SourceServiceClientError,type SourceServiceSelection} from './source-service-client';
import {nativeSourceFetch} from '../server/runtime';

const known=new Set(['animepahe','anikoto','shonen','anichan','mangadot','mangaball','xcomic','toonkotsu']);
type Settings=Record<string,unknown>;
type SignAsset=(path:string)=>Promise<string>;
function client(settings:Settings,signAsset:SignAsset) {
  return new SourceServiceClient({origin:String(settings.ANITRACK_SOURCE_SERVICE_URL??''),key:String(settings.ANITRACK_SOURCE_SERVICE_KEY??'')},{signAsset,fetch:nativeSourceFetch()});
}
/** Sources are enabled individually only after hosting and complete media QA. */
export function standaloneSources(settings:Settings):string[] {
  const selected=[...new Set(String(settings.ANITRACK_SOURCE_ENABLED_SOURCES??'').split(',').map(id=>id.trim()).filter(id=>known.has(id)))];
  if(!selected.length)return [];
  try{client(settings,async()=>{throw new Error('No media in a status request.');});return selected;}catch{return [];}
}
function helpful(error:unknown):string {
  const code=error instanceof SourceServiceClientError?error.code:'';
  if(code==='SOURCE_VERIFICATION_REQUIRED')return 'This source needs its website check refreshed. Choose another source and try again later.';
  if(code==='MEDIA_EXPIRED'||code==='SERVER_LIST_EXPIRED')return 'This source connection expired. Select the episode or chapter again.';
  if(error instanceof SourceServiceClientError&&error.status===429)return 'This source is busy. Wait a little before trying again.';
  return 'This source connection is unavailable. Try another source or return later.';
}
export async function standaloneCall(settings:Settings,input:SourceServiceSelection,signAsset:SignAsset) {
  if(!standaloneSources(settings).includes(input.source))throw new Error('This source connection is not enabled yet.');
  try{return await client(settings,signAsset).call(input);}catch(error){
    const manual=input.kind==='anime'&&error instanceof SourceServiceClientError&&(error.status===403||error.status===429||error.code==='SOURCE_VERIFICATION_REQUIRED');
    throw new Error((manual?'PROVIDER_ACCESS_DENIED: ':'')+helpful(error));
  }
}
export async function standaloneAsset(settings:Settings,path:string,request:Request,signAsset:SignAsset):Promise<Response> {
  try{return await client(settings,signAsset).asset(path,{range:request.headers.get('range')??undefined,signal:request.signal});}
  catch(error){
    const status=error instanceof SourceServiceClientError&&[403,410,416,429].includes(error.status)?error.status:502;
    return Response.json({error:helpful(error)},{status,headers:{'Cache-Control':'no-store'}});
  }
}
