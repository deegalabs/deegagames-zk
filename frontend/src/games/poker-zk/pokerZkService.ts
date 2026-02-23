import {
  Client as PokerZkClient,
  type Game,
  type Table,
  type WaitingSession,
  Action,
  GameState,
  Errors as ContractErrors,
} from './bindings';
import {
  NETWORK_PASSPHRASE,
  RPC_URL,
  DEFAULT_METHOD_OPTIONS,
  DEFAULT_AUTH_TTL_MINUTES,
  MULTI_SIG_AUTH_TTL_MINUTES,
} from '@/utils/constants';
import type { contract } from './bindings';
import { Buffer } from 'buffer';
import { signAndSendViaLaunchtube } from '@/utils/transactionHelper';
import { calculateValidUntilLedger } from '@/utils/ledgerUtils';
import { injectSignedAuthEntry, getCredentialTypeAndAddress, getAddressFromAuthEntryCredentials } from '@/utils/authEntryUtils';
import { rpc } from '@stellar/stellar-sdk';
import { scValToNative } from '@stellar/stellar-base';
import { Address, authorizeEntry, xdr } from '@stellar/stellar-sdk';

type ClientOptions = contract.ClientOptions;

const LOG = '[PokerZK]';
const bufLabel = (b: Buffer | Uint8Array | null | undefined): string =>
  b == null ? 'null' : `${(b as Buffer).length ?? 0} bytes`;

/** LCG constant (same as contract). */
const LCG_MUL = 6364136223846793005n;

/**
 * Derive shuffled deck (1–52) from 32-byte seed. Same algorithm as contract derive_board_cards (Fisher-Yates + LCG).
 * Used only to show the current user's hole cards; never pass the opponent's cards to the UI.
 */
export function deriveDeckFromSeed(seed: Buffer | Uint8Array): number[] {
  const arr = seed.length >= 32 ? seed : Buffer.from(seed);
  const deck = Array.from({ length: 52 }, (_, i) => i + 1);
  let rngState = 0n;
  if (arr.byteLength >= 8) {
    const u = new Uint8Array(arr);
    const view = new DataView(u.buffer, u.byteOffset, 8);
    rngState = view.getBigUint64(0, false);
  }
  for (let i = 51; i >= 1; i--) {
    rngState = (rngState * LCG_MUL + 1n) & 0xFFFFFFFFFFFFFFFFn;
    const j = Number(rngState % BigInt(i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Segurança: devolve apenas as hole cards do utilizador atual (userAddress).
 * Nunca devolve nem expõe as cartas do outro jogador — regra de UI e de privacidade.
 */
export function getMyHoleCardsFromGame(game: Game | null, userAddress: string): [number, number] | null {
  if (!game || !userAddress) return null;
  const seed = game.final_seed;
  let buf: Buffer | Uint8Array | null = null;
  if (seed != null) {
    const s = seed as unknown;
    if (typeof (s as { value?: unknown }).value !== 'undefined') buf = Buffer.from((s as { value: Buffer | Uint8Array }).value);
    else if (typeof (s as Buffer).length === 'number' && (s as Buffer).length >= 32) buf = Buffer.from(s as Buffer);
  }
  if (!buf || buf.length < 32) return null;
  const deck = deriveDeckFromSeed(buf);
  const isP1 = String((game as Game).player1 ?? '').trim() === String(userAddress).trim();
  const isP2 = game.player2 != null && String(game.player2).trim() === String(userAddress).trim();
  if (isP1) return [deck[0], deck[1]];
  if (isP2) return [deck[2], deck[3]];
  return null;
}

/** Generate a random session ID (u64 range, 0 to 2^32-1 for simplicity). Use as bigint for contract. */
export function createRandomSessionId(): bigint {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  }
  const view = new DataView(bytes.buffer);
  return BigInt(view.getUint32(0, true));
}

/**
 * Service for the Poker ZK contract (poker-game-manager).
 * Flow: create_game -> join_game -> commit_seed (both) -> reveal_seed (both) -> post_blinds -> act (betting) -> reveal_hand (showdown).
 */
export class PokerZkService {
  private baseClient: PokerZkClient;
  private contractId: string;

  constructor(contractId: string) {
    this.contractId = contractId;
    this.baseClient = new PokerZkClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
    });
  }

  private createSigningClient(
    publicKey: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): PokerZkClient {
    return new PokerZkClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey,
      ...signer,
    });
  }

  /** Get contract config (e.g. waiting_timeout). Returns null if not set. */
  async getConfig(): Promise<{ waiting_timeout: bigint } | null> {
    try {
      const tx = await this.baseClient.get_config();
      const result = await tx.simulate();
      if (result.result?.isOk?.()) {
        const c = result.result.unwrap();
        return { waiting_timeout: BigInt(String(c.waiting_timeout)) };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Normalize contract state to number (SDK may return number, string, or enum object). */
  static normalizeState(raw: unknown): number | undefined {
    if (raw == null) return undefined;
    if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      if (!Number.isNaN(n)) return n;
      const idx = (GameState as Record<string, number>)[raw];
      if (typeof idx === 'number') return idx;
      return undefined;
    }
    const obj = raw as { value?: number; name?: string };
    if (typeof obj?.value === 'number') return obj.value;
    if (typeof obj?.name === 'string' && typeof (GameState as Record<string, number>)[obj.name] === 'number') {
      return (GameState as Record<string, number>)[obj.name];
    }
    return undefined;
  }

  /** Get game by id. Returns null if not found. Normalizes state to number for UI. */
  async getGame(gameId: bigint): Promise<Game | null> {
    try {
      const tx = await this.baseClient.get_game({ game_id: gameId });
      const result = await tx.simulate();
      if (result.result?.isOk?.()) {
        const g = result.result.unwrap() as Game;
        const rawState = g.state;
        const stateNum = PokerZkService.normalizeState(rawState) ?? (rawState as number);
        return { ...g, state: stateNum as GameState };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Get number of tables (ids 0..count-1). Returns 0 if method missing (old contract). */
  async getTableCount(): Promise<bigint> {
    try {
      const tx = await this.baseClient.get_table_count();
      const result = await tx.simulate();
      const raw = result?.result;
      if (raw !== undefined && raw !== null) {
        const n = typeof raw === 'bigint' ? raw : BigInt(Number(raw));
        return n > 0n ? n : 0n;
      }
      return 0n;
    } catch {
      return 0n;
    }
  }

  /** Get table by id (blinds, limits, max_seats). */
  async getTable(tableId: bigint): Promise<Table | null> {
    try {
      const tx = await this.baseClient.get_table({ table_id: tableId });
      const result = await tx.simulate();
      if (result.result?.isOk?.()) return result.result.unwrap();
      return null;
    } catch {
      return null;
    }
  }

  /** Get waiting session for table (1/2). Returns null when 0/2. */
  async getTableWaiting(tableId: bigint): Promise<WaitingSession | null> {
    try {
      const tx = await this.baseClient.get_table_waiting({ table_id: tableId });
      const result = await tx.simulate();
      if (result.result?.isOk?.()) return result.result.unwrap();
      return null;
    } catch {
      return null;
    }
  }

  /**
   * STEP 1 (Player 1): Prepare start_game tx with P2 as source, extract P1 auth stub, sign it, return signed auth entry XDR.
   */
  async prepareStartGame(
    sessionId: bigint,
    tableId: bigint,
    buyIn: bigint,
    player1: string,
    player2: string,
    player1Signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>,
    authTtlMinutes?: number
  ): Promise<string> {
    console.log(LOG, 'prepareStartGame()', {
      session_id: sessionId.toString(),
      table_id: tableId.toString(),
      buy_in: buyIn.toString(),
      player1: player1.slice(0, 8) + '…',
      player2: player2.slice(0, 8) + '…',
    });
    const buildClient = new PokerZkClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });

    const tx = await buildClient.start_game(
      {
        session_id: sessionId,
        table_id: tableId,
        player1,
        player2,
        buy_in: buyIn,
      },
      DEFAULT_METHOD_OPTIONS
    );

    if (!tx.simulationData?.result?.auth) {
      throw new Error('No auth entries found in simulation');
    }

    const authEntries = tx.simulationData.result.auth;
    let player1AuthEntry: xdr.SorobanAuthorizationEntry | null = null;

    for (let i = 0; i < authEntries.length; i++) {
      const entry = authEntries[i];
      try {
        const creds = entry?.credentials?.();
        const info = getCredentialTypeAndAddress(creds);
        if (info?.type !== 'sorobanCredentialsAddress' || !info.addressString) continue;
        if (info.addressString === player1) {
          player1AuthEntry = entry;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!player1AuthEntry) {
      throw new Error(`No auth entry found for Player 1 (${player1})`);
    }

    const validUntilLedgerSeq = authTtlMinutes
      ? await calculateValidUntilLedger(RPC_URL, authTtlMinutes)
      : await calculateValidUntilLedger(RPC_URL, MULTI_SIG_AUTH_TTL_MINUTES);

    if (!player1Signer.signAuthEntry) {
      throw new Error('signAuthEntry not available');
    }

    const signedAuthEntry = await authorizeEntry(
      player1AuthEntry,
      async (preimage) => {
        const signResult = await player1Signer.signAuthEntry!(preimage.toXDR('base64'), {
          networkPassphrase: NETWORK_PASSPHRASE,
          address: player1,
        });
        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }
        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );

    const xdr = signedAuthEntry.toXDR('base64');
    console.log(LOG, 'prepareStartGame() ok', { xdrLength: xdr.length });
    return xdr;
  }

  /**
   * Parse auth entry XDR from P1 (start_game) to get session_id, table_id, player1, buy_in.
   */
  parseAuthEntry(authEntryXDR: string): {
    sessionId: bigint;
    tableId: bigint;
    player1: string;
    buyIn: bigint;
  } {
    try {
      const authEntry = xdr.SorobanAuthorizationEntry.fromXDR(authEntryXDR, 'base64');
      const credentials = authEntry.credentials?.();
      if (!credentials) {
        throw new Error('Invalid auth entry: missing credentials');
      }
      const info = getCredentialTypeAndAddress(credentials);
      if (!info?.addressString) {
        throw new Error(info?.type ? `Unsupported credentials type: ${info.type}` : 'Invalid auth entry: expected address credentials');
      }
      if (info.type && info.type !== 'sorobanCredentialsAddress') {
        throw new Error(`Unsupported credentials type: ${info.type}`);
      }
      const player1 = info.addressString;
      const rootInvocation = authEntry.rootInvocation();
      const contractFn = rootInvocation.function().contractFn();
      const functionName = contractFn.functionName().toString();
      if (functionName !== 'start_game') {
        throw new Error(`Invalid function: ${functionName}. Expected start_game`);
      }
      const args = contractFn.args();
      if (args.length !== 3) {
        throw new Error(`Invalid args length: ${args.length}. Expected 3 (session_id, table_id, buy_in)`);
      }
      const sessionId = BigInt(scValToNative(args[0]) as string | number | bigint);
      const tableId = BigInt(scValToNative(args[1]) as string | number | bigint);
      const buyIn = BigInt(scValToNative(args[2]) as string | number | bigint);
      console.log(LOG, 'parseAuthEntry() ok', { sessionId: sessionId.toString(), tableId: tableId.toString(), player1: player1.slice(0, 8) + '…', buyIn: buyIn.toString() });
      return { sessionId, tableId, player1, buyIn };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(LOG, 'parseAuthEntry() error', msg);
      throw new Error(`Failed to parse auth entry: ${msg}`);
    }
  }

  /**
   * STEP 2 (Player 2): Build start_game tx, inject P1 signed auth, sign with P2 and submit.
   * Não fazemos round-trip por XDR para não perder as auth entries (re-simulate substituiria as assinaturas de P1).
   */
  async importAndSignAuthEntry(
    player1AuthEntryXDR: string,
    player2: string,
    player2Signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<string> {
    const { sessionId, tableId, player1, buyIn } = this.parseAuthEntry(player1AuthEntryXDR);
    const client = new PokerZkClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });
    const tx = await client.start_game(
      {
        session_id: sessionId,
        table_id: tableId,
        player1,
        player2,
        buy_in: buyIn,
      },
      DEFAULT_METHOD_OPTIONS
    );
    const updatedTx = await injectSignedAuthEntry(tx, player1AuthEntryXDR, player2, player2Signer);
    return updatedTx.toXDR();
  }

  /**
   * Import P1 auth, inject into tx, sign with P2 and submit.
   * Fluxo do template: após inject, re-importar via toXDR/txFromXDR para que signAndSend use auth entries do parsing XDR (evita "reading 'switch'").
   */
  async importAuthEntryAndSubmit(
    player1AuthEntryXDR: string,
    player2: string,
    player2Signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<unknown> {
    console.log(LOG, 'Import Auth Entry: start', { player2: player2.slice(0, 8) + '…' });
    const { sessionId, tableId, player1, buyIn } = this.parseAuthEntry(player1AuthEntryXDR);
    const client = new PokerZkClient({
      contractId: this.contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      publicKey: player2,
    });
    const tx = await client.start_game(
      { session_id: sessionId, table_id: tableId, player1, player2, buy_in: buyIn },
      DEFAULT_METHOD_OPTIONS
    );
    const updatedTx = await injectSignedAuthEntry(tx, player1AuthEntryXDR, player2, player2Signer);
    // Assinar e enviar a própria tx (já simulada e com auth injectada). O inject substitui entradas sem .switch() por XDR válido.
    const sent = await updatedTx.signAndSend({
      signTransaction: player2Signer.signTransaction,
      signAuthEntry: player2Signer.signAuthEntry,
    });
    console.log(LOG, 'Import Auth Entry: ok', { result: sent?.result != null ? 'ok' : 'null' });
    return sent?.result ?? sent;
  }

  /**
   * STEP 3 (Player 2): Submit the fully signed start_game transaction (usado quando já temos XDR completo).
   * Atenção: se o XDR veio de importAndSignAuthEntry, use importAuthEntryAndSubmit em vez de XDR + finalize.
   */
  async finalizeStartGame(
    fullySignedTxXDR: string,
    player2: string,
    player2Signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<unknown> {
    const client = this.createSigningClient(player2, player2Signer);
    const assembled = client.txFromXDR(fullySignedTxXDR);
    const validUntil = await calculateValidUntilLedger(RPC_URL, DEFAULT_AUTH_TTL_MINUTES);
    const sent = await assembled.signAndSend({
      signTransaction: player2Signer.signTransaction,
      signAuthEntry: player2Signer.signAuthEntry,
    });
    return sent?.result ?? sent;
  }

  /**
   * List games that are waiting for a second player (mesas disponíveis).
   * Fetches CREATE events from the contract and checks each game state.
   */
  async getOpenGames(): Promise<Array<{ gameId: bigint; game: Game }>> {
    const server = new rpc.Server(RPC_URL);
    const { sequence } = await server.getLatestLedger();
    const startLedger = Math.max(0, sequence - 7200);
    const res = await server.getEvents({
      filters: [{ type: 'contract', contractIds: [this.contractId] }],
      startLedger,
      endLedger: sequence,
      limit: 200,
    });
    const gameIds = new Set<bigint>();
    for (const ev of res.events) {
      if (!ev.topic?.length) continue;
      const topicNative = ev.topic.map((t) => scValToNative(t));
      const first = topicNative[0];
      const name = typeof first === 'string' ? first : Array.isArray(first) ? first[0] : null;
      if (name !== 'CREATE') continue;
      const rawId = Array.isArray(first) ? first[1] : topicNative[1];
      const id = typeof rawId === 'bigint' ? rawId : BigInt(Number(rawId ?? 0));
      if (id > 0n) gameIds.add(id);
    }
    const out: Array<{ gameId: bigint; game: Game }> = [];
    for (const id of gameIds) {
      const game = await this.getGame(id);
      if (
        game &&
        (game.state as number) === GameState.WaitingForPlayers &&
        (game.player2 == null || game.player2 === undefined)
      ) {
        out.push({ gameId: id, game });
      }
    }
    out.sort((a, b) => (a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0));
    return out;
  }

  /** Create a new game (player1, table_id, buy-in). Returns game_id. */
  async createGame(
    player: string,
    tableId: bigint,
    buyIn: bigint,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<bigint> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.create_game(
      { player, table_id: tableId, buy_in: buyIn },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    const sent = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
    const result = sent.result as unknown;
    let gameId: bigint;
    if (typeof result === 'bigint') gameId = result;
    else {
      const ok = result as { tag?: string; values?: [bigint] };
      if (ok?.tag === 'ok' && ok.values?.[0] !== undefined) gameId = ok.values[0];
      else throw new Error('create_game failed');
    }
    return gameId;
  }

  /** Sit at table. If 0/2 → 1/2 (waiting); if 1/2 → game starts, returns { waiting, game_id }. */
  async sitAtTable(
    player: string,
    tableId: bigint,
    buyIn: bigint,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<{ waiting: boolean; gameId: bigint }> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.sit_at_table(
      { player, table_id: tableId, buy_in: buyIn },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    let sent: Awaited<ReturnType<typeof signAndSendViaLaunchtube>>;
    try {
      sent = await signAndSendViaLaunchtube(
        tx,
        DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
        validUntil
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg);
    }
    const result = sent.result as unknown;
    const withUnwrap = result as { isOk?: () => boolean; unwrap?: () => { waiting: boolean; game_id: bigint }; unwrapErr?: () => unknown };
    if (withUnwrap?.isOk?.() && withUnwrap.unwrap) {
      const v = withUnwrap.unwrap();
      return { waiting: v.waiting, gameId: v.game_id };
    }
    if (withUnwrap?.unwrapErr) {
      const err = withUnwrap.unwrapErr();
      const code = typeof err === 'number' ? err : (err as { tag?: string; values?: unknown[] })?.values?.[0];
      const num = typeof code === 'number' ? code : Number(code);
      const name = (ContractErrors as Record<number, { message?: string }>)[num]?.message ?? `Error(${num})`;
      throw new Error(`sit_at_table: ${name}`);
    }
    const asResult = result as { tag?: string; values?: unknown[] };
    if (asResult?.tag === 'ok' && asResult.values?.[0]) {
      const v = asResult.values[0] as { waiting: boolean; game_id: bigint };
      return { waiting: v.waiting, gameId: v.game_id };
    }
    if (asResult?.tag === 'err' && asResult.values?.[0] != null) {
      const errVal = asResult.values[0];
      const code = typeof errVal === 'number' ? errVal : (errVal as { tag?: string; values?: unknown[] })?.values?.[0];
      const num = typeof code === 'number' ? code : Number(code);
      const name = (ContractErrors as Record<number, { message?: string }>)[num]?.message ?? `Error(${num})`;
      throw new Error(`sit_at_table: ${name}`);
    }
    throw new Error(`sit_at_table failed (unexpected result): ${JSON.stringify(result)}`);
  }

  /** Cancel waiting session (1/2). Caller = waiting player always; others only after waiting_timeout. */
  async cancelWaiting(
    caller: string,
    tableId: bigint,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(caller, signer);
    const tx = await client.cancel_waiting(
      { caller, table_id: tableId },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Join an existing game (player2, game_id). */
  async joinGame(
    player: string,
    gameId: bigint,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.join_game({ player, game_id: gameId }, DEFAULT_METHOD_OPTIONS);
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Commit shuffle seed (hash of seed). */
  async commitSeed(
    player: string,
    gameId: bigint,
    commitment: Buffer,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.commit_seed(
      { player, game_id: gameId, commitment },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Reveal shuffle seed. */
  async revealSeed(
    player: string,
    gameId: bigint,
    seed: Buffer,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.reveal_seed(
      { player, game_id: gameId, seed },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Advance to post-blinds (after both revealed seeds). Callable by anyone. */
  async postBlinds(
    gameId: bigint,
    signerAddress: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(signerAddress, signer);
    const tx = await client.post_blinds({ game_id: gameId }, DEFAULT_METHOD_OPTIONS);
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Betting action: Fold, Check, Call, or Raise. */
  async act(
    player: string,
    gameId: bigint,
    action: Action,
    raiseAmount: bigint,
    proof: Buffer | null,
    commitment: Buffer | null,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.act(
      {
        player,
        game_id: gameId,
        action,
        raise_amount: raiseAmount,
        proof: proof ?? undefined,
        commitment: commitment ?? undefined,
      },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Reveal hand at showdown (hole cards, claimed rank, proof). */
  async revealHand(
    player: string,
    gameId: bigint,
    holeCards: number[],
    claimedRank: number,
    proof: Buffer,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(player, signer);
    const tx = await client.reveal_hand(
      {
        player,
        game_id: gameId,
        hole_cards: holeCards,
        claimed_rank: claimedRank,
        proof,
      },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Claim timeout / cancel. */
  async claimTimeout(
    caller: string,
    gameId: bigint,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<void> {
    const client = this.createSigningClient(caller, signer);
    const tx = await client.claim_timeout(
      { caller, game_id: gameId },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
  }

  /** Send an on-chain chat message for a game. Emits a CHAT event (no storage).
   *  Returns the transaction hash so the UI can link to stellar.expert. */
  async sendChat(
    sender: string,
    gameId: bigint,
    message: string,
    signer: Pick<ClientOptions, 'signTransaction' | 'signAuthEntry'>
  ): Promise<string | undefined> {
    const client = this.createSigningClient(sender, signer);
    const tx = await client.send_chat(
      { sender, game_id: gameId, message },
      DEFAULT_METHOD_OPTIONS
    );
    const validUntil = await calculateValidUntilLedger(RPC_URL, 10);
    const sent = await signAndSendViaLaunchtube(
      tx,
      DEFAULT_METHOD_OPTIONS.timeoutInSeconds ?? 60,
      validUntil
    );
    // Extract tx hash from response (SentTransaction.getTransactionResponse?.hash)
    const resp = sent?.getTransactionResponse as { hash?: string } | undefined;
    return resp?.hash;
  }
}

export { Action, GameState };
