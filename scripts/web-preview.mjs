import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {createWebsite}=require(path.join(root,'dist-web/server.cjs'));
let website;
const server=createServer(async(incoming,outgoing)=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>{controller.abort();outgoing.destroy();},130000);timer.unref();
  outgoing.once('close',()=>{clearTimeout(timer);if(!outgoing.writableFinished)controller.abort();});
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const request=new Request(origin+incoming.url,{method:incoming.method,headers:incoming.headers,signal:controller.signal,...(!['GET','HEAD'].includes(incoming.method??'')?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    const response=await website(request);if(controller.signal.aborted){await response.body?.cancel();return;}
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);else outgoing.end();
  }catch{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end('Preview unavailable');}
});
server.listen(Number(process.env.ANITRACK_PREVIEW_PORT??0),'127.0.0.1',async()=>{
  const origin=`http://127.0.0.1:${server.address().port}`;
  website=await createWebsite({directory:path.join(root,'dist-web/public'),origin,environment:{ANITRACK_MEDIA_SECRET:randomBytes(32).toString('base64url'),ANITRACK_SOURCE_ENABLED_SOURCES:''},sourceFetch:async()=>Response.json({error:'SOURCE_UNAVAILABLE'},{status:503})});
  console.log(`Local: ${origin}`);
});
const close=()=>server.close(()=>process.exit(0));process.once('SIGTERM',close);process.once('SIGINT',close);
