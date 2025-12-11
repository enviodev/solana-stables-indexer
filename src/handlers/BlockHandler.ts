/*
 * Please refer to https://docs.envio.dev for a thorough guide on all Envio indexer features
 */
import { onBlock, type TransferSummary, BigDecimal } from "generated";
import { createEffect, S } from "envio";
import { processInstruction, type ProcessedTransfer } from "../utils/helpers";
import { nullableBlockSchema, getBlockDataSchema } from "../utils/blockSchema";

const getBlockEffect = createEffect(
  {
    name: "getBlock",
    input: { slot: S.number },
    output: nullableBlockSchema,
    rateLimit: { calls: 100, per: "second" },
  },
  async ({ input, context }) => {
    const usePrimaryURL = input.slot % 2 ===0
    const res = await fetch(usePrimaryURL ? process.env.ENVIO_MAINNET_RPC_URL! : process.env.ENVIO_MAINNET_RPC_URL_2!, {
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

  // Track transfers found in this block to aggregate for summary
  const blockTransfers: ProcessedTransfer[] = [];

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
        blockTransfers.push(transfer);
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
            blockTransfers.push(transfer);
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

  // Update Minute Summary if there are transfers
  if (blockTransfers.length > 0 && block.blockTime) {
    // Use a fixed ID for singleton summary
    const SUMMARY_ID = "LATEST_SUMMARY";
    const timestamp = block.blockTime * 1000;
    const date = new Date(timestamp);
    const minuteIso = date.toISOString(); // Current minute timestamp for display

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
      // If we are reusing the same entity, we might want to reset counters if the minute has changed?
      // Or if this is truly a "rolling" summary of the "current" minute?
      // If it's a singleton for the "latest minute", we need to detect if the minute changed.
      
      // Let's assume we want to reset if the stored minute is different from current block minute
      const currentMinute = new Date(timestamp);
      currentMinute.setSeconds(0, 0);
      
      const storedMinute = new Date(summary.minute);
      storedMinute.setSeconds(0, 0);
      
      if (currentMinute.getTime() > storedMinute.getTime()) {
        // New minute started, reset counters
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
      } else {
         // Same minute, update timestamp to latest (so UI knows it's fresh)
         summary = {
           ...summary,
           minute: minuteIso
         };
      }
    }

    // Aggregate values
    for (const t of blockTransfers) {
      summary = {
        ...summary,
        totalTransfers: summary.totalTransfers + 1,
        totalVolumeUSD: summary.totalVolumeUSD.plus(t.amountDisplay),
        usdcTransfers:
          t.symbol === "USDC" ? summary.usdcTransfers + 1 : summary.usdcTransfers,
        usdtTransfers:
          t.symbol === "USDT" ? summary.usdtTransfers + 1 : summary.usdtTransfers,
        usdcVolumeUSD:
          t.symbol === "USDC"
            ? summary.usdcVolumeUSD.plus(t.amountDisplay)
            : summary.usdcVolumeUSD,
        usdtVolumeUSD:
          t.symbol === "USDT"
            ? summary.usdtVolumeUSD.plus(t.amountDisplay)
            : summary.usdtVolumeUSD,
      };
    }

    context.TransferSummary.set(summary);
  }

  context.log.info(
    `Block processed. Total transactions: ${block.transactions?.length || 0}. Successful: ${successfulTransactions.length}`
  );
});

onBlock(
  {
    name: "PruneEntities",
    chain: 0,
    interval: 1500, 
  },
  async ({ slot, context }) => {
    const PRUNE_THRESHOLD = 1500;
    const cutoffSlot = slot - PRUNE_THRESHOLD;

    const toDelete = await context.Transfer.getWhere.slot.lt(cutoffSlot)

    for (const transfer of toDelete) {
      context.Transfer.deleteUnsafe(transfer.id);
    }

    const oldBlocks = await context.BlockInfo.getWhere.height.lt(cutoffSlot);

    for (const block of oldBlocks) {
      context.BlockInfo.deleteUnsafe(block.id);
    }
  }
);
