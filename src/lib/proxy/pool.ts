import { existsSync, readFileSync } from "node:fs";
import { ProxyAgent, type Dispatcher } from "undici";

export interface ProxyEntry {
  /** full URL incl. credentials — never log or store this */
  readonly url: string;
  /** host:port, safe to store in DB and show in the dashboard */
  readonly label: string;
  fails: number;
  disabledUntil: number;
  dispatcher(): Dispatcher;
}

export interface PoolOptions {
  failThreshold: number;
  cooldownMs: number;
  now?: () => number;
  /** called once when the last working proxy gets disabled (re-armed after a success) */
  onAllDown?: () => void;
  /** for tests: avoid creating real ProxyAgents */
  makeDispatcher?: (url: string) => Dispatcher;
}

/**
 * Round-robin proxy pool with a per-proxy circuit breaker:
 * N consecutive failures → proxy disabled for `cooldownMs`, then tried again.
 * State is in-memory per worker process.
 */
export class ProxyPool {
  private readonly entries: ProxyEntry[];
  private cursor = 0;
  private allDownNotified = false;
  private readonly now: () => number;

  constructor(urls: string[], private readonly opts: PoolOptions) {
    this.now = opts.now ?? Date.now;
    const make = opts.makeDispatcher ?? ((uri: string) => new ProxyAgent({ uri }));
    this.entries = urls.map((url) => {
      let agent: Dispatcher | undefined;
      return {
        url,
        label: labelOf(url),
        fails: 0,
        disabledUntil: 0,
        dispatcher: () => (agent ??= make(url)),
      };
    });
  }

  /** proxies.txt: one `http://user:pass@host:port` per line, `#` comments allowed. Missing file → empty pool (direct). */
  static fromFile(path: string, opts: PoolOptions): ProxyPool {
    if (!existsSync(path)) return new ProxyPool([], opts);
    return new ProxyPool(parseProxyList(readFileSync(path, "utf8")), opts);
  }

  get size(): number {
    return this.entries.length;
  }

  available(): ProxyEntry[] {
    const t = this.now();
    return this.entries.filter((e) => e.disabledUntil <= t);
  }

  allDown(): boolean {
    return this.size > 0 && this.available().length === 0;
  }

  /**
   * Next proxy in round-robin order, skipping disabled ones and preferring
   * proxies not yet used for this check (`exclude`), so each retry goes through a different IP.
   * Returns null when every proxy is disabled.
   */
  pick(exclude: ReadonlySet<string> = new Set()): ProxyEntry | null {
    const avail = this.available();
    if (avail.length === 0) return null;
    const n = this.entries.length;
    for (const allowUsed of [false, true]) {
      for (let i = 0; i < n; i++) {
        const e = this.entries[(this.cursor + i) % n]!;
        if (e.disabledUntil > this.now()) continue;
        if (!allowUsed && exclude.has(e.url)) continue;
        this.cursor = (this.cursor + i + 1) % n;
        return e;
      }
    }
    return null;
  }

  success(e: ProxyEntry): void {
    e.fails = 0;
    e.disabledUntil = 0;
    this.allDownNotified = false;
  }

  failure(e: ProxyEntry): void {
    e.fails += 1;
    if (e.fails >= this.opts.failThreshold) {
      e.disabledUntil = this.now() + this.opts.cooldownMs;
      e.fails = 0; // half-open after cooldown: one more failure streak to trip again
    }
    if (this.allDown() && !this.allDownNotified) {
      this.allDownNotified = true;
      this.opts.onAllDown?.();
    }
  }

  /** ms until the first disabled proxy comes back (0 if one is available now) */
  msUntilAvailable(): number {
    if (!this.allDown()) return 0;
    return Math.max(0, Math.min(...this.entries.map((e) => e.disabledUntil)) - this.now());
  }
}

export function parseProxyList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .filter((l) => {
      try {
        return /^https?:$/.test(new URL(l).protocol); // undici ProxyAgent: HTTP(S) proxies only
      } catch {
        return false;
      }
    });
}

function labelOf(url: string): string {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return "invalid";
  }
}
