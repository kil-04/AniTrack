export interface DownloadClaim { webOwner: string; webGeneration: string }
export interface OwnedDownload { webOwner?: string; webGeneration?: string }
export interface DownloadLocks {
    request<T>(name: string, options: {mode?: 'exclusive'; ifAvailable?: boolean; signal?: AbortSignal}, work: (lock: unknown | null) => T | Promise<T>): Promise<T>;
}
interface OwnerOptions { id?: string; locks?: DownloadLocks; browser?: boolean }
const token = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** One live tab lease covers its queued, resolving and active download work.
 * Web Locks release automatically when a tab crashes/closes; short resource
 * locks make ownership/recovery changes atomic without holding up network work.
 */
export class DownloadOwner {
    readonly id: string;
    private locks?: DownloadLocks;
    private browser: boolean;
    private ready?: Promise<void>;
    private hold?: Promise<unknown>;
    private release?: () => void;
    private closed = false;
    private held = false;
    private local = new Map<string, Promise<unknown>>();
    constructor(options: OwnerOptions = {}) {
        this.id = options.id ?? token();
        this.browser = options.browser ?? (typeof window !== 'undefined' && typeof document !== 'undefined');
        this.locks = options.locks ?? (this.browser && typeof navigator !== 'undefined' ? navigator.locks as unknown as DownloadLocks : undefined);
    }
    get supported() { return !!this.locks || !this.browser; }
    private requireSupport() {
        if (!this.supported) throw new Error('This browser cannot coordinate downloads between tabs. Update your browser or use the installed app.');
        if (this.closed) throw new Error('This download tab is closing. Retry in another tab.');
    }
    ensure(): Promise<void> {
        this.requireSupport();
        if (this.ready) return this.ready;
        if (!this.locks) { this.held = true; return this.ready = Promise.resolve(); }
        let acquired!: () => void, failed!: (error: unknown) => void;
        this.ready = new Promise<void>((resolve, reject) => { acquired = resolve; failed = reject; });
        const lifetime = new Promise<void>(resolve => { this.release = resolve; });
        this.hold = this.locks.request(`anitrack-download-owner:${this.id}`, {mode: 'exclusive', ifAvailable: true}, async lock => {
            if (!lock) throw new Error('The download tab lease could not be acquired. Reload and retry.');
            this.held = true;
            acquired();
            await lifetime;
            this.held = false;
        }).catch(error => { this.held = false; failed(error); });
        return this.ready;
    }
    async isLive(owner: string | undefined): Promise<boolean> {
        if (!owner) return false;
        if (owner === this.id && this.held && !this.closed) return true;
        if (!this.locks) return false;
        return this.locks.request(`anitrack-download-owner:${owner}`, {mode: 'exclusive', ifAvailable: true}, lock => !lock);
    }
    claim(): DownloadClaim { return {webOwner: this.id, webGeneration: token()}; }
    matches(row: OwnedDownload | undefined | null, claim: DownloadClaim): boolean {
        return !!row && row.webOwner === claim.webOwner && row.webGeneration === claim.webGeneration;
    }
    withResource<T>(scope: string, id: string, work: () => Promise<T> | T): Promise<T> {
        this.requireSupport();
        const name = `anitrack-download-resource:${scope}:${id}`;
        if (this.locks) return this.locks.request(name, {mode: 'exclusive', signal: AbortSignal.timeout(5000)}, () => work());
        // Node/unit harnesses have one process. Real browser tabs require the
        // native lock above rather than an unsafe localStorage spinlock.
        const previous = this.local.get(name) ?? Promise.resolve();
        const current = previous.catch(() => {}).then(work);
        this.local.set(name, current);
        return current.finally(() => { if (this.local.get(name) === current) this.local.delete(name); });
    }
    async close(): Promise<void> {
        this.closed = true;
        this.held = false;
        this.release?.();
        await this.hold;
    }
}

export const downloadOwner = new DownloadOwner();
