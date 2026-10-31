import {lookup} from 'node:dns/promises';
import {BlockList, isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {Readable} from 'node:stream';
import type {LookupFunction} from 'node:net';
import {reject} from './protocol';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]] as const) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001:db8::',32,'ipv6');
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // Public unicast IPv6 only; mapped/local/link-local/reserved forms fail.
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
}
/** Resolve once, check every answer, and pin the selected public address. */
export async function publicMediaFetch(raw: string, headers: Headers, signal: AbortSignal): Promise<Response> {
  let url: URL; try {url = new URL(raw);} catch {return reject(502, 'INVALID_MEDIA_DESTINATION');}
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password) return reject(502, 'INVALID_MEDIA_DESTINATION');
  const host = url.hostname.replace(/^\[|\]$/g,'');
  const addresses = isIP(host) ? [{address:host,family:isIP(host)}] : await lookup(host, {all:true,verbatim:true});
  if (!addresses.length || addresses.some(row => !publicAddress(row.address))) return reject(502, 'INVALID_MEDIA_DESTINATION');
  const chosen = addresses.find(row => row.family === 4) ?? addresses[0];
  const pinned: LookupFunction = (_host, options, callback) => {
    if ((options as {all?: boolean}).all) (callback as (...args: any[]) => void)(null,[chosen]);
    else callback(null, chosen.address, chosen.family);
  };
  const outgoing = new Headers(headers); outgoing.set('Accept-Encoding','identity');
  for (const name of ['host','connection','content-length','transfer-encoding','proxy-authorization']) outgoing.delete(name);
  return new Promise<Response>((resolve,rejectRequest) => {
    const request = httpsRequest(url, {headers:Object.fromEntries(outgoing),lookup:pinned,signal}, response => {
      const responseHeaders = new Headers();
      for (const [name,value] of Object.entries(response.headers)) if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(response) as ReadableStream, {status:response.statusCode ?? 502,headers:responseHeaders}));
    });
    request.setTimeout(30000, () => request.destroy(new Error('Media transfer stalled.')));
    request.once('error',rejectRequest); request.end();
  });
}
