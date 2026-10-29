import path from 'node:path';

export interface SourceServiceConfig {
  key:string;
  operatorKey:string;
  operatorOrigin:string;
  profileDir:string;
  port:number;
  bindAddress:'127.0.0.1'|'0.0.0.0';
}
export interface ProfileBoundaries {
  /** Existing application profiles must never be shared with this service. */
  reservedRoots?:readonly string[];
  /** A home or application-data directory is not a dedicated profile. */
  reservedDirectories?:readonly string[];
}
const samePath=(left:string,right:string)=>path.relative(left,right)==='';
const inside=(root:string,target:string)=>{const relative=path.relative(root,target);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
function key(value:string|undefined,name:string):string {
  if(!value||!/^[-A-Za-z0-9_]{32,256}$/.test(value))throw new Error(`Configure ${name} as a separate random base64url key of 32–256 characters.`);
  return value;
}

/** Validate all configuration before creating a profile or starting Electron work. */
export function sourceServiceConfig(env:Record<string,string|undefined>,boundaries:ProfileBoundaries={}):SourceServiceConfig {
  const serviceKey=key(env.SOURCE_SERVICE_KEY,'SOURCE_SERVICE_KEY');
  const operatorKey=key(env.SOURCE_OPERATOR_KEY,'SOURCE_OPERATOR_KEY');
  if(serviceKey===operatorKey)throw new Error('The source service and operator need different keys.');
  const operatorOrigin=env.SOURCE_OPERATOR_ORIGIN??env.RENDER_EXTERNAL_URL??'';
  try {const origin=new URL(operatorOrigin);if(origin.protocol!=='https:'||origin.origin!==operatorOrigin)throw Error();}
  catch {throw new Error('SOURCE_OPERATOR_ORIGIN must be an exact HTTPS origin without credentials, a path, query or fragment.');}
  const profile=env.SOURCE_PROFILE_DIR;
  if(!profile||/[\x00-\x1f\x7f]/.test(profile)||!path.isAbsolute(profile))throw new Error('SOURCE_PROFILE_DIR must be a dedicated absolute profile directory.');
  const profileDir=path.resolve(profile);
  if(samePath(profileDir,path.parse(profileDir).root)||(boundaries.reservedDirectories??[]).some(directory=>samePath(path.resolve(directory),profileDir))||(boundaries.reservedRoots??[]).some(root=>inside(path.resolve(root),profileDir)))throw new Error('SOURCE_PROFILE_DIR must be separate from personal and desktop application profiles.');
  const bindAddress=env.SOURCE_BIND_ADDRESS??'0.0.0.0';
  if(bindAddress!=='0.0.0.0'&&bindAddress!=='127.0.0.1')throw new Error('SOURCE_BIND_ADDRESS must be 0.0.0.0 or 127.0.0.1.');
  const portText=env.PORT??'8080',port=Number(portText);
  if(!/^[1-9]\d{0,4}$/.test(portText)||port>65535)throw new Error('PORT must be a decimal port from 1 to 65535.');
  return {key:serviceKey,operatorKey,operatorOrigin,profileDir,bindAddress,port};
}
