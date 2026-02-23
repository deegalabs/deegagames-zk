# Frontend (deegagames-zk)

Game library UI + Poker ZK: table, cards, betting (Fold/Check/Call/Raise), wallet and contract integration. **Flow:** [GAME_FLOW.md](../GAME_FLOW.md).

## Stack (current and target)

| Layer | Choice | Note |
|-------|--------|------|
| **Framework** | React 19 + TypeScript + Vite 7 | Current; keep compatible with latest stable |
| **Wallet** | [Stellar Wallets Kit](https://stellarwalletskit.dev/) + [Freighter](https://www.freighter.app/) | Stellar-native; required for Soroban. (Rainbow Kit is Ethereum-focused; we use Stellar stack.) |
| **Chain** | @stellar/stellar-sdk, @stellar/freighter-api | Soroban RPC, auth, transactions |
| **ZK** | **Noir** + NoirJS (when circuits ready) | Proof generation for hand_validator and hand_ranker; load artifacts from `public/circuits/` |

**Package manager:** **pnpm** (`pnpm install`, `pnpm dev`). See `package.json`.

## Structure

```
frontend/
├── src/
│   ├── components/       # Layout, WalletStandalone, WalletSwitcher
│   ├── games/poker-zk/  # PokerZkGame.tsx, pokerZkService.ts, bindings.ts
│   ├── hooks/            # useWallet, useWalletStandalone
│   ├── services/         # devWalletService
│   ├── store/            # walletSlice (Zustand)
│   ├── utils/            # ledgerUtils, transactionHelper, constants
│   ├── App.tsx
│   └── config.ts         # Contract IDs (from env)
├── public/
│   └── circuits/         # (optional) hand_validator.json, hand_ranker.json for NoirJS
└── package.json
```

## Run locally

**Contract not deployed yet?** The app will show "Contract Not Configured" until you set `VITE_POKER_ZK_CONTRACT_ID`. You can still run the UI:

```bash
cd frontend
pnpm install
pnpm dev
```

Then open the URL shown (e.g. http://localhost:3000). To use the full flow (create game, Import & Sign or Quickstart, commit/reveal, betting):

1. **Deploy the poker-game-manager to testnet** (from repo root):  
   `./scripts/deploy.sh`  
   Then copy the printed contract ID into `frontend/.env` as `VITE_POKER_ZK_CONTRACT_ID=...`.

2. **Dev wallets for 2 players (Quickstart, Import & Sign):**  
   Run `pnpm run setup` from the frontend directory. This writes `VITE_DEV_PLAYER1_ADDRESS`, `VITE_DEV_PLAYER2_ADDRESS`, and the two `VITE_DEV_*_SECRET` into `frontend/.env` (and root `.env`). Fund both addresses on testnet (Friendbot links are printed). **Restart the dev server** after setup so Vite loads the new env vars. The app uses `envDir: '.'`, so it reads `frontend/.env`.

## Tasks (from GAME_FLOW and CONTRACTS_SPEC)

- [x] **Setup:** React, Vite, TS, Stellar Wallets Kit, Freighter.
- [x] **NoirJS:** dependency added (`@noir-lang/noir_js`); load circuits from `public/circuits/` for proof generation (hand_validator.json, hand_ranker.json).
- [x] **Contract bindings:** generated from poker-game-manager (`./scripts/bindings.sh` or `stellar contract bindings typescript --wasm target/.../poker_game_manager.wasm --output-dir …`). Client exposes create_game, join_game, commit_seed, reveal_seed, post_blinds, act, reveal_hand, claim_timeout, get_game(game_id), get_config.
- [x] **Wire UI to poker contract API:** PokerZkGame and pokerZkService use game_id, create_game, join_game, get_game, commit_seed, reveal_seed, post_blinds, act (Fold/Check/Call/Raise).
- [ ] **Proofs:** hand_validator proof (first action/Raise), hand_ranker proof (showdown); progress UI (~10s).
- [x] **Join/Shuffle, Deal/Blinds, Betting, Showdown, Payout/errors, Timeout** — implemented; Hand Ranks modal, History and Chat panels.

**Reference:** [GAME_FLOW.md](../GAME_FLOW.md), [CONTRACTS_SPEC.md](../CONTRACTS_SPEC.md), [CIRCUITS_SPEC.md](../CIRCUITS_SPEC.md), [SPEC_COMPLETE.md](../SPEC_COMPLETE.md) §4, §8.
