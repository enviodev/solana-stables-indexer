import { BigDecimal } from "generated";
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

interface ProcessedTransfer {
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
  if (!inst.parsed || typeof inst.parsed === "string") return undefined;

  const type = inst.parsed.type;
  const info = inst.parsed.info;

  let mint: string | undefined;
  let amount: bigint | undefined;
  let amountDisplay: number | undefined;
  let sender: string | undefined;
  let receiver: string | undefined;

  // Handle TransferChecked (Explicit Mint)
  if (type === "transferChecked") {
    mint = info.mint;
    sender = info.source;
    receiver = info.destination;
    if (info.tokenAmount) {
      amount = BigInt(info.tokenAmount.amount);
      amountDisplay =
        Number(info.tokenAmount.amount) / Math.pow(10, info.tokenAmount.decimals);
    }
  }
  // Handle Transfer (Implicit Mint - Requires Lookup)
  else if (type === "transfer") {
    sender = info.source;
    receiver = info.destination;
    if (info.amount) {
      amount = BigInt(info.amount);
    }

    // Try to find mint from pre/post token balances
    if (sender) {
      const balance =
        preTokenBalances?.find((b) => b.owner === sender) ||
        postTokenBalances?.find((b) => b.owner === sender);

      if (balance) {
        mint = balance.mint;
        // Calculate UI amount if we only have raw amount
        if (amount && balance.uiTokenAmount.decimals) {
          amountDisplay =
            Number(amount) / Math.pow(10, balance.uiTokenAmount.decimals);
        }
      }
    }
  }

  // Filter
  if (
    mint &&
    ACCEPTED_MINTS.includes(mint) &&
    amount !== undefined &&
    sender &&
    receiver
  ) {
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

