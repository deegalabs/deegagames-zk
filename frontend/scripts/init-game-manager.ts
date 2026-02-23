/**
 * Initialize the poker-game-manager contract with admin + GameConfig.
 * Required after deploy so that sit_at_table / create_game work (ConfigNotSet is cleared).
 *
 * Usage (from poker-zk-stellar root):
 *   DEPLOYER_SECRET="S..." bun run frontend/scripts/init-game-manager.ts
 * Or from frontend:
 *   DEPLOYER_SECRET="S..." bun run scripts/init-game-manager.ts
 *
 * Get deployer secret: stellar keys export deployer  (if you used "deployer" identity)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Keypair, TransactionBuilder, hash } from '@stellar/stellar-base';
import type { Option } from '@stellar/stellar-sdk/contract';
import { Client as PokerZkClient, type GameConfig } from '../src/games/poker-zk/bindings';
import { Buffer } from 'buffer';

declare const global: typeof globalThis & { Buffer?: typeof Buffer };
if (typeof global.Buffer === 'undefined') global.Buffer = Buffer;

const NETWORK_PASSPHRASE = process.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const RPC_URL = process.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

function loadEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      for (const line of content.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (m && !process.env[m[1]]) {
          const val = m[2].replace(/^["']|["']$/g, '').trim();
          process.env[m[1]] = val;
        }
      }
      break;
    }
  }
}

loadEnv();

const contractId = process.env.VITE_POKER_ZK_CONTRACT_ID;
const gameHubId = process.env.VITE_GAME_HUB_CONTRACT_ID; // optional; if set, use deployed hub instead of admin
const deployerSecret = process.env.DEPLOYER_SECRET;

if (!contractId || contractId === 'YOUR_CONTRACT_ID') {
  console.error('Missing VITE_POKER_ZK_CONTRACT_ID in .env. Run deploy first.');
  process.exit(1);
}
if (!deployerSecret) {
  console.error('Missing DEPLOYER_SECRET. Set it in .env or: DEPLOYER_SECRET="S..." bun run ...');
  process.exit(1);
}

const keypair = Keypair.fromSecret(deployerSecret);
const adminAddress = keypair.publicKey();

// Match deploy.sh: small_blind 50, big_blind 100, min_buy_in 10M, max_buy_in 50M (1-5 XLM)
const config: GameConfig = {
  min_buy_in: BigInt(10_000_000),
  max_buy_in: BigInt(50_000_000),
  small_blind: BigInt(50),
  big_blind: BigInt(100),
  rake_percentage: 0,
  reveal_timeout: BigInt(300),
  bet_timeout: BigInt(120),
  waiting_timeout: BigInt(300),
  treasury: adminAddress,
  game_hub: (gameHubId && gameHubId.length > 0) ? gameHubId : adminAddress,
  payment_controller: undefined as Option<string>,
  proof_verifier: undefined as Option<string>,
};

const signer = {
  signTransaction: async (txXdr: string, opts?: { networkPassphrase?: string }) => {
    const passphrase = opts?.networkPassphrase ?? NETWORK_PASSPHRASE;
    const tx = TransactionBuilder.fromXDR(txXdr, passphrase);
    tx.sign(keypair);
    return { signedTxXdr: tx.toXDR(), signerAddress: adminAddress };
  },
  signAuthEntry: async (preimageXdr: string) => {
    const preimageBytes = Buffer.from(preimageXdr, 'base64');
    const payload = hash(preimageBytes);
    const signatureBytes = keypair.sign(payload);
    return {
      signedAuthEntry: Buffer.from(signatureBytes).toString('base64'),
      signerAddress: adminAddress,
    };
  },
};

async function main() {
  const client = new PokerZkClient({
    contractId: contractId!,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: adminAddress,
    ...signer,
  });

  console.log('Contract:', contractId);
  console.log('Admin:', adminAddress);
  console.log('Calling initialize(admin, config)...');

  const tx = await client.initialize({ admin: adminAddress, config });
  const simulated = await tx.simulate();
  await simulated.signAndSend();
  console.log('Done. initialize(admin, config) was sent. Recarrega o frontend e tenta "Sentar" de novo.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
