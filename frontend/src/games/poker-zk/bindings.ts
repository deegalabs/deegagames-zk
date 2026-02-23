import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





export interface Game {
  actor: u32;
  big_blind: i128;
  board: Array<u32>;
  board_revealed: u32;
  buy_in: i128;
  created_at: u64;
  current_bet_p1: i128;
  current_bet_p2: i128;
  dealer_position: u32;
  final_seed: Option<Buffer>;
  folded: Option<string>;
  hand_commitment1: Option<Buffer>;
  hand_commitment2: Option<Buffer>;
  hand_rank1: Option<u32>;
  hand_rank2: Option<u32>;
  id: u64;
  last_action_at: u64;
  last_raise_amount: i128;
  min_raise: i128;
  player1: string;
  player2: Option<string>;
  pot: i128;
  seed_commitment1: Option<Buffer>;
  seed_commitment2: Option<Buffer>;
  seed_reveal1: Option<Buffer>;
  seed_reveal2: Option<Buffer>;
  small_blind: i128;
  state: GameState;
  table_id: u64;
  total_bet_p1: i128;
  total_bet_p2: i128;
  winner: Option<string>;
}

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"InvalidState"},
  4: {message:"CannotPlaySelf"},
  5: {message:"GameFull"},
  6: {message:"BuyInTooLow"},
  7: {message:"BuyInTooHigh"},
  8: {message:"AlreadyCommitted"},
  9: {message:"AlreadyRevealed"},
  10: {message:"InvalidSeed"},
  11: {message:"MustCallOrRaise"},
  12: {message:"InvalidAmount"},
  13: {message:"RaiseTooSmall"},
  14: {message:"GameAlreadyDecided"},
  15: {message:"NotYourTurn"},
  16: {message:"InvalidCards"},
  17: {message:"InvalidRank"},
  18: {message:"InvalidCommitment"},
  19: {message:"InvalidProof"},
  20: {message:"GameAlreadyFinished"},
  21: {message:"GameCancelled"},
  22: {message:"TimeoutNotReached"},
  23: {message:"NoTimeoutApplicable"},
  24: {message:"ConfigNotSet"},
  25: {message:"TableNotFound"},
  26: {message:"NoWaitingSession"},
  27: {message:"WaitingTimeoutNotReached"},
  28: {message:"MessageTooLong"}
}


/**
 * A table (mesa) defines blinds, buy-in limits, and max seats. First table in constructor; more via add_table (admin only).
 */
export interface Table {
  big_blind: i128;
  max_buy_in: i128;
  /**
 * Max seats per table (e.g. 2 for MVP, 4 later). Game starts when min 2 have sat.
 */
max_seats: u32;
  min_buy_in: i128;
  small_blind: i128;
}

export enum Action {
  Fold = 0,
  Check = 1,
  Call = 2,
  Raise = 3,
}

export type DataKey = {tag: "Admin", values: void} | {tag: "Config", values: void} | {tag: "GameHubAddress", values: void} | {tag: "NextGameId", values: void} | {tag: "NextTableId", values: void} | {tag: "Table", values: readonly [u64]} | {tag: "TableWaiting", values: readonly [u64]} | {tag: "Game", values: readonly [u64]} | {tag: "SessionGame", values: readonly [u64]};

export enum GameState {
  WaitingForPlayers = 0,
  ShuffleCommit = 1,
  ShuffleReveal = 2,
  DealCards = 3,
  PreFlop = 4,
  FlopBetting = 5,
  TurnBetting = 6,
  RiverBetting = 7,
  Showdown = 8,
  Finished = 9,
  Cancelled = 10,
}


/**
 * Result of sit_at_table: waiting (1/2) or game started. If !waiting then game_id is set.
 */
export interface SitResult {
  game_id: u64;
  waiting: boolean;
}


export interface GameConfig {
  bet_timeout: u64;
  big_blind: i128;
  game_hub: string;
  max_buy_in: i128;
  min_buy_in: i128;
  /**
 * Optional: when set, lock_funds on create/join and payout_winner on game end.
 */
payment_controller: Option<string>;
  /**
 * Optional: when set, verify_hand_rank in reveal_hand.
 */
proof_verifier: Option<string>;
  rake_percentage: u32;
  reveal_timeout: u64;
  small_blind: i128;
  treasury: string;
  /**
 * Seconds after which a waiting session (1/2) can be closed; player1 refunded. 0 = no timeout.
 */
waiting_timeout: u64;
}


/**
 * One player waiting at a table. When 2nd sits, game is created.
 * If nobody joins within waiting_timeout, anyone can cancel and player1 is refunded.
 */
export interface WaitingSession {
  buy_in: i128;
  created_at: u64;
  player1: string;
}

export interface Client {
  /**
   * Construct and simulate a act transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  act: ({player, game_id, action, raise_amount, proof, commitment}: {player: string, game_id: u64, action: Action, raise_amount: i128, proof: Option<Buffer>, commitment: Option<Buffer>}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_game: ({game_id}: {game_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a add_table transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Add a new table (mesa). Only admin. max_seats e.g. 2 (MVP) or 4.
   */
  add_table: ({admin, small_blind, big_blind, min_buy_in, max_buy_in, max_seats}: {admin: string, small_blind: i128, big_blind: i128, min_buy_in: i128, max_buy_in: i128, max_seats: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_table transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_table: ({table_id}: {table_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Table>>>

  /**
   * Construct and simulate a join_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  join_game: ({player, game_id}: {player: string, game_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a send_chat transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Send an on-chain chat message for a game.
   * Message is emitted as a contract event (not stored) — cost is just the tx fee.
   * Max 280 characters.
   */
  send_chat: ({sender, game_id, message}: {sender: string, game_id: u64, message: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<GameConfig>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Initialize with admin and config (or use __constructor(admin, game_hub) for minimal).
   */
  initialize: ({admin, config}: {admin: string, config: GameConfig}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a game with a client-provided session ID (XDR / Game Studio flow).
   * P1 signs auth for (session_id, table_id, buy_in); P2 submits the tx with P1's auth injected.
   * Game is stored under SessionGame(session_id); get_game(session_id) returns it.
   */
  start_game: ({session_id, table_id, player1, player2, buy_in}: {session_id: u64, table_id: u64, player1: string, player2: string, buy_in: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_seed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  commit_seed: ({player, game_id, commitment}: {player: string, game_id: u64, commitment: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_game: ({player, table_id, buy_in}: {player: string, table_id: u64, buy_in: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a post_blinds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  post_blinds: ({game_id}: {game_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_hand transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Reveal hand at showdown. Calls ProofVerifier when configured.
   */
  reveal_hand: ({player, game_id, hole_cards, claimed_rank, proof}: {player: string, game_id: u64, hole_cards: Array<u32>, claimed_rank: u32, proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_seed transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  reveal_seed: ({player, game_id, seed}: {player: string, game_id: u64, seed: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a sit_at_table transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sit at a table. If nobody waiting → you're 1/2 (waiting). If one waiting → game starts (2/2), returns game_id.
   * Conforme vão entrando usuários, montam-se as mesas virtuais; a mesa inicia quando tem 2 jogadores.
   */
  sit_at_table: ({player, table_id, buy_in}: {player: string, table_id: u64, buy_in: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<SitResult>>>

  /**
   * Construct and simulate a claim_timeout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * [Deprecated] Use advance_timeout. Reclamar timeout (jogador inativo perde). Mantido por compatibilidade.
   */
  claim_timeout: ({caller, game_id}: {caller: string, game_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_waiting transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel a waiting session (1/2). Frees the table for new players.
   * - If caller is the waiting player (player1): can cancel anytime → refund and clear.
   * - Else: only after waiting_timeout seconds → refund player1 and clear (so the mesa can be "encerrada" after a period).
   */
  cancel_waiting: ({caller, table_id}: {caller: string, table_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a advance_timeout transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Quando o tempo de resposta do jogador acaba, o jogo avança automaticamente:
   * - Em apostas: se não há aposta a pagar → CHECK automático; senão → FOLD automático. O jogo continua.
   * - Em commit/reveal ou showdown: o jogador que não agiu perde a mão (outro ganha).
   * Qualquer um pode chamar (ex.: adversário ou frontend) para o jogo não ficar travado.
   */
  advance_timeout: ({game_id}: {game_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_table_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Number of tables (ids 0..count-1). Frontend can iterate get_table(0)..get_table(count-1).
   */
  get_table_count: (options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_table_waiting transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Get current waiting session for a table (1/2). Returns error when 0/2.
   */
  get_table_waiting: ({table_id}: {table_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<WaitingSession>>>

  /**
   * Construct and simulate a set_payment_controller transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set or clear the payment controller (escrow). Admin only. Enables lock_funds on sit/create/join and payout_winner on game end.
   */
  set_payment_controller: ({admin, payment_controller}: {admin: string, payment_controller: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub, small_blind, big_blind, min_buy_in, max_buy_in, max_seats}: {admin: string, game_hub: string, small_blind: i128, big_blind: i128, min_buy_in: i128, max_buy_in: i128, max_seats: u32},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub, small_blind, big_blind, min_buy_in, max_buy_in, max_seats}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABEdhbWUAAAAgAAAAAAAAAAVhY3RvcgAAAAAAAAQAAAAAAAAACWJpZ19ibGluZAAAAAAAAAsAAAAAAAAABWJvYXJkAAAAAAAD6gAAAAQAAAAAAAAADmJvYXJkX3JldmVhbGVkAAAAAAAEAAAAAAAAAAZidXlfaW4AAAAAAAsAAAAAAAAACmNyZWF0ZWRfYXQAAAAAAAYAAAAAAAAADmN1cnJlbnRfYmV0X3AxAAAAAAALAAAAAAAAAA5jdXJyZW50X2JldF9wMgAAAAAACwAAAAAAAAAPZGVhbGVyX3Bvc2l0aW9uAAAAAAQAAAAAAAAACmZpbmFsX3NlZWQAAAAAA+gAAAPuAAAAIAAAAAAAAAAGZm9sZGVkAAAAAAPoAAAAEwAAAAAAAAAQaGFuZF9jb21taXRtZW50MQAAA+gAAAPuAAAAIAAAAAAAAAAQaGFuZF9jb21taXRtZW50MgAAA+gAAAPuAAAAIAAAAAAAAAAKaGFuZF9yYW5rMQAAAAAD6AAAAAQAAAAAAAAACmhhbmRfcmFuazIAAAAAA+gAAAAEAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAObGFzdF9hY3Rpb25fYXQAAAAAAAYAAAAAAAAAEWxhc3RfcmFpc2VfYW1vdW50AAAAAAAACwAAAAAAAAAJbWluX3JhaXNlAAAAAAAACwAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAA+gAAAATAAAAAAAAAANwb3QAAAAACwAAAAAAAAAQc2VlZF9jb21taXRtZW50MQAAA+gAAAPuAAAAIAAAAAAAAAAQc2VlZF9jb21taXRtZW50MgAAA+gAAAPuAAAAIAAAAAAAAAAMc2VlZF9yZXZlYWwxAAAD6AAAA+4AAAAgAAAAAAAAAAxzZWVkX3JldmVhbDIAAAPoAAAD7gAAACAAAAAAAAAAC3NtYWxsX2JsaW5kAAAAAAsAAAAAAAAABXN0YXRlAAAAAAAH0AAAAAlHYW1lU3RhdGUAAAAAAAAAAAAACHRhYmxlX2lkAAAABgAAAAAAAAAMdG90YWxfYmV0X3AxAAAACwAAAAAAAAAMdG90YWxfYmV0X3AyAAAACwAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAHAAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAMSW52YWxpZFN0YXRlAAAAAwAAAAAAAAAOQ2Fubm90UGxheVNlbGYAAAAAAAQAAAAAAAAACEdhbWVGdWxsAAAABQAAAAAAAAALQnV5SW5Ub29Mb3cAAAAABgAAAAAAAAAMQnV5SW5Ub29IaWdoAAAABwAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAgAAAAAAAAAD0FscmVhZHlSZXZlYWxlZAAAAAAJAAAAAAAAAAtJbnZhbGlkU2VlZAAAAAAKAAAAAAAAAA9NdXN0Q2FsbE9yUmFpc2UAAAAACwAAAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAAwAAAAAAAAADVJhaXNlVG9vU21hbGwAAAAAAAANAAAAAAAAABJHYW1lQWxyZWFkeURlY2lkZWQAAAAAAA4AAAAAAAAAC05vdFlvdXJUdXJuAAAAAA8AAAAAAAAADEludmFsaWRDYXJkcwAAABAAAAAAAAAAC0ludmFsaWRSYW5rAAAAABEAAAAAAAAAEUludmFsaWRDb21taXRtZW50AAAAAAAAEgAAAAAAAAAMSW52YWxpZFByb29mAAAAEwAAAAAAAAATR2FtZUFscmVhZHlGaW5pc2hlZAAAAAAUAAAAAAAAAA1HYW1lQ2FuY2VsbGVkAAAAAAAAFQAAAAAAAAARVGltZW91dE5vdFJlYWNoZWQAAAAAAAAWAAAAAAAAABNOb1RpbWVvdXRBcHBsaWNhYmxlAAAAABcAAAAAAAAADENvbmZpZ05vdFNldAAAABgAAAAAAAAADVRhYmxlTm90Rm91bmQAAAAAAAAZAAAAAAAAABBOb1dhaXRpbmdTZXNzaW9uAAAAGgAAAAAAAAAYV2FpdGluZ1RpbWVvdXROb3RSZWFjaGVkAAAAGwAAAAAAAAAOTWVzc2FnZVRvb0xvbmcAAAAAABw=",
        "AAAAAQAAAHlBIHRhYmxlIChtZXNhKSBkZWZpbmVzIGJsaW5kcywgYnV5LWluIGxpbWl0cywgYW5kIG1heCBzZWF0cy4gRmlyc3QgdGFibGUgaW4gY29uc3RydWN0b3I7IG1vcmUgdmlhIGFkZF90YWJsZSAoYWRtaW4gb25seSkuAAAAAAAAAAAAAAVUYWJsZQAAAAAAAAUAAAAAAAAACWJpZ19ibGluZAAAAAAAAAsAAAAAAAAACm1heF9idXlfaW4AAAAAAAsAAABPTWF4IHNlYXRzIHBlciB0YWJsZSAoZS5nLiAyIGZvciBNVlAsIDQgbGF0ZXIpLiBHYW1lIHN0YXJ0cyB3aGVuIG1pbiAyIGhhdmUgc2F0LgAAAAAJbWF4X3NlYXRzAAAAAAAABAAAAAAAAAAKbWluX2J1eV9pbgAAAAAACwAAAAAAAAALc21hbGxfYmxpbmQAAAAACw==",
        "AAAAAwAAAAAAAAAAAAAABkFjdGlvbgAAAAAABAAAAAAAAAAERm9sZAAAAAAAAAAAAAAABUNoZWNrAAAAAAAAAQAAAAAAAAAEQ2FsbAAAAAIAAAAAAAAABVJhaXNlAAAAAAAAAw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAACQAAAAAAAAAAAAAABUFkbWluAAAAAAAAAAAAAAAAAAAGQ29uZmlnAAAAAAAAAAAAAAAAAA5HYW1lSHViQWRkcmVzcwAAAAAAAAAAAAAAAAAKTmV4dEdhbWVJZAAAAAAAAAAAAAAAAAALTmV4dFRhYmxlSWQAAAAAAQAAAAAAAAAFVGFibGUAAAAAAAABAAAABgAAAAEAAABST25lIHdhaXRpbmcgc2Vzc2lvbiBwZXIgdGFibGUgKDEvMikuIENsZWFyZWQgd2hlbiAybmQgcGxheWVyIHNpdHMgYW5kIGdhbWUgc3RhcnRzLgAAAAAADFRhYmxlV2FpdGluZwAAAAEAAAAGAAAAAQAAAAAAAAAER2FtZQAAAAEAAAAGAAAAAQAAAFxHYW1lIGNyZWF0ZWQgdmlhIHN0YXJ0X2dhbWUoc2Vzc2lvbl9pZCwgLi4uKSDigJQgY2xpZW50LXByb3ZpZGVkIHNlc3Npb24gSUQgKFhEUiBqb2luIGZsb3cpLgAAAAtTZXNzaW9uR2FtZQAAAAABAAAABg==",
        "AAAAAwAAAAAAAAAAAAAACUdhbWVTdGF0ZQAAAAAAAAsAAAAAAAAAEVdhaXRpbmdGb3JQbGF5ZXJzAAAAAAAAAAAAAAAAAAANU2h1ZmZsZUNvbW1pdAAAAAAAAAEAAAAAAAAADVNodWZmbGVSZXZlYWwAAAAAAAACAAAAAAAAAAlEZWFsQ2FyZHMAAAAAAAADAAAAAAAAAAdQcmVGbG9wAAAAAAQAAAAAAAAAC0Zsb3BCZXR0aW5nAAAAAAUAAAAAAAAAC1R1cm5CZXR0aW5nAAAAAAYAAAAAAAAADFJpdmVyQmV0dGluZwAAAAcAAAAAAAAACFNob3dkb3duAAAACAAAAAAAAAAIRmluaXNoZWQAAAAJAAAAAAAAAAlDYW5jZWxsZWQAAAAAAAAK",
        "AAAAAQAAAFdSZXN1bHQgb2Ygc2l0X2F0X3RhYmxlOiB3YWl0aW5nICgxLzIpIG9yIGdhbWUgc3RhcnRlZC4gSWYgIXdhaXRpbmcgdGhlbiBnYW1lX2lkIGlzIHNldC4AAAAAAAAAAAlTaXRSZXN1bHQAAAAAAAACAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAAAAAAAB3dhaXRpbmcAAAAAAQ==",
        "AAAAAQAAAAAAAAAAAAAACkdhbWVDb25maWcAAAAAAAwAAAAAAAAAC2JldF90aW1lb3V0AAAAAAYAAAAAAAAACWJpZ19ibGluZAAAAAAAAAsAAAAAAAAACGdhbWVfaHViAAAAEwAAAAAAAAAKbWF4X2J1eV9pbgAAAAAACwAAAAAAAAAKbWluX2J1eV9pbgAAAAAACwAAAExPcHRpb25hbDogd2hlbiBzZXQsIGxvY2tfZnVuZHMgb24gY3JlYXRlL2pvaW4gYW5kIHBheW91dF93aW5uZXIgb24gZ2FtZSBlbmQuAAAAEnBheW1lbnRfY29udHJvbGxlcgAAAAAD6AAAABMAAAA0T3B0aW9uYWw6IHdoZW4gc2V0LCB2ZXJpZnlfaGFuZF9yYW5rIGluIHJldmVhbF9oYW5kLgAAAA5wcm9vZl92ZXJpZmllcgAAAAAD6AAAABMAAAAAAAAAD3Jha2VfcGVyY2VudGFnZQAAAAAEAAAAAAAAAA5yZXZlYWxfdGltZW91dAAAAAAABgAAAAAAAAALc21hbGxfYmxpbmQAAAAACwAAAAAAAAAIdHJlYXN1cnkAAAATAAAAXFNlY29uZHMgYWZ0ZXIgd2hpY2ggYSB3YWl0aW5nIHNlc3Npb24gKDEvMikgY2FuIGJlIGNsb3NlZDsgcGxheWVyMSByZWZ1bmRlZC4gMCA9IG5vIHRpbWVvdXQuAAAAD3dhaXRpbmdfdGltZW91dAAAAAAG",
        "AAAAAAAAAAAAAAADYWN0AAAAAAYAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAHZ2FtZV9pZAAAAAAGAAAAAAAAAAZhY3Rpb24AAAAAB9AAAAAGQWN0aW9uAAAAAAAAAAAADHJhaXNlX2Ftb3VudAAAAAsAAAAAAAAABXByb29mAAAAAAAD6AAAA+4AAAEAAAAAAAAAAApjb21taXRtZW50AAAAAAPoAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAQAAAJFPbmUgcGxheWVyIHdhaXRpbmcgYXQgYSB0YWJsZS4gV2hlbiAybmQgc2l0cywgZ2FtZSBpcyBjcmVhdGVkLgpJZiBub2JvZHkgam9pbnMgd2l0aGluIHdhaXRpbmdfdGltZW91dCwgYW55b25lIGNhbiBjYW5jZWwgYW5kIHBsYXllcjEgaXMgcmVmdW5kZWQuAAAAAAAAAAAAAA5XYWl0aW5nU2Vzc2lvbgAAAAAAAwAAAAAAAAAGYnV5X2luAAAAAAALAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAdwbGF5ZXIxAAAAABM=",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAIZ2V0X2dhbWUAAAABAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAABAAAD6QAAB9AAAAAER2FtZQAAAAM=",
        "AAAAAAAAAEBBZGQgYSBuZXcgdGFibGUgKG1lc2EpLiBPbmx5IGFkbWluLiBtYXhfc2VhdHMgZS5nLiAyIChNVlApIG9yIDQuAAAACWFkZF90YWJsZQAAAAAAAAYAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAALc21hbGxfYmxpbmQAAAAACwAAAAAAAAAJYmlnX2JsaW5kAAAAAAAACwAAAAAAAAAKbWluX2J1eV9pbgAAAAAACwAAAAAAAAAKbWF4X2J1eV9pbgAAAAAACwAAAAAAAAAJbWF4X3NlYXRzAAAAAAAABAAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJZ2V0X3RhYmxlAAAAAAAAAQAAAAAAAAAIdGFibGVfaWQAAAAGAAAAAQAAA+kAAAfQAAAABVRhYmxlAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAJam9pbl9nYW1lAAAAAAAAAgAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAI5TZW5kIGFuIG9uLWNoYWluIGNoYXQgbWVzc2FnZSBmb3IgYSBnYW1lLgpNZXNzYWdlIGlzIGVtaXR0ZWQgYXMgYSBjb250cmFjdCBldmVudCAobm90IHN0b3JlZCkg4oCUIGNvc3QgaXMganVzdCB0aGUgdHggZmVlLgpNYXggMjgwIGNoYXJhY3RlcnMuAAAAAAAJc2VuZF9jaGF0AAAAAAAAAwAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAAAAAAAB21lc3NhZ2UAAAAAEAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAApHYW1lQ29uZmlnAAAAAAAD",
        "AAAAAAAAAFVJbml0aWFsaXplIHdpdGggYWRtaW4gYW5kIGNvbmZpZyAob3IgdXNlIF9fY29uc3RydWN0b3IoYWRtaW4sIGdhbWVfaHViKSBmb3IgbWluaW1hbCkuAAAAAAAACmluaXRpYWxpemUAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAGY29uZmlnAAAAAAfQAAAACkdhbWVDb25maWcAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAPRTdGFydCBhIGdhbWUgd2l0aCBhIGNsaWVudC1wcm92aWRlZCBzZXNzaW9uIElEIChYRFIgLyBHYW1lIFN0dWRpbyBmbG93KS4KUDEgc2lnbnMgYXV0aCBmb3IgKHNlc3Npb25faWQsIHRhYmxlX2lkLCBidXlfaW4pOyBQMiBzdWJtaXRzIHRoZSB0eCB3aXRoIFAxJ3MgYXV0aCBpbmplY3RlZC4KR2FtZSBpcyBzdG9yZWQgdW5kZXIgU2Vzc2lvbkdhbWUoc2Vzc2lvbl9pZCk7IGdldF9nYW1lKHNlc3Npb25faWQpIHJldHVybnMgaXQuAAAACnN0YXJ0X2dhbWUAAAAAAAUAAAAAAAAACnNlc3Npb25faWQAAAAAAAYAAAAAAAAACHRhYmxlX2lkAAAABgAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAABmJ1eV9pbgAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAALY29tbWl0X3NlZWQAAAAAAwAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAALY3JlYXRlX2dhbWUAAAAAAwAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAh0YWJsZV9pZAAAAAYAAAAAAAAABmJ1eV9pbgAAAAAACwAAAAEAAAPpAAAABgAAAAM=",
        "AAAAAAAAAAAAAAALcG9zdF9ibGluZHMAAAAAAQAAAAAAAAAHZ2FtZV9pZAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAD1SZXZlYWwgaGFuZCBhdCBzaG93ZG93bi4gQ2FsbHMgUHJvb2ZWZXJpZmllciB3aGVuIGNvbmZpZ3VyZWQuAAAAAAAAC3JldmVhbF9oYW5kAAAAAAUAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAHZ2FtZV9pZAAAAAAGAAAAAAAAAApob2xlX2NhcmRzAAAAAAPqAAAABAAAAAAAAAAMY2xhaW1lZF9yYW5rAAAABAAAAAAAAAAFcHJvb2YAAAAAAAPuAAABAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAALcmV2ZWFsX3NlZWQAAAAAAwAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAAAAAAABHNlZWQAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAANdTaXQgYXQgYSB0YWJsZS4gSWYgbm9ib2R5IHdhaXRpbmcg4oaSIHlvdSdyZSAxLzIgKHdhaXRpbmcpLiBJZiBvbmUgd2FpdGluZyDihpIgZ2FtZSBzdGFydHMgKDIvMiksIHJldHVybnMgZ2FtZV9pZC4KQ29uZm9ybWUgdsOjbyBlbnRyYW5kbyB1c3XDoXJpb3MsIG1vbnRhbS1zZSBhcyBtZXNhcyB2aXJ0dWFpczsgYSBtZXNhIGluaWNpYSBxdWFuZG8gdGVtIDIgam9nYWRvcmVzLgAAAAAMc2l0X2F0X3RhYmxlAAAAAwAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAh0YWJsZV9pZAAAAAYAAAAAAAAABmJ1eV9pbgAAAAAACwAAAAEAAAPpAAAH0AAAAAlTaXRSZXN1bHQAAAAAAAAD",
        "AAAAAAAAAN9Db25zdHJ1Y3RvcjogYWRtaW4sIGdhbWVfaHViLCBhbmQgZmlyc3QgdGFibGUgKG1lc2EpLiBGdXJ0aGVyIHRhYmxlcyB2aWEgYWRkX3RhYmxlIChhZG1pbiBvbmx5KS4KbWF4X3NlYXRzOiBlLmcuIDIgZm9yIE1WUCwgNCBmb3IgNC1wbGF5ZXIgdGFibGVzIGxhdGVyLgpBbHNvIHNldHMgQ29uZmlnIHNvIHN0YXJ0X2dhbWUgYW5kIG90aGVyIGZ1bmN0aW9ucyB3b3JrIChsb2FkX2NvbmZpZykuAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABwAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhnYW1lX2h1YgAAABMAAAAAAAAAC3NtYWxsX2JsaW5kAAAAAAsAAAAAAAAACWJpZ19ibGluZAAAAAAAAAsAAAAAAAAACm1pbl9idXlfaW4AAAAAAAsAAAAAAAAACm1heF9idXlfaW4AAAAAAAsAAAAAAAAACW1heF9zZWF0cwAAAAAAAAQAAAAA",
        "AAAAAAAAAGhbRGVwcmVjYXRlZF0gVXNlIGFkdmFuY2VfdGltZW91dC4gUmVjbGFtYXIgdGltZW91dCAoam9nYWRvciBpbmF0aXZvIHBlcmRlKS4gTWFudGlkbyBwb3IgY29tcGF0aWJpbGlkYWRlLgAAAA1jbGFpbV90aW1lb3V0AAAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAdnYW1lX2lkAAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAQ9DYW5jZWwgYSB3YWl0aW5nIHNlc3Npb24gKDEvMikuIEZyZWVzIHRoZSB0YWJsZSBmb3IgbmV3IHBsYXllcnMuCi0gSWYgY2FsbGVyIGlzIHRoZSB3YWl0aW5nIHBsYXllciAocGxheWVyMSk6IGNhbiBjYW5jZWwgYW55dGltZSDihpIgcmVmdW5kIGFuZCBjbGVhci4KLSBFbHNlOiBvbmx5IGFmdGVyIHdhaXRpbmdfdGltZW91dCBzZWNvbmRzIOKGkiByZWZ1bmQgcGxheWVyMSBhbmQgY2xlYXIgKHNvIHRoZSBtZXNhIGNhbiBiZSAiZW5jZXJyYWRhIiBhZnRlciBhIHBlcmlvZCkuAAAAAA5jYW5jZWxfd2FpdGluZwAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAh0YWJsZV9pZAAAAAYAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAWVRdWFuZG8gbyB0ZW1wbyBkZSByZXNwb3N0YSBkbyBqb2dhZG9yIGFjYWJhLCBvIGpvZ28gYXZhbsOnYSBhdXRvbWF0aWNhbWVudGU6Ci0gRW0gYXBvc3Rhczogc2UgbsOjbyBow6EgYXBvc3RhIGEgcGFnYXIg4oaSIENIRUNLIGF1dG9tw6F0aWNvOyBzZW7Do28g4oaSIEZPTEQgYXV0b23DoXRpY28uIE8gam9nbyBjb250aW51YS4KLSBFbSBjb21taXQvcmV2ZWFsIG91IHNob3dkb3duOiBvIGpvZ2Fkb3IgcXVlIG7Do28gYWdpdSBwZXJkZSBhIG3Do28gKG91dHJvIGdhbmhhKS4KUXVhbHF1ZXIgdW0gcG9kZSBjaGFtYXIgKGV4LjogYWR2ZXJzw6FyaW8gb3UgZnJvbnRlbmQpIHBhcmEgbyBqb2dvIG7Do28gZmljYXIgdHJhdmFkby4AAAAAAAAPYWR2YW5jZV90aW1lb3V0AAAAAAEAAAAAAAAAB2dhbWVfaWQAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAFlOdW1iZXIgb2YgdGFibGVzIChpZHMgMC4uY291bnQtMSkuIEZyb250ZW5kIGNhbiBpdGVyYXRlIGdldF90YWJsZSgwKS4uZ2V0X3RhYmxlKGNvdW50LTEpLgAAAAAAAA9nZXRfdGFibGVfY291bnQAAAAAAAAAAAEAAAAG",
        "AAAAAAAAAEZHZXQgY3VycmVudCB3YWl0aW5nIHNlc3Npb24gZm9yIGEgdGFibGUgKDEvMikuIFJldHVybnMgZXJyb3Igd2hlbiAwLzIuAAAAAAARZ2V0X3RhYmxlX3dhaXRpbmcAAAAAAAABAAAAAAAAAAh0YWJsZV9pZAAAAAYAAAABAAAD6QAAB9AAAAAOV2FpdGluZ1Nlc3Npb24AAAAAAAM=",
        "AAAAAAAAAH5TZXQgb3IgY2xlYXIgdGhlIHBheW1lbnQgY29udHJvbGxlciAoZXNjcm93KS4gQWRtaW4gb25seS4gRW5hYmxlcyBsb2NrX2Z1bmRzIG9uIHNpdC9jcmVhdGUvam9pbiBhbmQgcGF5b3V0X3dpbm5lciBvbiBnYW1lIGVuZC4AAAAAABZzZXRfcGF5bWVudF9jb250cm9sbGVyAAAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAEnBheW1lbnRfY29udHJvbGxlcgAAAAAD6AAAABMAAAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    act: this.txFromJSON<Result<void>>,
        get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        get_game: this.txFromJSON<Result<Game>>,
        add_table: this.txFromJSON<Result<u64>>,
        get_admin: this.txFromJSON<string>,
        get_table: this.txFromJSON<Result<Table>>,
        join_game: this.txFromJSON<Result<void>>,
        send_chat: this.txFromJSON<Result<void>>,
        set_admin: this.txFromJSON<null>,
        get_config: this.txFromJSON<Result<GameConfig>>,
        initialize: this.txFromJSON<Result<void>>,
        start_game: this.txFromJSON<Result<void>>,
        commit_seed: this.txFromJSON<Result<void>>,
        create_game: this.txFromJSON<Result<u64>>,
        post_blinds: this.txFromJSON<Result<void>>,
        reveal_hand: this.txFromJSON<Result<void>>,
        reveal_seed: this.txFromJSON<Result<void>>,
        sit_at_table: this.txFromJSON<Result<SitResult>>,
        claim_timeout: this.txFromJSON<Result<void>>,
        cancel_waiting: this.txFromJSON<Result<void>>,
        advance_timeout: this.txFromJSON<Result<void>>,
        get_table_count: this.txFromJSON<u64>,
        get_table_waiting: this.txFromJSON<Result<WaitingSession>>,
        set_payment_controller: this.txFromJSON<null>
  }
}