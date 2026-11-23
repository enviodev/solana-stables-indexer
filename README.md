# Solana Stablecoin Transfers Indexer

An [Envio HyperIndex](https://docs.envio.dev) indexer for **USDC and USDT transfers on
Solana**, served by [HyperSync](https://docs.envio.dev/docs/HyperSync/overview) rather
than RPC block scanning. It records every successful SPL Token transfer of either
stablecoin and rolls them up into per-minute volume summaries.

It is built to back a live dashboard, so storage is bounded: individual transfers are a
rolling window of a few hours, while the per-minute summaries are kept forever. See
[Retention](#retention).

## How it indexes stablecoin transfers

SPL Token has two transfer instructions, and they need different treatment:

| Instruction | Discriminator | Mint available at | Filtering |
| --- | --- | --- | --- |
| `TransferChecked` | `0x0c` | account slot 1 | Server-side: `where.accounts.mint` narrows HyperSync to USDC/USDT only |
| `Transfer` (legacy) | `0x03` | not in the instruction | Handler-side: the mint is read from the source token account's balance activity |

Both are declared once in `config.yaml` with an inline Borsh schema (no IDL needed):

```yaml
programs:
  - name: SplToken
    program_id: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    instructions:
      - name: TransferChecked
        discriminator: "0x0c"
        args:
          - { name: amount, type: u64 }
          - { name: decimals, type: u8 }
        accounts: [source, mint, destination, authority]
      - name: Transfer
        discriminator: "0x03"
        args:
          - { name: amount, type: u64 }
        accounts: [source, destination, authority]
```

The handlers in `src/handlers/TransferHandler.ts` select only the fields they use and
share one `recordTransfer` path:

```ts
indexer.onInstruction(
  {
    program: "SplToken",
    instruction: "TransferChecked",
    fields,
    where: { accounts: { mint: STABLE_MINT_LIST } }, // USDC + USDT, applied by HyperSync
  },
  async ({ instruction, context }) => {
    if (instruction.transaction.success !== true) return; // belt and braces, see below
    ...
  },
);
```

Design notes:

- **Failed transactions never reach the handler.** HyperSync excludes them at the
  source on envio 3.12.1 (measured: 0 of 60,272 `TransferChecked` instructions in a
  100-slot window). The `success` guard stays as a cheap safety net.
- **Legacy `Transfer` costs more.** It cannot be narrowed by mint on the server, so the
  indexer ingests every SPL `Transfer` on Solana and keeps the stablecoin ones. On the
  2026-09-23 sample window below this was roughly 40% of the recorded transfers, so it is
  worth the cost. Remove that instruction from `config.yaml` and its handler if you only
  need `TransferChecked`.
- **Zero-value transfers are real** and are recorded as such.
- **Ids are `<signature>:<instruction path>`**, which is unique per CPI call.

## Entities

- `Transfer`: one row per stablecoin transfer of $1 or more inside the retention window
  (signature, instruction kind, slot, timestamp, source and destination token accounts,
  mint, symbol, raw and display amount). Indexed on `slot` and `timestamp` only.
- `TransferSummary`: one row per minute (`id` = unix minute) with transfer counts and USD
  volume, total and per symbol. Counts every transfer and is never pruned.

## Retention

Solana produces roughly 10 million USDC/USDT transfers a day, which is about 10 GB a day
if every one is stored and indexed. The `Transfer` table is therefore a rolling window,
not a history:

- **Transfers under $1 are not stored** (`MIN_STORED_USD` in `src/utils/constants.ts`).
  They are about 40% of all transfers. They still count in the `TransferSummary` totals.
- **Rows older than `ENVIO_RETENTION_HOURS` are deleted** (default 6, fractions allowed).
  The handler prunes once per chain minute, when the first transfer of a new minute
  arrives, and each prune removes only the minute that just expired. Nothing extra runs
  on the other transfers, so pruning does not slow down real-time indexing.
  `ENVIO_PRUNE_INTERVAL_MINUTES` (default 1) spaces prunes further apart. Every stored
  row is deleted exactly once whatever the interval, so a longer one does not reduce the
  work; it only makes each delete batch larger. On a 33-minute benchmark window, pruning
  every minute kept the slowest handler batch at 0.4 s against 2.7 s when pruning every
  10 minutes, and neither was measurably slower overall than not pruning.
- **`TransferSummary` is never pruned.** It is one small row per minute.

If you need a full transfer history, set `MIN_STORED_USD` to 0, remove the
`pruneOldTransfers` call in `src/handlers/TransferHandler.ts`, and plan for the storage.

## Prerequisites

- [Node.js 22+](https://nodejs.org/en/download/)
- [pnpm](https://pnpm.io/installation)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local Postgres)
- A HyperSync API token in `.env` (copy `.env.example`)

## Running

```bash
pnpm install
pnpm dev          # codegen + start; open the console at https://envio.dev/console
```

`config.yaml` starts at the chain head (`start_slot: latest`) on first deploy and resumes
from where it stopped after a restart. Override with `ENVIO_START_SLOT` to backfill, and
pin `ENVIO_END_SLOT` for a finite run.

## Testing

```bash
pnpm test
```

The test runs the real handlers over a pinned 100-slot mainnet window through
HyperSync (`ENVIO_API_TOKEN` required) and asserts that only USDC/USDT rows of $1 or more
are written, that both instruction kinds decode, and that the minute summaries count
every transfer. A second test runs a few minutes of chain with an 18-second retention and
asserts that expired transfers are pruned while their summaries survive. It exists because a wrong discriminator or account layout runs green
and writes nothing; only real data proves the config.

Measured on 2026-09-23 with `envio start` against local Postgres, slots 449674151 to
449681519 (about 50 minutes of chain), before the $1 floor and pruning were added:
316,205 transfers (188,172 `TransferChecked`,
128,033 `Transfer`; 268,599 USDC, 47,606 USDT) in about two and a half minutes of wall
clock, then live tailing.
