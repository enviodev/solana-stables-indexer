import { S } from "envio";

export const tokenBalanceSchema = S.schema({
  accountIndex: S.number,
  mint: S.string,
  owner: S.optional(S.string),
  programId: S.optional(S.string),
  uiTokenAmount: S.schema({
    amount: S.string,
    decimals: S.number,
    uiAmount: S.nullable(S.number),
    uiAmountString: S.optional(S.string),
  }),
});

const infoSchema = S.object((s) => ({
  destination: s.field("destination", S.optional(S.string)),
  source: s.field("source", S.optional(S.string)),
  amount: s.field("amount", S.optional(S.string)),
  lamports: s.field("lamports", S.optional(S.number)),
  mint: s.field("mint", S.optional(S.string)),
  authority: s.field("authority", S.optional(S.string)),
  decimals: s.field("decimals", S.optional(S.number)),
  owner: s.field("owner", S.optional(S.string)),
  account: s.field("account", S.optional(S.string)),
  newAccount: s.field("newAccount", S.optional(S.string)),
  space: s.field("space", S.optional(S.number)),
  extensionTypes: s.field("extensionTypes", S.optional(S.array(S.string))),
  tokenAmount: s.field(
    "tokenAmount",
    S.optional(
      S.object((t) => ({
        amount: t.field("amount", S.string),
        decimals: t.field("decimals", S.number),
        uiAmountString: t.field("uiAmountString", S.string),
      }))
    )
  ),
}));

const parsedObjectSchema = S.object((s) => ({
  type: s.field("type", S.string),
  info: s.field("info", infoSchema),
}));

export const instructionParsedSchema = S.schema({
  program: S.optional(S.string),
  // Some RPC providers return inner instructions with `programIdIndex` only.
  // Accept both forms; resolve `programIdIndex` -> pubkey at runtime via message.accountKeys.
  programId: S.optional(S.string),
  programIdIndex: S.optional(S.number),
  parsed: S.optional(S.union([parsedObjectSchema, S.string])),
  stackHeight: S.optional(S.nullable(S.number)),
  // `accounts` may be strings (pubkeys) or numeric indices, depending on RPC/encoding.
  accounts: S.optional(S.array(S.union([S.string, S.number]))),
  data: S.optional(S.string),
});

const innerInstructionSchema = S.schema({
  index: S.number,
  instructions: S.array(instructionParsedSchema),
});

const rewardSchema = S.schema({
  pubkey: S.string,
  lamports: S.number,
  postBalance: S.number,
  rewardType: S.optional(S.string),
  commission: S.optional(S.number),
});

const transactionMetaSchema = S.schema({
  err: S.nullable(S.union([S.string, S.object((_) => ({}))])),
  // fee: S.number,
  innerInstructions: S.nullable(S.array(innerInstructionSchema)),
  // logMessages: S.nullable(S.array(S.string)),
  // postBalances: S.array(S.number),
  postTokenBalances: S.optional(S.array(tokenBalanceSchema)),
  // preBalances: S.array(S.number),
  preTokenBalances: S.optional(S.array(tokenBalanceSchema)),
  // rewards: S.nullable(S.array(rewardSchema)),
  /*
  loadedAddresses: S.optional(
    S.schema({
      writable: S.array(S.string),
      readonly: S.array(S.string),
    })
  ),
  returnData: S.optional(
    S.schema({
      programId: S.string,
      data: S.array(S.string),
    })
  ),
  computeUnitsConsumed: S.optional(S.number),
  */
  version: S.optional(S.union([S.string, S.number])),
});

const transactionDataSchema = S.schema({
  message: S.schema({
    accountKeys: S.optional(
      S.array(
        S.union([
          S.string,
          S.schema({
            pubkey: S.string,
            signer: S.optional(S.boolean),
            writable: S.optional(S.boolean),
            source: S.optional(S.string),
          }),
        ])
      )
    ),
    instructions: S.array(instructionParsedSchema),
  }),
  signatures: S.array(S.string),
});

export const blockSchema = S.schema({
  blockhash: S.string,
  blockTime: S.nullable(S.number),
  blockHeight: S.nullable(S.number),
  transactions: S.optional(
    S.array(
      S.schema({
        meta: S.nullable(transactionMetaSchema),
        transaction: transactionDataSchema,
      })
    )
  ),
});

export const nullableBlockSchema = S.nullable(blockSchema);

export const getBlockDataSchema = S.schema({
  result: S.optional(nullableBlockSchema),
  error: S.optional(S.object((ctx) => ctx.field("message", S.string))),
});

