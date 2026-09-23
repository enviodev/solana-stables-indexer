# Solana Stablecoin Transfers Indexer

An [Envio HyperIndex](https://docs.envio.dev) indexer for **USDC and USDT transfers on
Solana**, served by [HyperSync](https://docs.envio.dev/docs/HyperSync/overview) rather
than RPC block scanning. It records every successful SPL Token transfer of either
stablecoin and rolls them up into per-minute volume summaries.

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
    if (instruction.transaction.success !== true) return; // HyperSync serves failed txs too
    ...
  },
);
```

Design notes:

- **Failed transactions are skipped.** HyperSync serves instructions from failed
  transactions; counting them would inflate volume.
- **Legacy `Transfer` costs more.** It cannot be narrowed by mint on the server, so the
  indexer ingests every SPL `Transfer` on Solana and keeps the stablecoin ones. On the
  2026-09-23 sample window below this was roughly 40% of the recorded transfers, so it is
  worth the cost. Remove that instruction from `config.yaml` and its handler if you only
  need `TransferChecked`.
- **Zero-value transfers are real** and are recorded as such.
- **Ids are `<signature>:<instruction path>`**, which is unique per CPI call.

## Entities

- `Transfer`: one row per stablecoin transfer (signature, instruction kind, slot,
  timestamp, source and destination token accounts, mint, symbol, raw and display amount).
- `TransferSummary`: one row per minute (`id` = unix minute) with transfer counts and USD
  volume, total and per symbol.

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

`config.yaml` starts a few thousand slots behind head by default. Override with
`ENVIO_START_SLOT`, and pin `ENVIO_END_SLOT` for a finite backfill.

## Testing

```bash
pnpm test
```

The test runs the real handlers over a pinned 100-slot mainnet window through
HyperSync (`ENVIO_API_TOKEN` required) and asserts that only USDC/USDT rows are
written, that both instruction kinds decode, and that the minute summaries reconcile
with the transfers. It exists because a wrong discriminator or account layout runs green
and writes nothing; only real data proves the config.

Measured on 2026-09-23 with `envio start` against local Postgres, slots 449674151 to
449681519 (about 50 minutes of chain): 316,205 transfers (188,172 `TransferChecked`,
128,033 `Transfer`; 268,599 USDC, 47,606 USDT) in about two and a half minutes of wall
clock, then live tailing.
