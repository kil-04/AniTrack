import {app} from 'electron';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {SourceService} from './handler';
import {sourceServiceConfig} from './config';

const config=sourceServiceConfig(process.env,{
  reservedRoots:[app.getPath('userData'),path.join(app.getPath('appData'),'AniTrack'),path.join(app.getPath('appData'),'anitrack')],
  reservedDirectories:[app.getPath('home'),app.getPath('appData')],
});
const {key,profileDir:profile}=config;
mkdirSync(profile, {recursive:true,mode:0o700});
app.setPath('userData', profile);
const sessions = path.join(profile,'sessions');mkdirSync(sessions,{recursive:true,mode:0o700});
app.setPath('sessionData',sessions);
app.enableSandbox();
app.setName('AniTrack Source Service');
// This server never plays video; avoid a hardware GPU pipeline on small hosts.
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let approvedOrigins = () => new Set<string>();
const configuredSessions = new WeakSet<Electron.Session>();
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({action:'deny'}));
  contents.setAudioMuted(true);
  contents.on('will-attach-webview', event => event.preventDefault());
  const navigation = (event: Electron.Event, target: string) => {
    try {if (!approvedOrigins().has(new URL(target).origin)) event.preventDefault();} catch {event.preventDefault();}
  };
  contents.on('will-navigate', navigation);
  contents.on('will-redirect', navigation);
  if (!configuredSessions.has(contents.session)) {
    configuredSessions.add(contents.session);
    contents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    contents.session.setPermissionCheckHandler(()=>false);
    contents.session.on('will-download', event => event.preventDefault());
  }
});

void app.whenReady().then(async () => {
  const {NativeSourceAdapter} = await import('./adapter');
  const {SourceOperator} = await import('./operator');
  const adapter = new NativeSourceAdapter();
  approvedOrigins = () => adapter.approvedOrigins();
  const service = new SourceService(adapter, key);
  const operator = new SourceOperator(config.operatorKey, config.operatorOrigin, () => adapter.approvedOrigins(), adapter.operatorConnections());
  const {loadWebsite}=await import('./website');
  const website=await loadWebsite(app.getAppPath(),config.operatorOrigin,key,service);
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    // Keep the deadline through response delivery, including slow preview clients.
    const timer = setTimeout(() => {controller.abort(); outgoing.destroy();}, 130000); timer.unref();
    outgoing.on('close', () => {clearTimeout(timer); if (!outgoing.writableFinished) controller.abort();});
    try {
      if(!incoming.url?.startsWith('/'))throw Error('Invalid request path.');
      const request = new Request(`${config.operatorOrigin}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers as Record<string, string>, signal: controller.signal,
        ...(!['GET','HEAD'].includes(incoming.method ?? '') ? {body: Readable.toWeb(incoming) as ReadableStream, duplex: 'half'} : {}),
      } as RequestInit);
      const pathname=new URL(request.url).pathname;
      const response = pathname.startsWith('/operator') ? await operator.handle(request)
        : pathname==='/health'||pathname.startsWith('/v1/')||!website ? await service.handle(request)
        : await website(request);
      if(controller.signal.aborted){await response.body?.cancel();outgoing.destroy();return;}
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body as any).on('error', () => outgoing.destroy()).pipe(outgoing);
      else outgoing.end();
    } catch {if (!outgoing.headersSent) outgoing.writeHead(502, {'Content-Type':'application/json'}); outgoing.end('{"error":"SERVICE_UNAVAILABLE"}');}
  });
  server.requestTimeout = 130000; server.headersTimeout = 15000; server.maxHeadersCount = 30;
  server.listen(config.port, config.bindAddress, () => console.log(`AniTrack source service listening on ${config.bindAddress}:${config.port}`));
  const close = () => {service.close(); server.close(() => app.quit()); setTimeout(() => app.exit(0), 5000).unref();};
  process.once('SIGTERM', close); process.once('SIGINT', close);
}).catch(() => {console.error('The source service could not start. Check its configuration and isolated profile directory.'); app.exit(1);});
