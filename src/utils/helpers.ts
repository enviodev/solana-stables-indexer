import { BigDecimal } from "envio";
import { ACCEPTED_MINTS, MINT_MAP } from "./constants";

// Helper interfaces to avoid circular dependency on full schema if possible,
// or just use relaxed types for the helper input.
interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string | null; // S.optional(S.string) can be string | undefined, but S.nullable is T | null
  uiTokenAmount: {
    decimals: number;
  };
}

interface ParsedInfo {
  mint?: string;
  source?: string;
  destination?: string;
  amount?: string;
  tokenAmount?: {
    amount: string;
    decimals: number;
    uiAmount?: number;
  };
}

export interface ProcessedTransfer {
  mint: string;
  symbol: string;
  amount: bigint;
  amountDisplay: BigDecimal;
  sender: string;
  receiver: string;
}

/**
 * Extracts a transfer event from a single instruction if it matches criteria.
 */
export function processInstruction(
  inst: { parsed?: { type: string; info: ParsedInfo } | string },
  preTokenBalances: TokenBalance[] | undefined,
  postTokenBalances: TokenBalance[] | undefined
): ProcessedTransfer | undefined {
  // 1. Fast fail on basic structure
  if (!inst.parsed || typeof inst.parsed === "string") return undefined;

  const type = inst.parsed.type;
  // 2. Fast fail on instruction type
  if (type !== "transfer" && type !== "transferChecked") return undefined;

  const info = inst.parsed.info;
  let mint: string | undefined;

  // 3. Resolve Mint & Fail Fast
  if (type === "transferChecked") {
    mint = info.mint;
    // Immediate check for TransferChecked
    if (!mint || !ACCEPTED_MINTS.includes(mint)) return undefined;
  } else if (type === "transfer") {
    // For implicit transfer, we must look it up.
    // Optimization: Check sender existence first
    const sender = info.source;
    if (!sender) return undefined;

    const balance =
      preTokenBalances?.find((b) => b.owner === sender) ||
      postTokenBalances?.find((b) => b.owner === sender);

    if (balance) {
      mint = balance.mint;
    }
    // Immediate check after lookup
    if (!mint || !ACCEPTED_MINTS.includes(mint)) return undefined;
  }

  // 4. Extract remaining data (only if mint is accepted)
  let amount: bigint | undefined;
  let amountDisplay: number | undefined;
  const sender = info.source;
  const receiver = info.destination;

  if (type === "transferChecked") {
    if (info.tokenAmount) {
      amount = BigInt(info.tokenAmount.amount);
      amountDisplay =
        Number(info.tokenAmount.amount) / Math.pow(10, info.tokenAmount.decimals);
    }
  } else {
    // legacy transfer
    if (info.amount) {
      amount = BigInt(info.amount);
      // We need decimals from the balance lookup we did earlier
      // Re-finding balance is cheap since we know it exists, or we could pass it down
      // But for cleaner code structure locally, re-find or optimization:
      // The logic above ensures 'mint' is found via balance.
      // Let's assume we can get decimals from the same place.
      const balance =
        preTokenBalances?.find((b) => b.owner === sender) ||
        postTokenBalances?.find((b) => b.owner === sender);

      if (balance && amount) {
        amountDisplay =
          Number(amount) / Math.pow(10, balance.uiTokenAmount.decimals);
      }
    }
  }

  // Final validation
  if (amount !== undefined && sender && receiver && mint) {
    return {
      mint,
      symbol: MINT_MAP[mint] || "UNKNOWN",
      amount,
      amountDisplay: new BigDecimal(amountDisplay || 0),
      sender,
      receiver,
    };
  }

  return undefined;
}

