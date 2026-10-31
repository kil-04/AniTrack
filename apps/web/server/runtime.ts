export const env:Record<string,unknown>={};
let sourceFetch:typeof fetch|undefined;
export function configureRuntime(settings:Record<string,unknown>,transport:typeof fetch){
  for(const key of Object.keys(env))delete env[key];
  Object.assign(env,settings);sourceFetch=transport;
}
export function nativeSourceFetch():typeof fetch {
  if(!sourceFetch)throw new Error('The source service is unavailable.');
  return sourceFetch;
}
