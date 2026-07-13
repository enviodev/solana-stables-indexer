import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";

// Runs the indexer over a pinned slot window against live HyperSync.
// Assert on shape and invariants rather than exact counts.
describe("solana stables indexer", () => {
  it("indexes USDC/USDT TransferChecked instructions in a pinned window", async () => {
    const indexer = createTestIndexer();
    const result = await indexer.process({
      chains: { 0: { startBlock: 420_620_000, endBlock: 420_620_200 } },
    });

    const transfers = result.changes.flatMap((c) => c.Transfer?.sets ?? []);
    expect(transfers.length).toBeGreaterThan(0);

    for (const t of transfers) {
      // account_filters restricts matches to the USDC/USDT mints
      expect(["USDC", "USDT"]).toContain(t.symbol);
      expect(t.amount).toBeGreaterThanOrEqual(0n);
      expect(t.transactionHash).not.toBe("");
      expect(t.slot).toBeGreaterThanOrEqual(420_620_000);
      expect(t.slot).toBeLessThanOrEqual(420_620_200);
    }

    const summaries = result.changes.flatMap(
      (c) => c.TransferSummary?.sets ?? [],
    );
    expect(summaries.length).toBeGreaterThan(0);
    const last = summaries[summaries.length - 1]!;
    expect(last.totalTransfers).toBeGreaterThan(0);
    expect(last.totalVolumeUSD.isGreaterThan(0)).toBe(true);
  }, 120_000);
});
