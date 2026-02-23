# Scripts

Build and tooling for this repo. **Deploy and bindings** are done from here: `./scripts/deploy.sh`, `./scripts/bindings.sh`. [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio) is optional reference.

## In this folder

| Script | Purpose |
|--------|---------|
| **build.sh** | Build contracts (Stellar CLI) and circuits (Noir). Run from repo root: `./scripts/build.sh` |
| **deploy.sh** | Build and deploy poker-game-manager to testnet; requires identity `deployer` (or `DEPLOYER_SOURCE`). Then set `VITE_POKER_ZK_CONTRACT_ID` in frontend/.env. |

## Deploy and bindings


From this repo:

- `./scripts/deploy.sh` — build + deploy poker-game-manager to testnet; set `VITE_POKER_ZK_CONTRACT_ID` in frontend/.env.
- `./scripts/bindings.sh` — generate TS bindings; copy output to `frontend/src/games/poker-zk/bindings.ts`.

**Reference:** [CONTRACTS_SPEC](../CONTRACTS_SPEC.md), [CIRCUITS_SPEC](../CIRCUITS_SPEC.md).
