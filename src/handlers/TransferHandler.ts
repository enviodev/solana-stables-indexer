import { indexer, BigDecimal } from "envio";
import { MINT_MAP } from "../utils/constants";

const SUMMARY_ID = "LATEST_SUMMARY";

async function updateSummary(
  context: any,
  blockTime: number | undefined,
  symbol: string,
  amountDisplay: BigDecimal,
) {
  const timestamp = blockTime ? blockTime * 1000 : 0;
  const minuteIso = new Date(timestamp).toISOString();

  let summary = await context.TransferSummary.get(SUMMARY_ID);

  if (!summary) {
    summary = {
      id: SUMMARY_ID,
      minute: minuteIso,
      totalTransfers: 0,
      totalVolumeUSD: new BigDecimal(0),
      usdcTransfers: 0,
      usdtTransfers: 0,
      usdcVolumeUSD: new BigDecimal(0),
      usdtVolumeUSD: new BigDecimal(0),
    };
  } else {
    const currentMinute = new Date(timestamp);
    currentMinute.setSeconds(0, 0);
    const storedMinute = new Date(summary.minute);
    storedMinute.setSeconds(0, 0);

    if (currentMinute.getTime() > storedMinute.getTime()) {
      summary = {
        ...summary,
        minute: minuteIso,
        totalTransfers: 0,
        totalVolumeUSD: new BigDecimal(0),
        usdcTransfers: 0,
        usdtTransfers: 0,
        usdcVolumeUSD: new BigDecimal(0),
        usdtVolumeUSD: new BigDecimal(0),
      };
    }
  }

  summary = {
    ...summary,
    minute: minuteIso,
    totalTransfers: summary.totalTransfers + 1,
    totalVolumeUSD: summary.totalVolumeUSD.plus(amountDisplay),
    usdcTransfers: symbol === "USDC" ? summary.usdcTransfers + 1 : summary.usdcTransfers,
    usdtTransfers: symbol === "USDT" ? summary.usdtTransfers + 1 : summary.usdtTransfers,
    usdcVolumeUSD: symbol === "USDC" ? summary.usdcVolumeUSD.plus(amountDisplay) : summary.usdcVolumeUSD,
    usdtVolumeUSD: symbol === "USDT" ? summary.usdtVolumeUSD.plus(amountDisplay) : summary.usdtVolumeUSD,
  };

  context.TransferSummary.set(summary);
}

// TransferChecked: accounts = [source, mint, destination, authority]
// Discriminator 0x0c, args = amount(u64) + decimals(u8), Borsh-decoded via
// the inline schema in config.yaml. Mint filter applied at config level via
// account_filters position 1.
indexer.onInstruction(
  { program: "SplToken", instruction: "TransferChecked" },
  async ({ instruction, context }) => {
    // HyperSync serves instructions from failed transactions too; skip them
    if (instruction.transaction.success !== true) return;

    const params = instruction.params;
    if (!params) return; // discriminator matched but Borsh decode failed

    const { source, mint, destination } = params.accounts;
    const symbol = MINT_MAP[mint] || "UNKNOWN";

    const amount = BigInt(params.args.amount);
    const amountDisplay = new BigDecimal(params.args.amount).shiftedBy(
      -params.args.decimals,
    );

    const txHash = instruction.transaction.signatures[0] ?? "";
    const instrAddr = instruction.instructionAddress.join("-");
    const blockTime = instruction.block.time;

    context.Transfer.set({
      id: `${txHash}-${instrAddr}`,
      transactionHash: txHash,
      slot: instruction.block.slot,
      timestamp: blockTime ? new Date(blockTime * 1000) : new Date(0),
      sender: source,
      receiver: destination,
      mint,
      symbol,
      amount,
      amountDisplay,
    });

    await updateSummary(context, blockTime, symbol, amountDisplay);
  },
);

// Legacy Transfer (discriminator 0x03, accounts = [source, destination, authority])
// carries no mint account, so resolving USDC/USDT requires token balances
// (field_selection.token_balance_fields). Most modern USDC/USDT transfers use
// TransferChecked, so we skip legacy transfers for now.

// Prune old entities every 1500 slots
indexer.onSlot(
  {
    name: "PruneEntities",
    where: () => ({ slot: { _every: 1500 } }),
  },
  async ({ slot, context }) => {
    const cutoffSlot = slot - 1500;
    const toDelete = await context.Transfer.getWhere({ slot: { _lt: cutoffSlot } });
    for (const transfer of toDelete) {
      context.Transfer.deleteUnsafe(transfer.id);
    }
  },
);
