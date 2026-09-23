export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** Mints this indexer treats as USD stablecoins, keyed by mint address. */
export const STABLE_MINTS: Record<string, { symbol: "USDC" | "USDT"; decimals: number }> = {
  [USDC_MINT]: { symbol: "USDC", decimals: 6 },
  [USDT_MINT]: { symbol: "USDT", decimals: 6 },
};

export const STABLE_MINT_LIST = Object.keys(STABLE_MINTS);
