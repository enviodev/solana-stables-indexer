import { describe, it, expect } from "vitest";
import { createTestIndexer } from "envio";
import { STABLE_MINTS, USDC_MINT, USDT_MINT } from "../src/utils/constants";

const SOLANA = 7565164;

// A pinned 100-slot mainnet window. Live HyperSync data: this proves the
// discriminators, account layout and where-filter decode real instructions,
// which a simulate test cannot do. Needs ENVIO_API_TOKEN.
const START_SLOT = 449_674_151;
const END_SLOT = START_SLOT + 100;

describe("stablecoin transfers over a pinned window", () => {
  it(
    "records only USDC/USDT transfers, from both instruction kinds",
    async () => {
      const indexer = createTestIndexer();
      await indexer.process({
        chains: { [SOLANA]: { startBlock: START_SLOT, endBlock: END_SLOT } },
      });

      const transfers = await indexer.Transfer.getAll();
      expect(transfers.length).toBeGreaterThan(0);

      for (const t of transfers) {
        expect(Object.keys(STABLE_MINTS)).toContain(t.mint);
        expect(t.symbol).toBe(t.mint === USDC_MINT ? "USDC" : "USDT");
        expect(t.slot).toBeGreaterThanOrEqual(START_SLOT);
        expect(t.slot).toBeLessThanOrEqual(END_SLOT);
        expect(t.timestamp.getUTCFullYear()).toBeGreaterThanOrEqual(2026);
        expect(t.amount).toBeGreaterThanOrEqual(0n); // zero-value SPL transfers exist on chain
        expect(t.amountDisplay.toString()).toBe(
          (Number(t.amount) / 1e6).toString(),
        );
      }

      expect(transfers.some((t) => t.amount > 0n)).toBe(true);

      const kinds = new Set(transfers.map((t) => t.instruction));
      expect(kinds.has("TransferChecked")).toBe(true);
      expect(kinds.has("Transfer")).toBe(true);
      expect(transfers.some((t) => t.mint === USDT_MINT)).toBe(true);

      const summaries = await indexer.TransferSummary.getAll();
      const total = summaries.reduce((n, s) => n + s.totalTransfers, 0);
      expect(total).toBe(transfers.length);
      for (const s of summaries) {
        expect(s.usdcTransfers + s.usdtTransfers).toBe(s.totalTransfers);
        expect(s.totalVolumeUSD.toString()).toBe(
          s.usdcVolumeUSD.plus(s.usdtVolumeUSD).toString(),
        );
      }
    },
    120_000,
  );
});
