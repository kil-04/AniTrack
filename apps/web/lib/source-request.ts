import {publicHttps} from '../source/packages/shared/manga';

export function cacheableSourceRequest(init: RequestInit): boolean {
  const headers = new Headers(init.headers);
  return (!init.method || init.method.toUpperCase() === 'GET') && init.cache !== 'no-store' && !headers.has('authorization') && !headers.has('cookie');
}

/** Only server-resolved public-media hints enter signed proxy receipts. */
export function mediaRequestHeaders(input: Record<string,string> = {}): Record<string,string> {
  const result: Record<string,string> = {'User-Agent':'AniTrack/9.2.2 (Web)'};
  for (const [name,value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length > 2048 || /[\r\n\0]/.test(value)) throw new Error('The source returned invalid media headers.');
    const key = name.toLowerCase();
    if (['authorization','cookie','proxy-authorization'].includes(key)) throw new Error('This media requires a verified source session in the installed app.');
    if (key === 'referer') {
      const url = publicHttps(value);
      if (!url) throw new Error('The source returned an invalid media referer.');
      result.Referer = url.href;
    } else if (key === 'origin') {
      const url = publicHttps(value);
      if (!url || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw new Error('The source returned an invalid media origin.');
      result.Origin = url.origin;
    } else if (key === 'accept') result.Accept = value;
    else if (key === 'accept-language') result['Accept-Language'] = value;
    // The website identifies itself consistently; source cookies and browser
    // fingerprint headers never become a public forwarding interface.
  }
  return result;
}
