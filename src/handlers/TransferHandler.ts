import { indexer, BigDecimal, type SvmFieldsSelection } from "envio";
import { STABLE_MINTS, STABLE_MINT_LIST } from "../utils/constants";

// Both handlers select the same payload so they can share `recordTransfer`.
const fields = {
  instruction: ["args", "accounts", "path"],
  transaction: ["signature", "success"],
  accountActivity: ["token.mint", "token.decimals"],
  block: ["time"],
} as const satisfies SvmFieldsSelection;

type StableSymbol = "USDC" | "USDT";

type TransferInput = {
  id: string;
  signature: string;
  instruction: "TransferChecked" | "Transfer";
  slot: number;
  blockTime: number; // unix seconds
  sender: string;
  receiver: string;
  mint: string;
  symbol: StableSymbol;
  amount: bigint;
  decimals: number;
};

// TransferChecked carries the mint as account slot 1, so HyperSync only
// serves USDC/USDT instructions: the filter is applied server-side.
indexer.onInstruction(
  {
    program: "SplToken",
    instruction: "TransferChecked",
    fields,
    where: { accounts: { mint: STABLE_MINT_LIST } },
  },
  async ({ instruction, context }) => {
    if (instruction.transaction.success !== true) return;
    const args = instruction.args;
    if (!args) return; // discriminator matched but the Borsh layout did not
    const mint = instruction.accounts.mint.address;
    const stable = STABLE_MINTS[mint];
    if (!stable) return; // defensive: the where filter should make this unreachable
    await recordTransfer(context, {
      id: transferId(instruction.transaction.signature, instruction.path),
      signature: instruction.transaction.signature,
      instruction: "TransferChecked",
      slot: instruction.block.slot,
      blockTime: instruction.block.time,
      sender: instruction.accounts.source.address,
      receiver: instruction.accounts.destination.address,
      mint,
      symbol: stable.symbol,
      amount: args.amount,
      decimals: args.decimals,
    });
  },
);

// Legacy Transfer has no mint account, so it cannot be narrowed server-side.
// Every SPL Transfer is fetched and the mint is read from the source token
// account's balance activity in the same transaction.
indexer.onInstruction(
  { program: "SplToken", instruction: "Transfer", fields },
  async ({ instruction, context }) => {
    if (instruction.transaction.success !== true) return;
    const args = instruction.args;
    if (!args) return;
    const token = instruction.accounts.source.activity?.token;
    if (!token) return; // no token balance change recorded for the source account
    const stable = STABLE_MINTS[token.mint];
    if (!stable) return; // not a stablecoin transfer
    await recordTransfer(context, {
      id: transferId(instruction.transaction.signature, instruction.path),
      signature: instruction.transaction.signature,
      instruction: "Transfer",
      slot: instruction.block.slot,
      blockTime: instruction.block.time,
      sender: instruction.accounts.source.address,
      receiver: instruction.accounts.destination.address,
      mint: token.mint,
      symbol: stable.symbol,
      amount: args.amount,
      decimals: token.decimals,
    });
  },
);

function transferId(signature: string, path: readonly number[]): string {
  return `${signature}:${path.join(".")}`;
}

type HandlerContext = Parameters<
  Parameters<typeof indexer.onInstruction>[1]
>[0]["context"];

async function recordTransfer(context: HandlerContext, t: TransferInput) {
  const amountDisplay = new BigDecimal(t.amount.toString()).shiftedBy(-t.decimals);
  const timestamp = new Date(t.blockTime * 1000);

  context.Transfer.set({
    id: t.id,
    signature: t.signature,
    instruction: t.instruction,
    slot: t.slot,
    timestamp,
    sender: t.sender,
    receiver: t.receiver,
    mint: t.mint,
    symbol: t.symbol,
    amount: t.amount,
    amountDisplay,
  });

  const minuteIndex = Math.floor(t.blockTime / 60);
  const summaryId = minuteIndex.toString();
  const summary = (await context.TransferSummary.get(summaryId)) ?? {
    id: summaryId,
    minute: new Date(minuteIndex * 60 * 1000),
    totalTransfers: 0,
    totalVolumeUSD: new BigDecimal(0),
    usdcTransfers: 0,
    usdtTransfers: 0,
    usdcVolumeUSD: new BigDecimal(0),
    usdtVolumeUSD: new BigDecimal(0),
  };
  const isUsdc = t.symbol === "USDC";
  context.TransferSummary.set({
    ...summary,
    totalTransfers: summary.totalTransfers + 1,
    totalVolumeUSD: summary.totalVolumeUSD.plus(amountDisplay),
    usdcTransfers: summary.usdcTransfers + (isUsdc ? 1 : 0),
    usdtTransfers: summary.usdtTransfers + (isUsdc ? 0 : 1),
    usdcVolumeUSD: isUsdc ? summary.usdcVolumeUSD.plus(amountDisplay) : summary.usdcVolumeUSD,
    usdtVolumeUSD: isUsdc ? summary.usdtVolumeUSD : summary.usdtVolumeUSD.plus(amountDisplay),
  });
}
