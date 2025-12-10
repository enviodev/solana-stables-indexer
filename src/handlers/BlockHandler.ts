/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import { onBlock } from "generated";
import { createEffect, S } from "envio";
import { processInstruction } from "../utils/helpers";
import { nullableBlockSchema, getBlockDataSchema } from "../utils/blockSchema";

const getBlockEffect = createEffect(
  {
    name: "getBlock",
    input: { slot: S.number },
    output: nullableBlockSchema,
    rateLimit: { calls: 10, per: "second" },
  },
  async ({ input, context }) => {
    const res = await fetch(process.env.ENVIO_MAINNET_RPC_URL!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBlock",
        params: [
          input.slot,
          {
            maxSupportedTransactionVersion: 0,
            transactionDetails: "full",
            encoding: "jsonParsed",
            rewards: false,
          },
        ],
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch (error) {
      context.log.warn(`Failed to parse block data`);
      return undefined;
    }
    const parsedData = S.parseOrThrow(data, getBlockDataSchema);
    if (parsedData.error) {
      throw new Error(parsedData.error);
    }
    return parsedData.result;
  }
);

onBlock({ chain: 0, name: "BlockTracker" }, async ({ slot, context }) => {
  const block = await context.effect(getBlockEffect, { slot });
  if (!block) {
    context.log.info(`Slot without a block`, { slot });
    return;
  }
  context.BlockInfo.set({
    id: slot.toString(),
    hash: block.blockhash,
    height: block.blockHeight,
    time: block.blockTime ? new Date(block.blockTime * 1000) : undefined,
  });

  const successfulTransactions = block.transactions?.filter((tx) => {
    return tx.meta && !tx.meta.err;
  }) || [];

  for (const tx of successfulTransactions) {
    if (!tx.meta) continue;

    // Process top-level instructions
    tx.transaction.message.instructions.forEach((inst, index) => {
      const transfer = processInstruction(
        inst as any,
        tx.meta?.preTokenBalances as any,
        tx.meta?.postTokenBalances as any
      );

      if (transfer) {
        context.Transfer.set({
          id: `${tx.transaction.signatures[0]}-top-${index}`,
          transactionHash: tx.transaction.signatures[0] || "",
          slot: slot,
          timestamp: block.blockTime ? new Date(block.blockTime * 1000) : new Date(0),
          sender: transfer.sender,
          receiver: transfer.receiver,
          mint: transfer.mint,
          symbol: transfer.symbol,
          amount: transfer.amount,
          amountDisplay: transfer.amountDisplay,
        });
      }
    });

    // Process inner instructions
    if (tx.meta.innerInstructions) {
      tx.meta.innerInstructions.forEach((inner) => {
        inner.instructions.forEach((inst, innerIndex) => {
          const transfer = processInstruction(
            inst as any,
            tx.meta?.preTokenBalances as any,
            tx.meta?.postTokenBalances as any
          );

          if (transfer) {
            context.Transfer.set({
              id: `${tx.transaction.signatures[0]}-inner-${inner.index}-${innerIndex}`,
              transactionHash: tx.transaction.signatures[0] || "",
              slot: slot,
              timestamp: block.blockTime
                ? new Date(block.blockTime * 1000)
                : new Date(0),
              sender: transfer.sender,
              receiver: transfer.receiver,
              mint: transfer.mint,
              symbol: transfer.symbol,
              amount: transfer.amount,
              amountDisplay: transfer.amountDisplay,
            });
          }
        });
      });
    }
  }

  context.log.info(
    `Block processed. Total transactions: ${block.transactions?.length || 0}. Successful: ${successfulTransactions.length}`
  );
});
