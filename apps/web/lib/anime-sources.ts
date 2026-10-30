import {AnikotoProvider} from './anikoto/anikoto';
import {configureAnikotoTransport,type SourceText} from './anikoto/anikoto-browser';
import {browserAnimeSource} from './anime-source-info';
import {getAnikotoTop} from './anikoto/anikoto-top';
const anikoto = new AnikotoProvider();
const value = (raw: unknown, maximum = 16384) => {
  if (typeof raw !== 'string' || !raw || raw.length > maximum || /[\x00-\x1f]/.test(raw)) throw new Error('Invalid source selection.');
  return raw;
};
export async function animeOperation(method: string, args: any[], transport: SourceText): Promise<any> {
  const id = value(args[0],32), source = browserAnimeSource(id);
  if (!source) throw new Error('Unknown anime source.');
  if (source.web.state === 'native-required') throw new Error(source.web.description);
  if (id !== 'anikoto') throw new Error('Choose a supported source operation.');
  configureAnikotoTransport(transport);
  if (method === 'search') return anikoto.search(value(args[1],200));
  if (method === 'episodes') return anikoto.getEpisodes(value(args[1],512),Number(args[2])||1);
  if (method === 'links') return anikoto.getStreamLinks(value(args[1],8192),value(args[2],512));
  if (method === 'resolve') return anikoto.resolveStream(value(args[1]));
  if (method === 'ids') return anikoto.getExternalIds(value(args[1],512));
  if (method === 'top') return getAnikotoTop();
  throw new Error('Unknown source operation.');
}
