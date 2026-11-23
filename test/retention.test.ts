import { describe, it, expect } from "vitest";

// Must be set before the handlers load: 18 seconds of retention, so a window of
// a few minutes is enough to see rows expire.
const RETENTION_SECONDS = 18;
process.env.ENVIO_RETENTION_HOURS = String(RETENTION_SECONDS / 3600);
process.env.ENVIO_PRUNE_INTERVAL_MINUTES = "1";

const { createTestIndexer } = await import("envio");

const SOLANA = 7565164;

// About three minutes of mainnet, so several minute boundaries are crossed and
// the prune runs more than once. Live HyperSync data; needs ENVIO_API_TOKEN.
const START_SLOT = 449_674_151;
const END_SLOT = START_SLOT + 400;

describe("transfer retention", () => {
  it(
    "prunes transfers older than the retention window and keeps every summary",
    async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: { [SOLANA]: { startBlock: START_SLOT, endBlock: END_SLOT } },
      });

      const transfers = await indexer.Transfer.getAll();
      const summaries = await indexer.TransferSummary.getAll();
      expect(transfers.length).toBeGreaterThan(0);
      expect(summaries.length).toBeGreaterThanOrEqual(3);

      // The prune runs at each minute rollover, so the last one ran at the
      // start of the newest minute.
      const minutes = summaries.map((s) => s.minute.getTime()).sort((a, b) => a - b);
      const lastMinuteStart = minutes[minutes.length - 1]!;
      const cutoff = lastMinuteStart - RETENTION_SECONDS * 1000;

      const oldest = Math.min(...transfers.map((t) => t.timestamp.getTime()));
      expect(oldest).toBeGreaterThanOrEqual(cutoff);

      // Summaries for the pruned minutes survive with their totals intact.
      const prunedMinutes = summaries.filter((s) => s.minute.getTime() + 60_000 <= cutoff);
      expect(prunedMinutes.length).toBeGreaterThan(0);
      for (const s of prunedMinutes) expect(s.totalTransfers).toBeGreaterThan(0);

      const total = summaries.reduce((n, s) => n + s.totalTransfers, 0);
      expect(total).toBeGreaterThan(transfers.length * 2);
    },
    300_000,
  );
});
