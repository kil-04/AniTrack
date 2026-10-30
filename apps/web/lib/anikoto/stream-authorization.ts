import {assertAnikotoMediaUrl} from './anikoto-source';
import type {StreamData} from './types';

// Electron registers these receipts for its network hooks. The Site instead
// validates and signs each observed URL before it reaches the browser.
export function authorizeResolvedStream(stream: StreamData): void {assertAnikotoMediaUrl(stream.url);}
