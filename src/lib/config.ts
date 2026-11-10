import "dotenv/config";
import { z } from "zod";

const int = (def: number) => z.coerce.number().int().nonnegative().default(def);

const schema = z.object({
  CONCURRENCY: int(10),
  PER_DOMAIN_DELAY_MS: int(5000),
  TIMEOUT_MS: int(15000),
  RETRIES: int(3),
  RETRY_DELAYS_MS: z
    .string()
    .default("2000,8000,30000")
    .transform((s) => s.split(",").map((n) => Number(n.trim())).filter(Number.isFinite)),
  MAX_BODY_BYTES: int(5 * 1024 * 1024),
  MAX_REDIRECTS: int(5),
  PROXY_LIST: z.string().default("proxies.txt"),
  PROXY_FAIL_THRESHOLD: int(3),
  PROXY_COOLDOWN_MS: int(600_000),
});

export type Config = z.output<typeof schema>;

/** Crawler settings from .env with spec defaults. */
export const config: Config = schema.parse(process.env);
