import path from 'node:path';
import {existsSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import type {SourceService} from './handler';

export async function loadWebsite(root:string,origin:string,key:string,service:SourceService):Promise<((request:Request)=>Promise<Response>)|undefined>{
  const bundle=path.join(root,'dist-web/server.cjs');
  if(!existsSync(bundle))return;
  const {createWebsite}=require(bundle) as {createWebsite(options:unknown):Promise<(request:Request)=>Promise<Response>>};
  const environment={
    ANITRACK_MEDIA_SECRET:process.env.ANITRACK_MEDIA_SECRET||createHmac('sha256',key).update('AniTrack Render website media v1').digest('base64url'),
    ANITRACK_SOURCE_SERVICE_URL:origin,ANITRACK_SOURCE_SERVICE_KEY:key,
    ANITRACK_SOURCE_ENABLED_SOURCES:process.env.ANITRACK_SOURCE_ENABLED_SOURCES??'anichan',
    ANITRACK_MAL_CLIENT_ID:process.env.ANITRACK_MAL_CLIENT_ID,
    ANITRACK_MAL_CLIENT_SECRET:process.env.ANITRACK_MAL_CLIENT_SECRET,
    ANITRACK_ANILIST_CLIENT_ID:process.env.ANITRACK_ANILIST_CLIENT_ID,
  };
  const sourceFetch:typeof fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.origin!==origin||url.search||url.hash||!(url.pathname==='/v1/rpc'||/^\/v1\/assets\/[A-Za-z0-9_-]{32}$/.test(url.pathname)))throw Error('Invalid internal source request.');
    return service.handle(new Request('http://source-service'+url.pathname,init));
  };
  return createWebsite({directory:path.join(root,'dist-web/public'),origin,environment,sourceFetch});
}
