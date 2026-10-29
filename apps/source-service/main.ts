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
  const server = createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 130000); timer.unref();
    outgoing.on('close', () => {clearTimeout(timer); if (!outgoing.writableFinished) controller.abort();});
    try {
      const request = new Request(`http://source-service${incoming.url}`, {
        method: incoming.method, headers: incoming.headers as Record<string, string>, signal: controller.signal,
        ...(!['GET','HEAD'].includes(incoming.method ?? '') ? {body: Readable.toWeb(incoming) as ReadableStream, duplex: 'half'} : {}),
      } as RequestInit);
      const response = new URL(request.url).pathname.startsWith('/operator') ? await operator.handle(request) : await service.handle(request);
      clearTimeout(timer);
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
