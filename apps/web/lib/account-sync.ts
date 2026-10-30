import type { ListEntry } from '../source/packages/shared/types';

export type AccountService = 'al' | 'mal';
export interface AccountSyncJob {
  key: string;
  service: AccountService;
  account: string;
  entry: ListEntry;
  revision: number;
  nonce?: string;
  attempts: number;
  nextAt: number;
  error?: string;
}
export interface AccountSyncStatus {
  pending: number;
  pendingByService: Record<AccountService, number>;
  errors: Partial<Record<AccountService, string>>;
  syncing: boolean;
}
export interface BrowserAccountSyncApi {
  status(): Promise<AccountSyncStatus>;
  retry(): Promise<AccountSyncStatus>;
}
interface QueueOptions {
  jobs(): AccountSyncJob[];
  save(key: string, job: AccountSyncJob | undefined): void;
  account(service: AccountService): {identity: string | null; connected: boolean};
  send(service: AccountService, entry: ListEntry, account: string): Promise<void>;
  changed?(): void;
  exclusive?(service: AccountService, work: () => Promise<void>): Promise<void>;
  recordExclusive?(key: string, work: () => Promise<void>): Promise<void>;
  now?(): number;
  schedule?(work: () => void, delay: number): unknown;
  cancel?(timer: unknown): void;
}
const SERVICES: AccountService[] = ['al', 'mal'];

/** A persisted job is acknowledged only after that service accepted that revision. */
export class AccountSyncQueue {
  private running: Promise<{sent: Record<AccountService, number>; failed: Record<AccountService, number>}> | null = null;
  private timer: unknown;
  private started = false;
  private batching = 0;
  constructor(private options: QueueOptions) {}
  private now() { return (this.options.now ?? Date.now)(); }
  private changed() { this.options.changed?.(); }
  private jobs() { return this.options.jobs().filter(job => SERVICES.includes(job.service) && !!job.entry && Number.isFinite(job.revision)); }
  start() { this.started = true; void this.flush(); }
  stop() { this.started = false; this.clearTimer(); }
  private async update(key: string, work: () => void) {
    if (this.options.recordExclusive) await this.options.recordExclusive(key, async () => {work();});
    else work();
  }
  async batch(work: () => Promise<void>) {
    this.batching++; this.clearTimer();
    try {await work();} finally {this.batching--; this.arm();}
  }
  async enqueue(entry: ListEntry, services: AccountService[] = SERVICES) {
    for (const service of services) {
      const key = `${service}:${entry.animeId}`;
      await this.update(key, () => {
        const account = this.options.account(service);
        if (!account.identity) return;
        const previous = this.jobs().find(job => job.key === key);
        this.options.save(key, {key, service, account: account.identity, entry: {...entry}, revision: Math.max(this.now(), (previous?.revision ?? 0) + 1), nonce: crypto.randomUUID(), attempts: 0, nextAt: 0});
      });
    }
    this.changed();
    if (this.started && !this.batching) void this.flush();
  }
  async cancelService(service: AccountService) {
    for (const job of this.jobs()) if (job.service === service) await this.update(job.key, () => {
      const pending = this.jobs().find(row => row.key === job.key);
      if (pending?.revision === job.revision && pending.nonce === job.nonce) this.options.save(job.key, undefined);
    });
    this.changed(); this.arm();
  }
  status(): AccountSyncStatus {
    const pendingByService = {al: 0, mal: 0};
    const errors: AccountSyncStatus['errors'] = {};
    for (const job of this.jobs()) {
      pendingByService[job.service]++;
      const account = this.options.account(job.service);
      if (account.identity && account.identity !== job.account) errors[job.service] = 'Changes are waiting for the account that created them.';
      else if (job.error) errors[job.service] = job.error;
    }
    return {pending: pendingByService.al + pendingByService.mal, pendingByService, errors, syncing: !!this.running};
  }
  async flush(force = false, services: AccountService[] = SERVICES) {
    if (this.running) return this.running;
    this.clearTimer();
    const result = {sent: {al: 0, mal: 0}, failed: {al: 0, mal: 0}};
    const run = async (service: AccountService) => {
      const account = this.options.account(service);
      if (!account.connected || !account.identity) return;
      const jobs = this.jobs().filter(job => job.service === service && job.account === account.identity && (force || job.nextAt <= this.now()));
      for (const job of jobs) {
        const currentAccount = this.options.account(service);
        if (!currentAccount.connected || currentAccount.identity !== job.account) break;
        const current = this.jobs().find(row => row.key === job.key);
        if (!current || current.revision !== job.revision || current.nonce !== job.nonce) continue;
        try {
          await this.options.send(service, {...job.entry}, job.account);
          result.sent[service]++;
          await this.update(job.key, () => {
            const pending = this.jobs().find(row => row.key === job.key);
            if (pending?.revision === job.revision && pending.nonce === job.nonce) this.options.save(job.key, undefined);
          });
        } catch (error) {
          result.failed[service]++;
          const attempts = job.attempts + 1;
          const nextAt = this.now() + Math.min(300_000, 5_000 * 2 ** Math.min(attempts - 1, 6));
          await this.update(job.key, () => {
            const pending = this.jobs().find(row => row.key === job.key);
            if (pending?.revision === job.revision && pending.nonce === job.nonce) this.options.save(job.key, {...job, attempts, nextAt, error: error instanceof Error ? error.message : 'Account sync failed. Retry when connected.'});
          });
          // One outage must not trigger a burst for every saved show.
          for (const waiting of this.jobs()) if (waiting.service === service && waiting.account === job.account && waiting.nextAt < nextAt) await this.update(waiting.key, () => {
            const pending = this.jobs().find(row => row.key === waiting.key);
            if (pending?.service === service && pending.account === job.account && pending.nextAt < nextAt) this.options.save(pending.key, {...pending, nextAt});
          });
          this.changed();
          break;
        }
        this.changed();
      }
    };
    this.running = Promise.all(services.map(service => this.options.exclusive ? this.options.exclusive(service, () => run(service)) : run(service))).then(() => result).finally(() => {
      this.running = null; this.changed(); this.arm();
    });
    this.changed();
    return this.running;
  }
  private clearTimer() {
    if (this.timer !== undefined) (this.options.cancel ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = undefined;
  }
  private arm() {
    this.clearTimer();
    if (!this.started || this.running || this.batching) return;
    const ready = this.jobs().filter(job => {
      const account = this.options.account(job.service);
      return account.connected && account.identity === job.account;
    });
    if (!ready.length) return;
    const delay = Math.max(25, Math.min(...ready.map(job => job.nextAt)) - this.now());
    this.timer = (this.options.schedule ?? setTimeout)(() => {this.timer = undefined; void this.flush();}, delay);
  }
}
