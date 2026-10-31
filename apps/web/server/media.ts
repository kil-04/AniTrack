import {mediaPrefix} from '../../source-service/assets';

/** Source HTML and scripts must never be served as active content on the app origin. */
export async function safeMedia(response:Response,request:Request):Promise<Response>{
  let type=(response.headers.get('content-type')??'application/octet-stream').split(';')[0].trim().toLowerCase();
  let body:ReadableStream<Uint8Array>|null=response.body;
  if(!/^(?:video\/|audio\/|image\/(?:jpeg|png|webp|avif|gif|bmp)$|application\/octet-stream$|text\/(?:plain|vtt)$|application\/(?:vtt|x-subrip)$)/.test(type)){
    if(response.status===200&&!request.headers.has('range')&&body){
      const inspected=await mediaPrefix(body,request.signal);body=inspected.body;
      if(inspected.transportStream)type='video/mp2t';
      else{await body.cancel();throw new Error('The media server returned an unsupported file.');}
    }else{await body?.cancel();throw new Error('The media server returned an unsupported file.');}
  }
  const headers=new Headers({'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=600'});
  for(const name of ['content-length','content-range','accept-ranges']){const value=response.headers.get(name);if(value)headers.set(name,value);}
  return new Response(body,{status:response.status,headers});
}
