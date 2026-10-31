export type DownloadPayloadKind = 'media' | 'key' | 'subtitle';

/** A successful HTTP response can still be a source error page. Keys are binary
 * data, so never interpret their bytes as HTML or JSON. Encrypted media may also
 * have no recognizable codec signature; reject documents rather than requiring
 * a particular container or MIME type. */
export async function assertDownloadPayload(blob: Blob, kind: DownloadPayloadKind): Promise<void> {
  if (!blob.size) throw new Error('The source returned an empty download file.');
  if (kind === 'key') {
    if (blob.size !== 16) throw new Error('The source returned an invalid HLS encryption key.');
    return;
  }
  const prefix = (await blob.slice(0, 1024).text()).trimStart();
  if (kind === 'subtitle') {
    if (blob.size > 4 * 1024 * 1024 || !/^WEBVTT(?:[\t \r\n]|$)/.test(prefix))
      throw new Error('This subtitle could not be saved as WebVTT. Use online playback for this selection.');
    return;
  }
  if (/^<(?:!doctype\s+html\b|html\b|head\b|body\b|title\b|script\b|!--|error\b|\?xml\b)/i.test(prefix)
      || /^(?:access denied\b|forbidden\b|service unavailable\b|gateway timeout\b)/i.test(prefix))
    throw new Error('The source returned an error page instead of media. Retry this download or choose another server.');
  if (/^[\[{]/.test(prefix) && blob.size <= 65536) {
    let document = false;
    try { const value = JSON.parse(await blob.text()); document = value !== null && typeof value === 'object'; } catch { }
    if (document) throw new Error('The source returned a JSON response instead of media. Retry this download or choose another server.');
  }
}
