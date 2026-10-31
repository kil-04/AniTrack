export interface MediaReceipt {expires: number; url?: string; hls?: boolean; headers?: Record<string,string>; sourceAsset?: string}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = (text: string) => Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')), value => value.charCodeAt(0));
async function key(secret: unknown) {
  if (typeof secret !== 'string' || !secret) throw new Error('The web media service is not configured.');
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signMediaReceipt(secret: unknown, info: MediaReceipt): Promise<string> {
  const data=encode(new TextEncoder().encode(JSON.stringify(info)));
  const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(data))));
  return `/api/media?t=${data}.${signature}`;
}
export async function readMediaReceipt(secret: unknown, token: string|null, now=Date.now()): Promise<MediaReceipt> {
  if (!token || token.length>12000 || token.split('.').length!==2) throw new Error('Invalid media access.');
  const [data,signature]=token.split('.');
  try {
    if (!signature || !await crypto.subtle.verify('HMAC',await key(secret),decode(signature),new TextEncoder().encode(data))) throw new Error();
  } catch {throw new Error('Invalid media access.');}
  let info: MediaReceipt;
  try {info=JSON.parse(new TextDecoder().decode(decode(data)));}catch{throw new Error('Invalid media access.');}
  if (!info || !Number.isFinite(info.expires) || info.expires<now) throw new Error('This stream access expired. Select the episode again.');
  if ((typeof info.url==='string')===(typeof info.sourceAsset==='string')) throw new Error('Invalid media access.');
  return info;
}
