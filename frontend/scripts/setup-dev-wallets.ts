/**
 * Generates two Stellar keypairs and writes them to frontend/.env and root .env
 * so the frontend (Vite) sees VITE_DEV_* and simulations/Quickstart work.
 * Run: cd frontend && bun run setup
 */
import { Keypair } from '@stellar/stellar-base';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const vars: Record<string, string> = {};
const cwd = process.cwd();
const rootEnvPath = resolve(cwd, '../.env');
const frontendEnvPath = resolve(cwd, '.env');

function writeEnvTo(path: string, envContent: string) {
  const lines = envContent.split('\n').filter((line) => {
    const key = line.split('=')[0]?.trim();
    return !Object.keys(vars).includes(key);
  });
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const newLines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  const out = [...lines, '', '# Dev wallets (bun run setup)', ...newLines].join('\n') + '\n';
  writeFileSync(path, out);
}

function main() {
  const kp1 = Keypair.random();
  const kp2 = Keypair.random();
  vars.VITE_DEV_PLAYER1_ADDRESS = kp1.publicKey();
  vars.VITE_DEV_PLAYER2_ADDRESS = kp2.publicKey();
  vars.VITE_DEV_PLAYER1_SECRET = kp1.secret();
  vars.VITE_DEV_PLAYER2_SECRET = kp2.secret();

  const p1Address = vars.VITE_DEV_PLAYER1_ADDRESS;
  const p2Address = vars.VITE_DEV_PLAYER2_ADDRESS;

  writeEnvTo(frontendEnvPath, existsSync(frontendEnvPath) ? readFileSync(frontendEnvPath, 'utf-8') : '');
  console.log('Written to', frontendEnvPath);

  const rootContent = existsSync(rootEnvPath) ? readFileSync(rootEnvPath, 'utf-8') : '';
  writeEnvTo(rootEnvPath, rootContent);
  console.log('Written to', rootEnvPath);

  console.log('Player 1:', p1Address);
  console.log('Player 2:', p2Address);
  console.log('');
  console.log('Next: restart the dev server (bun run dev). Fund both addresses on testnet if needed:');
  console.log('  P1:', `https://friendbot.stellar.org/?addr=${p1Address}`);
  console.log('  P2:', `https://friendbot.stellar.org/?addr=${p2Address}`);
}

main();
