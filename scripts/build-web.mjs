import {build} from 'vite';
import {build as bundle} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
await build({configFile:path.join(root,'apps/web/vite.config.ts')});
await bundle({entryPoints:[path.join(root,'apps/web/server/site.ts')],outfile:path.join(root,'dist-web/server.cjs'),bundle:true,platform:'node',format:'cjs',target:'node20',alias:{'cloudflare:workers':path.join(root,'apps/web/server/runtime.ts')},logLevel:'info'});
const directory=path.join(root,'dist-web/public'),assets=[];
async function collect(base,prefix=''){
  for(const entry of await readdir(base,{withFileTypes:true})){
    const relative=prefix+entry.name;
    if(entry.isDirectory())await collect(path.join(base,entry.name),relative+'/');
    else if(relative.startsWith('assets/')||['logo.png','manifest.webmanifest','song_charts.json'].includes(relative))assets.push('/'+relative);
  }
}
await collect(directory);assets.sort();
const template=await readFile(path.join(root,'apps/web/public/sw.js'),'utf8'),hash=createHash('sha256').update(template);
for(const asset of assets)hash.update(asset).update(await readFile(path.join(directory,asset.slice(1))));
const worker=template.replace('__ANITRACK_BUILD__',hash.digest('hex').slice(0,20)).replace('/* ANITRACK_ASSETS */ []',JSON.stringify(assets));
await writeFile(path.join(directory,'sw.js'),worker);
console.log(`Render website: ${assets.length} offline assets; server API bundled.`);
