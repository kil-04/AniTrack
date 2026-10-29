import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Startup/protocol checks only. This never opens or controls a source website.
const root=fileURLToPath(new URL('../',import.meta.url));
const appDir=path.resolve(process.argv[2]??path.join(root,'artifacts/web-qa/source-runtime'));
const packageInfo=JSON.parse(await readFile(path.join(appDir,'package.json'),'utf8'));
if(packageInfo.name!=='anitrack-source-service')throw Error('Choose the dedicated source-service runtime directory.');
const electron=path.join(root,'node_modules/electron/dist',process.platform==='win32'?'electron.exe':'electron');
const port=await new Promise((resolve,reject)=>{
  const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port));});
});
const serviceKey=randomBytes(32).toString('base64url'),operatorKey=randomBytes(32).toString('base64url');
const profile=path.join(root,'artifacts/web-qa/source-profiles',randomBytes(12).toString('hex'));
await mkdir(profile,{recursive:true});
const childEnv={...process.env,PORT:String(port),SOURCE_BIND_ADDRESS:'127.0.0.1',SOURCE_SERVICE_KEY:serviceKey,SOURCE_OPERATOR_KEY:operatorKey,SOURCE_OPERATOR_ORIGIN:'https://operator.example.test',SOURCE_PROFILE_DIR:profile};
delete childEnv.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,[appDir],{cwd:root,env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
let exited=false,startFailure=false;
child.on('error',()=>{startFailure=true;});child.on('exit',()=>{exited=true;});
// Drain diagnostics without exposing environment values or browser data.
child.stdout.resume();child.stderr.resume();
const base=`http://127.0.0.1:${port}`,checks={};
async function request(route,options={}){return fetch(base+route,{...options,redirect:'manual',signal:AbortSignal.timeout(3000)});}
try{
  const deadline=Date.now()+60000;let ready=false;
  while(Date.now()<deadline&&!exited&&!startFailure){
    try{ready=(await request('/health')).status===200;if(ready)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!ready)throw Error('The isolated source service did not start. No source was enabled.');
  checks.startup=true;
  checks.unauthenticated=(await request('/v1/rpc',{method:'POST',body:'{}'})).status===401;
  const auth={Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'};
  checks.crossOriginRejected=(await request('/v1/rpc',{method:'POST',headers:{...auth,Origin:'https://visitor.example.test'},body:'{}'})).status===403;
  checks.unknownSourceRejected=(await request('/v1/rpc',{method:'POST',headers:auth,body:JSON.stringify({kind:'anime',source:'unregistered',method:'search',args:['fixture']})})).status===400;
  checks.operatorProtected=(await request('/operator')).status===401;
  checks.healthDoesNotExposeCredentials=!JSON.stringify(await(await request('/health')).json()).includes(serviceKey);
  if(Object.values(checks).some(value=>!value))throw Error('A startup/protocol check failed. No source was enabled.');
  const report={date:new Date().toISOString(),version:packageInfo.version,scope:'Real isolated Electron startup and HTTP boundary; no source website interaction',bind:'127.0.0.1',checks,limits:['Container startup and production hosting remain unverified.','No live source, verification challenge, playback or full download was exercised by this check.']};
  await writeFile(path.join(root,'artifacts/web-qa/source-service-runtime.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}finally{
  if(!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);}
}
