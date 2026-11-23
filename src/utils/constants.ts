export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** Mints this indexer treats as USD stablecoins, keyed by mint address. */
export const STABLE_MINTS: Record<string, { symbol: "USDC" | "USDT"; decimals: number }> = {
  [USDC_MINT]: { symbol: "USDC", decimals: 6 },
  [USDT_MINT]: { symbol: "USDT", decimals: 6 },
};

export const STABLE_MINT_LIST = Object.keys(STABLE_MINTS);

/**
 * Transfers below this USD value are NOT stored as `Transfer` rows. The
 * dashboard's value slider bottoms out at $1, so it can never show them, and
 * they are roughly 40% of all transfers. They are still counted in the
 * per-minute `TransferSummary` totals.
 */
export const MIN_STORED_USD = 1;

const DEFAULT_RETENTION_HOURS = 6;

/**
 * How long `Transfer` rows are kept before the handler prunes them, in seconds
 * of chain time. Set with `ENVIO_RETENTION_HOURS` (fractions allowed). The
 * dashboard only reads the most recent transfers, so this is a safety margin,
 * not a history. `TransferSummary` rows are never pruned.
 */
export function retentionSeconds(): number {
  const hours = Number(process.env.ENVIO_RETENTION_HOURS);
  return Math.round(
    (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_RETENTION_HOURS) * 3600,
  );
}

const DEFAULT_PRUNE_INTERVAL_MINUTES = 1;

/**
 * How often expired `Transfer` rows are deleted, in minutes of chain time. Set
 * with `ENVIO_PRUNE_INTERVAL_MINUTES`. The total number of rows deleted is the
 * same whatever the interval (every stored row is deleted once); a longer
 * interval means fewer, larger delete batches.
 */
export function pruneIntervalMinutes(): number {
  const minutes = Number(process.env.ENVIO_PRUNE_INTERVAL_MINUTES);
  return Number.isInteger(minutes) && minutes > 0 ? minutes : DEFAULT_PRUNE_INTERVAL_MINUTES;
}
