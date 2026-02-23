import { useState, useEffect, useRef, useCallback } from 'react';
import { HistoryPanel } from '@/components/HistoryPanel';
import { ChatPanel } from '@/components/ChatPanel';
import { PokerZkService, GameState, Action, getMyHoleCardsFromGame } from './pokerZkService';
const normalizeState = PokerZkService.normalizeState;
import { useWallet } from '@/hooks/useWallet';
import { POKER_ZK_CONTRACT, RPC_URL } from '@/utils/constants';
import type { Game, Table, WaitingSession } from './bindings';
import { Buffer } from 'buffer';

const pokerZkService = new PokerZkService(POKER_ZK_CONTRACT);

/** Default buy-in in XLM. Contract (deploy) allows 1–5 XLM for table 0. */
const BUY_IN_DEFAULT = '1';
const POINTS_DECIMALS = 7;
const STROOPS_PER_XLM = 10_000_000;

export interface TableRow {
  tableId: bigint;
  table: Table;
  waiting: WaitingSession | null;
}
const SEED_STORAGE_PREFIX = 'poker_seed_';
const CURRENT_GAME_KEY_PREFIX = 'poker_zk_current_game_';

function parseBuyIn(value: string): bigint | null {
  try {
    const cleaned = value.replace(/[^\d.]/g, '');
    if (!cleaned || cleaned === '.') return null;
    const [whole = '0', fraction = ''] = cleaned.split('.');
    const padded = fraction.padEnd(POINTS_DECIMALS, '0').slice(0, POINTS_DECIMALS);
    return BigInt(whole + padded);
  } catch {
    return null;
  }
}

function seedStorageKey(gameId: bigint, userAddress: string): string {
  return `${SEED_STORAGE_PREFIX}${gameId}_${userAddress}`;
}

/** Card index 1–52 to rank/suit (same as board rendering). Segurança: usar só para as minhas hole cards. */
function cardToRankSuit(n: number): { rank: string; suit: string; isRed: boolean } {
  const num = Number(n);
  const rank = num % 13 === 0 ? 'A' : num % 13 > 9 ? ['T', 'J', 'Q', 'K'][num % 13 - 10] : String((num % 13) + 1);
  const suit = ['♠', '♣', '♥', '♦'][Math.floor(num / 13) % 4];
  const isRed = suit === '♥' || suit === '♦';
  return { rank, suit, isRed };
}

/** Card 1–52 to numeric rank 0–12 (0=A, 1=2, … 12=K) and suit 0–3. */
function cardRankSuit(c: number): { r: number; s: number } {
  const n = Number(c);
  const r = n % 13 === 0 ? 0 : n % 13;
  const s = Math.floor((n - 1) / 13) % 4;
  return { r, s };
}

/** Minimal hand rank 1–10 for reveal_hand (contract expects 1–10). 1=High card … 10=Royal flush. */
function computeHandRankSimple(hole: [number, number], board: number[]): number {
  const all = [...hole, ...board].filter((_, i) => i < 7);
  const ranks = all.map((c) => cardRankSuit(c).r);
  const suits = all.map((c) => cardRankSuit(c).s);
  const countByRank: Record<number, number> = {};
  for (let i = 0; i <= 12; i++) countByRank[i] = 0;
  ranks.forEach((r) => { countByRank[r] = (countByRank[r] || 0) + 1; });
  const countBySuit: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  suits.forEach((s) => { countBySuit[s] = (countBySuit[s] || 0) + 1; });
  const counts = Object.values(countByRank).filter((n) => n >= 2).sort((a, b) => b - a);
  const maxSameSuit = Math.max(...Object.values(countBySuit));
  const sorted = [...ranks].sort((a, b) => a - b);
  const uniq = [...new Set(sorted)];
  let straightLen = 1;
  for (let i = 1; i < uniq.length; i++) {
    if (uniq[i] === uniq[i - 1] + 1) straightLen++;
    else straightLen = 1;
    if (straightLen >= 5) break;
  }
  const hasStraight = straightLen >= 5 || (uniq.includes(0) && uniq.includes(12) && uniq.includes(11) && uniq.includes(10) && uniq.includes(9));
  const hasFlush = maxSameSuit >= 5;
  if (hasFlush && hasStraight) return uniq.some((r) => r >= 9 || r === 0) ? 10 : 9;
  if (counts[0] === 4) return 8;
  if (counts[0] === 3 && counts[1] >= 2) return 7;
  if (hasFlush) return 6;
  if (hasStraight) return 5;
  if (counts[0] === 3) return 4;
  if (counts[0] === 2 && counts[1] === 2) return 3;
  if (counts[0] === 2) return 2;
  return 1;
}

/** Generate 32 random bytes and SHA-256 commitment. Returns { seed, commitment } as Buffer. */
async function generateSeedAndCommitment(): Promise<{ seed: Buffer; commitment: Buffer }> {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', seed);
  const commitment = new Uint8Array(hashBuffer);
  return { seed: Buffer.from(seed), commitment: Buffer.from(commitment) };
}

export interface PokerZkGameProps {
  userAddress: string;
  currentEpoch?: number;
  availablePoints: bigint;
  onStandingsRefresh: () => void;
  onGameComplete: () => void;
  onBackToLibrary?: () => void;
}

export function PokerZkGame({
  userAddress,
  availablePoints,
  onStandingsRefresh,
  onGameComplete,
  onBackToLibrary,
}: PokerZkGameProps) {
  const [gameId, setGameId] = useState<bigint | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [raiseAmount, setRaiseAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [openGames, setOpenGames] = useState<Array<{ gameId: bigint; game: Game }>>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [tablesLoadError, setTablesLoadError] = useState<string | null>(null);
  const [loadingOpenGames, setLoadingOpenGames] = useState(false);
  const [config, setConfig] = useState<{ waiting_timeout: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lock = useRef(false);
  const { getContractSigner } = useWallet();

  const [mesasBuyIn, setMesasBuyIn] = useState(BUY_IN_DEFAULT);
  const [tournModalOpen, setTournModalOpen] = useState(false);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);

  const isBusy = loading;
  const runAction = async (fn: () => Promise<void>) => {
    if (lock.current || isBusy) return;
    lock.current = true;
    setError(null);
    setSuccess(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      lock.current = false;
      setLoading(false);
    }
  };

  const loadGame = async (id: bigint) => {
    const g = await pokerZkService.getGame(id);
    setGame(g);
    return g;
  };

  // Persist current game so refresh restores it (for current user and for the other player so either can reconnect)
  useEffect(() => {
    if (gameId == null) {
      if (userAddress) {
        try { localStorage.removeItem(CURRENT_GAME_KEY_PREFIX + userAddress); } catch { /* ignore */ }
      }
      return;
    }
    const idStr = gameId.toString();
    try {
      localStorage.setItem(CURRENT_GAME_KEY_PREFIX + userAddress, idStr);
      if (game?.player1) localStorage.setItem(CURRENT_GAME_KEY_PREFIX + game.player1, idStr);
      if (game?.player2 != null && game.player2 !== undefined)
        localStorage.setItem(CURRENT_GAME_KEY_PREFIX + game.player2, idStr);
    } catch { /* ignore */ }
  }, [userAddress, gameId, game?.player1, game?.player2]);

  // Restore game on load if this user had one (data is on-chain; we just need to re-fetch)
  useEffect(() => {
    if (!userAddress || gameId != null) return;
    const key = CURRENT_GAME_KEY_PREFIX + userAddress;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(key);
    } catch { /* ignore */ }
    if (!stored) return;
    const id = BigInt(stored);
    let cancelled = false;
    pokerZkService.getGame(id).then((g) => {
      if (cancelled) return;
      if (!g) return; // rede/contrato falhou; não apagar key para poder tentar de novo
      const s = normalizeState(g.state) ?? Number(g.state);
      const finished = s === GameState.Finished || s === GameState.Cancelled;
      const isPlayer = g.player1 === userAddress || (g.player2 != null && g.player2 === userAddress);
      if (!finished && isPlayer) {
        setGameId(id);
        setGame(g);
      } else {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
      }
    }).catch(() => {
      if (!cancelled) { /* não apagar em erro de rede; usuário pode atualizar de novo */ }
    });
    return () => { cancelled = true; };
  }, [userAddress]);

  useEffect(() => {
    if (!gameId) return;
    const stateNum = game?.state != null ? (normalizeState(game.state) ?? Number(game.state)) : undefined;
    const isCommitPhase = stateNum === GameState.ShuffleCommit;
    const weCommitted = !!sessionStorage.getItem(seedStorageKey(gameId, userAddress));
    const intervalMs = isCommitPhase ? (weCommitted ? 1500 : 2000) : 5000;
    const t = setInterval(() => loadGame(gameId), intervalMs);
    return () => clearInterval(t);
  }, [gameId, game?.state, userAddress]);

  // Ao trocar de utilizador (Switch P1/P2), refetch do jogo para a UI mostrar o estado correto (Commit vs Reveal, etc.)
  useEffect(() => {
    if (gameId != null && userAddress) loadGame(gameId);
  }, [userAddress, gameId]);

  const refreshOpenGames = useCallback(async () => {
    if (gameId) return;
    setLoadingOpenGames(true);
    try {
      const list = await pokerZkService.getOpenGames();
      setOpenGames(list);
    } catch {
      setOpenGames([]);
    } finally {
      setLoadingOpenGames(false);
    }
  }, [gameId]);

  const refreshTables = useCallback(async () => {
    if (gameId) return;
    setLoadingTables(true);
    setTablesLoadError(null);
    try {
      const count = await pokerZkService.getTableCount();
      const list: TableRow[] = [];
      const n = Number(count);
      for (let i = 0; i < (n > 0 ? n : 1); i++) {
        const tableId = BigInt(i);
        const table = await pokerZkService.getTable(tableId);
        const waiting = await pokerZkService.getTableWaiting(tableId);
        if (table) list.push({ tableId, table, waiting });
      }
      // Se get_table_count devolveu 0 mas a mesa 0 existe (ex.: contrato novo), mostrá-la
      if (list.length === 0) {
        const table0 = await pokerZkService.getTable(0n);
        if (table0) {
          const waiting0 = await pokerZkService.getTableWaiting(0n);
          list.push({ tableId: 0n, table: table0, waiting: waiting0 });
        }
      }
      setTables(list);
    } catch (e) {
      setTables([]);
      const msg = e instanceof Error ? e.message : String(e);
      setTablesLoadError(msg);
    } finally {
      setLoadingTables(false);
    }
  }, [gameId]);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await pokerZkService.getConfig();
      setConfig(cfg);
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    if (!gameId) {
      loadConfig();
      refreshTables();
      refreshOpenGames();
      const t = setInterval(() => {
        refreshTables();
        refreshOpenGames();
      }, 15000);
      return () => clearInterval(t);
    }
  }, [gameId, refreshTables, refreshOpenGames, loadConfig]);

  const handleCreateGame = (tableId: bigint = 0n) => {
    runAction(async () => {
      setLoading(true);
      const amount = parseBuyIn(mesasBuyIn);
      if (!amount || amount <= 0n) {
        setError('Enter a valid buy-in');
        return;
      }
      const signer = getContractSigner();
      const id = await pokerZkService.createGame(userAddress, tableId, amount, signer);
      setGameId(id);
      await loadGame(id);
      setSuccess(`Game created. ID: ${id.toString()}`);
    });
  };

  const handleSitAtTable = (tableId: bigint, buyInAmount: bigint) => {
    runAction(async () => {
      const row = tables.find((t) => t.tableId === tableId);
      const waitingP1 = (row?.waiting as { player1?: string } | null)?.player1?.trim().toUpperCase();
      if (waitingP1 != null && userAddress.trim().toUpperCase() === waitingP1) {
        setError('You are already waiting at this table as Player 1. Switch to P2 above so the 2nd player can sit.');
        return;
      }
      setLoading(true);
      const signer = getContractSigner();
      const { waiting, gameId: gid } = await pokerZkService.sitAtTable(
        userAddress,
        tableId,
        buyInAmount,
        signer
      );
      if (waiting) {
        setSuccess('Seated at the table (1/2). Waiting for another player.');
        await refreshTables();
      } else {
        setGameId(gid);
        await loadGame(gid);
        setSuccess('Game started!');
      }
    });
  };

  const handleCancelWaiting = (tableId: bigint) => {
    runAction(async () => {
      setLoading(true);
      const signer = getContractSigner();
      await pokerZkService.cancelWaiting(userAddress, tableId, signer);
      setSuccess('Left the waiting queue. Amount refunded.');
      await refreshTables();
    });
  };

  const handleJoinOpenGame = (id: bigint) => {
    runAction(async () => {
      setLoading(true);
      const signer = getContractSigner();
      await pokerZkService.joinGame(userAddress, id, signer);
      setGameId(id);
      await loadGame(id);
      setSuccess('Joined the table');
      setOpenGames((prev) => prev.filter((x) => x.gameId !== id));
    });
  };

  const handleStartNew = () => {
    setGameId(null);
    setGame(null);
    setError(null);
    setSuccess(null);
    if (gameId) try { sessionStorage.removeItem(seedStorageKey(gameId, userAddress)); } catch { /* ignore */ }
    onGameComplete();
  };

  const handleCommitSeed = useCallback(() => {
    if (!gameId || !game) return;
    runAction(async () => {
      setLoading(true);
      const { seed, commitment } = await generateSeedAndCommitment();
      try {
        sessionStorage.setItem(seedStorageKey(gameId!, userAddress), seed.toString('base64'));
      } catch {
        setError('Could not store seed locally');
        return;
      }
      const signer = getContractSigner();
      await pokerZkService.commitSeed(userAddress, gameId, commitment, signer);
      setSuccess('Seed committed');
      // Refetch a cada 2s (até 4 vezes): ledger/RPC podem demorar até mostrar ShuffleReveal
      for (let i = 1; i <= 4; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const g = await loadGame(gameId!);
        const stateNum = g?.state != null ? (normalizeState(g.state) ?? Number(g.state)) : undefined;
        if (stateNum === GameState.ShuffleReveal) break;
        const myCommit = g && (isPlayer1 ? g.seed_commitment1 : g.seed_commitment2);
        if (g && stateNum === GameState.ShuffleCommit && hasCommitment(myCommit)) break;
      }
    });
  }, [gameId, game, userAddress, getContractSigner]);

  const handleRevealSeed = useCallback(() => {
    if (!gameId) return;
    const stored = sessionStorage.getItem(seedStorageKey(gameId, userAddress));
    if (!stored) {
      setError('No seed found. You must commit first from this browser.');
      return;
    }
    runAction(async () => {
      setLoading(true);
      const seed = Buffer.from(stored, 'base64');
      const signer = getContractSigner();
      await pokerZkService.revealSeed(userAddress, gameId, seed, signer);
      await loadGame(gameId);
      setSuccess('Seed revealed');
      try { sessionStorage.removeItem(seedStorageKey(gameId, userAddress)); } catch { /* ignore */ }
    });
  }, [gameId, userAddress, getContractSigner]);

  const handlePostBlinds = useCallback(() => {
    if (!gameId) return;
    runAction(async () => {
      setLoading(true);
      const signer = getContractSigner();
      await pokerZkService.postBlinds(gameId, userAddress, signer);
      await loadGame(gameId);
      setSuccess('Blinds posted');
    });
  }, [gameId, userAddress, getContractSigner]);

  const handleAct = useCallback((action: Action, amount: bigint = 0n) => {
    if (!gameId) return;
    runAction(async () => {
      setLoading(true);
      const signer = getContractSigner();
      await pokerZkService.act(userAddress, gameId, action, amount, null, null, signer);
      await loadGame(gameId);
      setSuccess(`Action: ${Action[action]}`);
      setRaiseAmount('');
    });
  }, [gameId, userAddress, getContractSigner]);

  const isPlayer1 = game != null && String(game.player1 ?? '').trim() === String(userAddress).trim();
  const isPlayer2 = game != null && game.player2 != null && String(game.player2).trim() === String(userAddress).trim();
  const isInGame = isPlayer1 || isPlayer2;
  /** Segurança: só as hole cards do userAddress são derivadas e mostradas; o outro jogador nunca vê a mão do adversário. */
  const myHoleCards = (game != null && isInGame ? getMyHoleCardsFromGame(game, userAddress) : null) ?? null;

  const handleRevealHand = useCallback(() => {
    if (!gameId || !game || myHoleCards == null || myHoleCards.length !== 2) return;
    const board = game.board ?? [];
    const board5 = Array.from({ length: 5 }, (_, i) => (i < board.length ? Number(board[i]) : 0));
    const claimedRank = computeHandRankSimple([myHoleCards[0], myHoleCards[1]], board5);
    const proofStub = Buffer.alloc(32, 0);
    runAction(async () => {
      setLoading(true);
      const signer = getContractSigner();
      await pokerZkService.revealHand(userAddress, gameId, myHoleCards as number[], claimedRank, proofStub, signer);
      await loadGame(gameId);
      setSuccess('Hand revealed');
    });
  }, [gameId, game, myHoleCards, userAddress, getContractSigner]);

  const gameStateNum = game?.state != null ? (normalizeState(game.state) ?? Number(game.state)) : undefined;
  const timeoutableStates = [GameState.ShuffleCommit, GameState.ShuffleReveal, GameState.PreFlop, GameState.FlopBetting, GameState.TurnBetting, GameState.RiverBetting, GameState.Showdown];
  const canClaimTimeout = gameId != null && game != null && isInGame && gameStateNum !== undefined && timeoutableStates.includes(gameStateNum as GameState) && game.state !== GameState.Finished && game.state !== GameState.Cancelled;

  const handleClaimTimeout = useCallback(() => {
    if (!gameId) return;
    runAction(async () => {
      setLoading(true);
      const signer = getContractSigner();
      await pokerZkService.claimTimeout(userAddress, gameId, signer);
      await loadGame(gameId);
      setSuccess('Timeout claimed. You win!');
    });
  }, [gameId, userAddress, getContractSigner]);

  const stateLabel = (state: GameState): string => {
    const labels: Record<GameState, string> = {
      [GameState.WaitingForPlayers]: 'Waiting for P2',
      [GameState.ShuffleCommit]: 'Commit seed',
      [GameState.ShuffleReveal]: 'Reveal seed',
      [GameState.DealCards]: 'Deal',
      [GameState.PreFlop]: 'Pre-flop',
      [GameState.FlopBetting]: 'Flop',
      [GameState.TurnBetting]: 'Turn',
      [GameState.RiverBetting]: 'River',
      [GameState.Showdown]: 'Showdown',
      [GameState.Finished]: 'Finished',
      [GameState.Cancelled]: 'Cancelled',
    };
    return labels[state as GameState] ?? `State ${state}`;
  };

  /** Option::Some(Bytes) do contrato pode vir como Buffer, Uint8Array, ou wrapper { value/some/0 }. */
  const hasBytes = (b: unknown): boolean => {
    if (b == null || b === undefined) return false;
    const o = b as Record<string, unknown>;
    if (typeof o.length === 'number' && o.length > 0) return true;
    const inner = o.value ?? o.some ?? o[0];
    if (inner != null && typeof (inner as { length?: number }).length === 'number' && (inner as Buffer).length > 0) return true;
    return false;
  };
  const hasCommitment = hasBytes;
  const hasReveal = hasBytes;
  const hasHandRank = (opt: unknown): boolean =>
    opt != null && (typeof (opt as { value?: number }).value === 'number' || (typeof opt === 'number' && opt >= 1 && opt <= 10));

  const isShuffleCommit = gameStateNum === GameState.ShuffleCommit;
  const isShuffleReveal = gameStateNum === GameState.ShuffleReveal;
  // Fallback: se get_game devolver state atrasado mas já temos os 2 commitments, o contrato já está em ShuffleReveal
  const bothCommitmentsPresent = game != null && hasCommitment(game.seed_commitment1) && hasCommitment(game.seed_commitment2);
  const effectiveRevealPhase = isShuffleReveal || (isShuffleCommit && bothCommitmentsPresent);

  const needCommit = isShuffleCommit && !bothCommitmentsPresent && isInGame &&
    ((isPlayer1 && !hasCommitment(game.seed_commitment1)) ||
     (isPlayer2 && !hasCommitment(game.seed_commitment2)));
  const needReveal = effectiveRevealPhase && isInGame &&
    ((isPlayer1 && !hasReveal(game!.seed_reveal1)) ||
     (isPlayer2 && !hasReveal(game!.seed_reveal2)));
  const needPostBlinds = gameStateNum === GameState.DealCards && isInGame;
  // Nova mão (2 jogadores): contrato volta a ShuffleCommit sem commitments. Limpar seed local para não revelar o da mão anterior.
  useEffect(() => {
    if (!gameId || !userAddress || !game) return;
    if (gameStateNum !== GameState.ShuffleCommit) return;
    const myCommit = isPlayer1 ? game.seed_commitment1 : game.seed_commitment2;
    const hasVal = myCommit != null && (typeof (myCommit as { value?: unknown }).value !== 'undefined' || (Array.isArray(myCommit) && myCommit.length > 0));
    if (hasVal) return;
    try {
      sessionStorage.removeItem(seedStorageKey(gameId, userAddress));
    } catch { /* ignore */ }
  }, [gameId, userAddress, game?.state, game?.seed_commitment1, game?.seed_commitment2, gameStateNum, isPlayer1]);

  const needRevealHand =
    gameStateNum === GameState.Showdown &&
    isInGame &&
    game != null &&
    myHoleCards != null &&
    ((isPlayer1 && !hasHandRank(game.hand_rank1)) || (isPlayer2 && !hasHandRank(game.hand_rank2)));

  const bettingStates = [GameState.PreFlop, GameState.FlopBetting, GameState.TurnBetting, GameState.RiverBetting];
  const isBettingState = game != null && gameStateNum !== undefined && bettingStates.includes(gameStateNum as GameState);
  const isMyTurn = isBettingState && game && (
    (game.actor === 0 && isPlayer1) || (game.actor === 1 && isPlayer2)
  );
  const minRaise = game?.min_raise != null ? BigInt(String(game.min_raise)) : 0n;
  // to_call: quanto falta igualar (contrato só permite Check quando to_call === 0; se to_call < 0 não pode Check)
  const currentBetP1 = game?.current_bet_p1 != null ? BigInt(String(game.current_bet_p1)) : 0n;
  const currentBetP2 = game?.current_bet_p2 != null ? BigInt(String(game.current_bet_p2)) : 0n;
  const toCall = isPlayer1 ? currentBetP2 - currentBetP1 : currentBetP1 - currentBetP2;
  const canCheck = toCall === 0n;
  const canCall = toCall > 0n;
  // Mínimo total para Raise = aposta do outro + min_raise (contrato espera total da aposta, não só o incremento)
  const currentBetOther = isPlayer1 ? currentBetP2 : currentBetP1;
  const minRaiseTotal = currentBetOther + minRaise;

  // ── 2-player heads-up helpers ──
  /** Endereço do adversário */
  const opponentAddress = isPlayer1
    ? (game?.player2 != null ? String(game.player2) : null)
    : game?.player1 ?? null;
  /** A minha aposta nesta ronda */
  const myBetRound = isPlayer1 ? currentBetP1 : currentBetP2;
  /** A aposta do adversário nesta ronda */
  const oppBetRound = isPlayer1 ? currentBetP2 : currentBetP1;
  /** Total que apostei nesta mão */
  const myTotalBet = isPlayer1
    ? BigInt(String(game?.total_bet_p1 ?? 0))
    : BigInt(String(game?.total_bet_p2 ?? 0));
  /** Total que o adversário apostou nesta mão */
  const oppTotalBet = isPlayer1
    ? BigInt(String(game?.total_bet_p2 ?? 0))
    : BigInt(String(game?.total_bet_p1 ?? 0));
  /** Sou o dealer (dealer_position 0 = P1, 1 = P2) */
  const isMyDealer = game != null && (
    (isPlayer1 && Number(game.dealer_position) === 0) ||
    (isPlayer2 && Number(game.dealer_position) === 1)
  );
  /** É a vez do adversário */
  const isOpponentTurn = isBettingState && !isMyTurn && isInGame;

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [handRanksOpen, setHandRanksOpen] = useState(false);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const handleSendChat = async (message: string): Promise<string | undefined> => {
    if (!gameId) return undefined;
    const signer = await getContractSigner();
    return pokerZkService.sendChat(userAddress, gameId, message, signer);
  };

  return (
    <div className={`poker-screen${gameId ? ' poker-screen-game' : ''}`}>
      {/* Poker Hero — apenas no lobby */}
      {!gameId && (
        <div className="poker-hero">
          <div className="page-wrap poker-hero-inner">
            <div className="poker-title-block">
              <h1>🃏 Poker ZK</h1>
              <div className="poker-tagline">Provably fair · Zero-Knowledge · Stellar Soroban</div>
            </div>
            {onBackToLibrary && (
              <button type="button" className="back-btn" onClick={onBackToLibrary}>← Back to Library</button>
            )}
          </div>
        </div>
      )}

      {/* Erros e avisos — apenas no lobby */}
      {!gameId && error && (
        <div className="page-wrap" style={{ paddingTop: 12 }}>
          <div className="auth-status-bar" style={{ background: '#4a1515', borderColor: 'rgba(255,107,107,0.3)', color: '#ffa0a0' }}>
            <span>{error}</span>
            {error.includes('Account not found') && (() => {
              const addr = (error.match(/Account not found: (G[A-Z0-9]{55})/)?.[1]) || userAddress || '';
              return addr ? (
                <a href={`https://friendbot.stellar.org/?addr=${addr}`} target="_blank" rel="noopener noreferrer" style={{ color: '#a8ffcc' }}>
                  Friendbot
                </a>
              ) : null;
            })()}
          </div>
        </div>
      )}
      {!gameId && success && (
        <div className="page-wrap" style={{ paddingTop: 12 }}>
          <div className="auth-status-bar">
            <span className="auth-status-dot">●</span>
            <span>{success}</span>
          </div>
        </div>
      )}

      {!gameId ? (
        <div className="lobby-wrap">
          {/* ── Lobby Header ── */}
          <div className="lobby-header">
            <div className="lobby-header-left">
              <div className="lobby-icon-wrap">🃏</div>
              <div>
                <h2 className="lobby-title">Poker ZK — Lobby</h2>
                <p className="lobby-sub">Texas Hold'em · Zero-Knowledge · Stellar Testnet</p>
              </div>
            </div>
            <div className="lobby-controls">
              <div className="lobby-buyin-group">
                <label className="lobby-buyin-label">Buy-in (XLM)</label>
                <input
                  className="lobby-buyin-input"
                  type="text"
                  value={mesasBuyIn}
                  onChange={(e) => setMesasBuyIn(e.target.value)}
                  placeholder="1–5"
                />
              </div>
              <button
                type="button"
                className="lobby-refresh-btn"
                onClick={() => { refreshTables(); refreshOpenGames(); }}
                disabled={loadingTables || loadingOpenGames}
                title="Refresh tables"
              >
                {loadingTables || loadingOpenGames ? '⟳' : '↺'} Refresh
              </button>
            </div>
          </div>

          {/* ── Info hint ── */}
          <div className="lobby-hint">
            <span className="lobby-hint-icon">ℹ</span>
            <span>
              <strong>P1</strong> sits first · <strong>P2</strong> joins after.
              Use the player switch in the top corner to toggle.
            </span>
          </div>

          {/* ── Tables grid ── */}
          <div className="lobby-section-title">
            <span>Available tables</span>
            <span className="lobby-section-count">{tables.length} table{tables.length !== 1 ? 's' : ''}</span>
          </div>

          {tables.length === 0 && !loadingTables && (
            <div className="lobby-empty">
              <span>🎴</span>
              {!POKER_ZK_CONTRACT || POKER_ZK_CONTRACT.trim() === '' ? (
                <>
                  <p>Contract not configured.</p>
                  <p className="lobby-empty-hint">Set <code>VITE_POKER_ZK_CONTRACT_ID</code> in your environment and redeploy.</p>
                </>
              ) : (
                <>
                  <p>No tables found or contract not deployed.</p>
                  <p className="lobby-empty-hint">Ensure the contract is deployed on this network (e.g. Testnet) and <code>VITE_SOROBAN_RPC_URL</code> points to the same network.</p>
                </>
              )}
              <div className="lobby-empty-debug" aria-hidden="true">
                <p>Contract: {POKER_ZK_CONTRACT ? `${POKER_ZK_CONTRACT.slice(0, 8)}…${POKER_ZK_CONTRACT.slice(-4)}` : '(not set)'}</p>
                <p>RPC: {RPC_URL ? new URL(RPC_URL).hostname : '(default)'}</p>
                {tablesLoadError && <p className="lobby-empty-err">Error: {tablesLoadError}</p>}
              </div>
            </div>
          )}

          <div className="lobby-tables-grid">
            {tables.map(({ tableId, table, waiting }) => {
              const sb = Number(table.small_blind ?? 0) / STROOPS_PER_XLM;
              const bb = Number(table.big_blind ?? 0) / STROOPS_PER_XLM;
              const minB = Number(table.min_buy_in ?? 0) / STROOPS_PER_XLM;
              const maxB = Number(table.max_buy_in ?? 0) / STROOPS_PER_XLM;
              const buyInAmount = parseBuyIn(mesasBuyIn) ?? 0n;
              const waitingP1 = (waiting as { player1?: string } | null)?.player1?.trim().toUpperCase();
              const meUpper = userAddress.trim().toUpperCase();
              const isCurrentUserWaitingP1 = waiting != null && waitingP1 != null && meUpper === waitingP1;
              const canSit = buyInAmount >= (table.min_buy_in ?? 0n) && buyInAmount <= (table.max_buy_in ?? 0n) && !isCurrentUserWaitingP1;
              const hasWaiting = waiting != null;

              return (
                <div key={tableId.toString()} className={`ltc ${hasWaiting ? 'ltc-has-player' : ''}`}>
                  {/* Felt oval visual */}
                  <div className="ltc-felt">
                    <div className="ltc-felt-inner">
                      {/* Top seat (P1 / opponent) */}
                      <div className="ltc-seat ltc-seat-top">
                        {hasWaiting ? (
                          <div className="ltc-player-badge">
                            <span className="ltc-avatar">🤠</span>
                            <span className="ltc-player-tag">P1</span>
                          </div>
                        ) : (
                          <div className="ltc-empty-seat">OPEN</div>
                        )}
                      </div>
                      {/* Pot center */}
                      <div className="ltc-pot-center">
                        <span className="ltc-pot-chip" />
                        <span className="ltc-pot-label">{minB}–{maxB}<br/>XLM</span>
                      </div>
                      {/* Bottom seat (me) */}
                      <div className="ltc-seat ltc-seat-bottom">
                        <div className="ltc-empty-seat ltc-empty-me">YOU</div>
                      </div>
                    </div>
                    {/* Dealer button */}
                    <div className="ltc-d-btn">D</div>
                  </div>

                  {/* Info */}
                  <div className="ltc-info">
                    <div className="ltc-table-name">Table {tableId.toString()}</div>
                    <div className="ltc-blinds">
                      <span className="ltc-blind-pill">SB {sb}</span>
                      <span className="ltc-blind-pill">BB {bb}</span>
                    </div>
                    <div className="ltc-seats-row">
                      <span className={`ltc-seat-dot ${hasWaiting ? 'ltc-dot-on' : ''}`} />
                      <span className={`ltc-seat-dot ${hasWaiting ? 'ltc-dot-on' : ''}`} />
                      <span className="ltc-seats-txt">{hasWaiting ? '1 / 2' : '0 / 2'} players</span>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="ltc-cta">
                    {isCurrentUserWaitingP1 ? (
                      <div className="ltc-waiting-state">
                        <p className="ltc-waiting-msg">Waiting for P2…</p>
                        <button
                          type="button"
                          className="ltc-leave-btn"
                          disabled={isBusy}
                          onClick={() => handleCancelWaiting(tableId)}
                        >
                          Leave queue
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ltc-sit-btn"
                        disabled={!canSit || isBusy}
                        onClick={() => handleSitAtTable(tableId, buyInAmount)}
                      >
                        {hasWaiting ? 'Join as P2 →' : 'Sit down →'}
                      </button>
                    )}
                    {hasWaiting && !isCurrentUserWaitingP1 && (
                      <span className="ltc-badge-waiting">● Waiting for P2</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Create game ── */}
          <div className="lobby-create-section">
            <div className="lobby-create-left">
              <div className="lobby-create-icon">🎲</div>
              <div>
                <div className="lobby-create-title">Create new table</div>
                <div className="lobby-create-sub">Wait for a second player</div>
              </div>
            </div>
            <button
              type="button"
              className="lobby-create-btn"
              disabled={isBusy || !parseBuyIn(mesasBuyIn)}
              onClick={() => handleCreateGame(0n)}
            >
              Create game at table 0
            </button>
          </div>

          {/* ── Open games ── */}
          {openGames.length > 0 && (
            <>
              <div className="lobby-section-title" style={{ marginTop: 32 }}>
                <span>Open games (join as P2)</span>
                <span className="lobby-section-count">{openGames.length}</span>
              </div>
              <div className="lobby-open-games">
                {openGames.map(({ gameId: id, game: g }) => (
                  <div key={id.toString()} className="log-row">
                    <div className="log-info">
                      <span className="log-id">#{id.toString()}</span>
                      <span className="log-buyin">{Number(g?.buy_in ?? 0) / STROOPS_PER_XLM} XLM</span>
                      <span className="log-status">● Waiting for P2</span>
                    </div>
                    <button
                      type="button"
                      className="ltc-sit-btn"
                      style={{ padding: '8px 20px' }}
                      disabled={isBusy}
                      onClick={() => handleJoinOpenGame(id)}
                    >
                      Join →
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {openGames.length === 0 && !loadingOpenGames && (
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16, textAlign: 'center' }}>
              No open games waiting.
            </div>
          )}
        </div>
      ) : (
        <>
        {/* ═══════════════════════════════════════════
            POKER VIEW
            ═══════════════════════════════════════════ */}
        <div className="pv-wrap">

          {/* ── Top bar ── */}
          <div className="pv-topbar">
            <div className="pv-topbar-left">
              <span className="pv-topbar-title">🃏 Poker ZK</span>
              {game && (
                <span className="pv-blinds-pill">
                  Blinds <strong>{Number(game.small_blind)/STROOPS_PER_XLM}/{Number(game.big_blind)/STROOPS_PER_XLM}</strong>
                </span>
              )}
              <span className="pv-session">#{gameId?.toString()}</span>
              {error && <span className="pv-topbar-error">⚠ {error}</span>}
              {success && <span className="pv-topbar-success">✓ {success}</span>}
            </div>
            <div className="pv-topbar-right">
              <button type="button" className="pv-leave-btn" onClick={handleStartNew}>↺ New hand</button>
              {onBackToLibrary && (
                <button type="button" className="pv-leave-btn" onClick={onBackToLibrary}>← Library</button>
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════
              SCENE — centrado verticalmente
              ════════════════════════════════════════ */}
          <div className="pv-scene">

            {/* ── Panel toggle buttons — top corners ── */}
            <button
              type="button"
              className={`pv-corner-btn pv-corner-btn-left${chatOpen ? ' active' : ''}`}
              onClick={() => setChatOpen(o => !o)}
              title="Table chat"
            >💬 Chat</button>
            <button
              type="button"
              className={`pv-corner-btn pv-corner-btn-right${historyOpen ? ' active' : ''}`}
              onClick={() => setHistoryOpen(o => !o)}
              title="Blockchain history"
            >⛓ History</button>

            {/* ── Adversário: avatar + info ── */}
            <div className="pv-opp-hud">
              <div className={`pv-opp-avatar${isOpponentTurn ? ' pv-turn' : ''}`}>
                {isPlayer1 ? '🤖' : '🤠'}
                {isOpponentTurn && <span className="pv-turn-ring" />}
              </div>
              <div className="pv-opp-details">
                <div className="pv-player-name">
                  {opponentAddress ? `${opponentAddress.slice(0, 10)}…` : (isPlayer1 ? 'P2' : 'P1')}
                  <span className="pv-badge">{isPlayer1 ? 'P2' : 'P1'}</span>
                  {isMyDealer
                    ? <span className="pv-blind pv-blind-bb">BB</span>
                    : <span className="pv-blind pv-blind-sb">SB</span>
                  }
                </div>
                <div className="pv-player-chips">
                  {((Number(game?.buy_in ?? 0n) - Number(oppTotalBet)) / STROOPS_PER_XLM).toFixed(2)} XLM
                </div>
              </div>
              {oppBetRound > 0n && (
                <div className="pv-bet-display">
                  <span className="pv-bet-chip-ico" />
                  {(Number(oppBetRound)/STROOPS_PER_XLM).toFixed(4)} XLM
                </div>
              )}
            </div>

            {/* ── Mesa oval — cartas DENTRO da felt ── */}
            <div className="pv-oval">

              {/* Cartas do adversário — topo da felt */}
              <div className="pv-opp-cards">
                <div className="pv-cback pv-cback-l" />
                <div className="pv-cback pv-cback-r" />
              </div>

              {/* Botão D — dentro do oval, perto das cartas do dealer (sem encostar) */}
              {game != null && (
                <div className={`pv-d-puck ${isMyDealer ? 'pv-d-puck-me' : 'pv-d-puck-opp'}`}>D</div>
              )}

              {/* Ícone hand ranks — duas cartas + ! — dentro da mesa */}
              <button type="button" className="pv-info-btn" onClick={() => setHandRanksOpen(true)}>
                <span className="pv-info-card pv-info-card-a" />
                <span className="pv-info-card pv-info-card-b">!</span>
              </button>

              {/* Pot — só aparece a partir do PreFlop (apostas reais) */}
              {game && Number(game.pot ?? 0) > 0 &&
               (isBettingState || gameStateNum === GameState.Showdown || gameStateNum === GameState.Finished) && (
                <div className="pv-pot">
                  <div className="pv-pot-chips">
                    <span className="mc" style={{ background: 'conic-gradient(#7b2d8b 0% 50%,#fff 50% 55%,#7b2d8b 55%)' }} />
                    <span className="mc" style={{ background: 'conic-gradient(#1a8b7b 0% 50%,#fff 50% 55%,#1a8b7b 55%)' }} />
                    <span className="mc" style={{ background: 'conic-gradient(#1a5faf 0% 50%,#fff 50% 55%,#1a5faf 55%)' }} />
                  </div>
                  <div className="pv-pot-label">{(Number(game.pot)/STROOPS_PER_XLM).toFixed(2)} XLM</div>
                </div>
              )}

              {/* Cartas comunitárias */}
              <div className="pv-community">
                {game?.board?.slice(0, Number(game.board_revealed ?? 0)).map((c, i) => {
                  const n = Number(c);
                  const rank = n % 13 === 0 ? 'A' : n % 13 > 9 ? ['T','J','Q','K'][n % 13 - 10] : String((n % 13) + 1);
                  const suit = ['♠','♣','♥','♦'][Math.floor(n / 13) % 4];
                  const isRed = suit === '♥' || suit === '♦';
                  return (
                    <div key={i} className={`pv-card ${isRed ? 'red' : 'blk'}`}>
                      <span className="pvc-r">{rank}</span>
                      <span className="pvc-s">{suit}</span>
                    </div>
                  );
                })}
              </div>

              {/* Minhas cartas — fundo da felt */}
              <div className="pv-my-cards">
                {needCommit && (
                  <>
                    <div className="pv-cback pv-cback-l" />
                    <div className="pv-cback pv-cback-r" />
                  </>
                )}
                {!needCommit && myHoleCards != null && myHoleCards.length === 2 && (
                  myHoleCards.map((c, i) => {
                    const { rank, suit, isRed } = cardToRankSuit(c);
                    return (
                      <div key={i} className={`pv-card pv-card-lg ${isRed ? 'red' : 'blk'}`}
                           style={{ transform: i === 0 ? 'rotate(-5deg)' : 'rotate(5deg)' }}>
                        <span className="pvc-r">{rank}</span>
                        <span className="pvc-s">{suit}</span>
                      </div>
                    );
                  })
                )}
                {!needCommit && myHoleCards == null && game && ((isPlayer1 && game.hand_commitment1) || (isPlayer2 && game.hand_commitment2)) && (
                  <>
                    <div className="pv-cback pv-cback-l" />
                    <div className="pv-cback pv-cback-r" />
                  </>
                )}
              </div>

            </div>{/* /pv-oval */}

            {/* ── Eu: avatar + info ── */}
            <div className="pv-me-hud">
              <div className={`pv-me-avatar${isMyTurn ? ' pv-turn' : ''}`}>
                🤠
                {isMyTurn && <span className="pv-turn-ring" />}
              </div>
              <div className="pv-me-details">
                <div className="pv-player-name">
                  {userAddress.slice(0, 10)}…
                  <span className="pv-badge pv-badge-me">P{isPlayer1 ? 1 : 2}</span>
                  {isMyDealer
                    ? <span className="pv-blind pv-blind-sb">SB</span>
                    : <span className="pv-blind pv-blind-bb">BB</span>
                  }
                </div>
                <div className="pv-player-chips">
                  {((Number(game?.buy_in ?? 0n) - Number(myTotalBet)) / STROOPS_PER_XLM).toFixed(2)} XLM
                </div>
              </div>
              {myBetRound > 0n && (
                <div className="pv-bet-display">
                  <span className="pv-bet-chip-ico" />
                  {(Number(myBetRound)/STROOPS_PER_XLM).toFixed(4)} XLM
                </div>
              )}
            </div>

          </div>{/* /pv-scene */}

          {/* ── Side panels ── */}
          {chatOpen && (
            <ChatPanel
              onClose={() => setChatOpen(false)}
              userAddress={userAddress}
              gameId={gameId ?? null}
              onSend={handleSendChat}
            />
          )}
          {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}

          {/* ── ACTIONS ── */}
          <div className="pv-actions">
            {/* Seed / reveal phase */}
            {(needCommit || needReveal) && (
              <div className="pv-act-row">
                {needCommit && <button type="button" className="pv-btn pv-btn-check" onClick={handleCommitSeed} disabled={isBusy}>🔒 Commit Seed</button>}
                {needReveal && <button type="button" className="pv-btn pv-btn-call" onClick={handleRevealSeed} disabled={isBusy}>🔓 Reveal Seed</button>}
                <button type="button" className="pv-btn pv-btn-muted" onClick={() => gameId && loadGame(gameId)} disabled={isBusy}>↺</button>
                {canClaimTimeout && <button type="button" className="pv-btn pv-btn-fold" onClick={handleClaimTimeout} disabled={isBusy}>⏱ Timeout</button>}
                {needCommit && gameId && sessionStorage.getItem(seedStorageKey(gameId, userAddress)) && (
                  <span className="pv-status-txt">Waiting for opponent…</span>
                )}
              </div>
            )}

            {/* Post blinds */}
            {needPostBlinds && (
              <div className="pv-act-row">
                <button type="button" className="pv-btn pv-btn-raise" onClick={handlePostBlinds} disabled={isBusy}>Post Blinds</button>
              </div>
            )}

            {/* Reveal hand at showdown */}
            {needRevealHand && (
              <div className="pv-act-row">
                <button type="button" className="pv-btn pv-btn-raise" onClick={handleRevealHand} disabled={isBusy}>🎴 Reveal Hand</button>
                <button type="button" className="pv-btn pv-btn-muted" onClick={() => gameId && loadGame(gameId)} disabled={isBusy}>↺</button>
              </div>
            )}

            {/* Waiting for opponent to reveal */}
            {gameStateNum === GameState.Showdown && isInGame && !needRevealHand && game != null && hasHandRank(isPlayer1 ? game.hand_rank1 : game.hand_rank2) && (
              <div className="pv-act-row">
                <span className="pv-status-txt">⏳ Waiting for opponent to reveal…</span>
                <button type="button" className="pv-btn pv-btn-muted" onClick={() => gameId && loadGame(gameId)} disabled={isBusy}>↺</button>
                {canClaimTimeout && <button type="button" className="pv-btn pv-btn-fold" onClick={handleClaimTimeout} disabled={isBusy}>⏱</button>}
              </div>
            )}

            {/* My turn to bet */}
            {isMyTurn && (
              <div className="pv-act-row">
                <button type="button" className="pv-btn pv-btn-fold" onClick={() => handleAct(Action.Fold)} disabled={isBusy}>FOLD</button>
                {canCheck && <button type="button" className="pv-btn pv-btn-check" onClick={() => handleAct(Action.Check)} disabled={isBusy}>CHECK</button>}
                {canCall && (
                  <button type="button" className="pv-btn pv-btn-call" onClick={() => handleAct(Action.Call, 0n)} disabled={isBusy}>
                    CALL {toCall > 0n ? (Number(toCall)/STROOPS_PER_XLM).toFixed(4) : ''}
                  </button>
                )}
                <div className="pv-raise-group">
                  <input
                    type="text" inputMode="decimal"
                    value={raiseAmount}
                    onChange={(e) => setRaiseAmount(e.target.value)}
                    placeholder={String(Number(minRaiseTotal)/STROOPS_PER_XLM)}
                    className="pv-raise-input"
                    aria-label="Total bet amount in XLM"
                  />
                  <button type="button" className="pv-btn pv-btn-raise" onClick={() => {
                    const xlm = raiseAmount ? parseFloat(raiseAmount) : NaN;
                    const totalStroops = !Number.isNaN(xlm) && xlm > 0 ? BigInt(Math.round(xlm * STROOPS_PER_XLM)) : minRaiseTotal;
                    handleAct(Action.Raise, totalStroops);
                  }} disabled={isBusy}>RAISE</button>
                </div>
              </div>
            )}

            {/* Opponent's turn */}
            {isBettingState && !isMyTurn && isInGame && (
              <div className="pv-act-row">
                <span className="pv-status-txt">⏳ Opponent's turn…</span>
                <button type="button" className="pv-btn pv-btn-muted" onClick={() => gameId && loadGame(gameId)} disabled={isBusy}>↺</button>
                {canClaimTimeout && <button type="button" className="pv-btn pv-btn-fold" onClick={handleClaimTimeout} disabled={isBusy}>⏱ Timeout</button>}
              </div>
            )}

            {/* Game finished */}
            {game?.state === GameState.Finished && (
              <div className="pv-act-row">
                <button type="button" className="pv-btn pv-btn-raise" onClick={() => { onStandingsRefresh(); onGameComplete(); }}>Next hand →</button>
              </div>
            )}
          </div>

        </div>
        </>
      )}

      {/* Tournament Modal (Sit & Go) */}
      <div className={`modal-overlay ${tournModalOpen ? 'open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) setTournModalOpen(false); }} role="presentation">
        <div className="tourn-modal" onClick={(e) => e.stopPropagation()}>
          <div className="tourn-header">
            <h2>🏇 Sit & Go Tournament</h2>
            <div className="tourn-close" onClick={() => setTournModalOpen(false)}>✕</div>
          </div>
          <div className="tourn-body">
            <div className="tourn-badge-row">
              <div className="tourn-badge-title">Sit & Go Tournament &apos;Horseshoe Arena&apos;</div>
              <div className="badge-icons">
                <div className="badge-icon active">🥉</div>
                <div className="badge-icon inactive">🥈</div>
                <div className="badge-icon inactive">🥇</div>
                <div className="badge-icon inactive">🏆</div>
                <div className="badge-icon inactive">👑</div>
              </div>
              <div className="badge-progress">
                <span className="prog-pill">0 / 2</span>
                Win 2 more times to get the <strong style={{ color: 'var(--gold-light)' }}>BRONZE</strong> badge!
              </div>
            </div>
            <div className="tourn-prize-row">
              <div className="prize-1st">
                <span>1st Place:</span>
                <span className="chip-icon">🟠</span>
                <span>35,000</span>
              </div>
              <div className="prize-2nd">2nd Place: 10,000 chips</div>
            </div>
            <div className="tourn-info-grid">
              <div className="ti-cell">
                <div className="ti-label">Blinds Start</div>
                <div className="ti-value">50 / 100</div>
              </div>
              <div className="ti-cell">
                <div className="ti-label">Blind Levels</div>
                <div className="ti-value">1 Minute</div>
              </div>
              <div className="ti-cell">
                <div className="ti-label">Starting Chips</div>
                <div className="ti-value">3,000</div>
              </div>
            </div>
            <div className="buyin-row">
              <span className="buyin-chip">🟠</span>
              <span>Buy-in: 10K</span>
            </div>
            <button type="button" className="play-now-btn" onClick={() => { setTournModalOpen(false); setWaitingOpen(true); setTimeout(() => setWaitingOpen(false), 4000); }}>PLAY NOW</button>
          </div>
        </div>
      </div>

      {/* Waiting for Players overlay */}
      <div className={`waiting-overlay ${waitingOpen ? 'show' : ''}`}>
        <div className="waiting-box">
          <div className="waiting-header">
            <h3>Waiting for Players to Join</h3>
            <div className="waiting-close" onClick={() => setWaitingOpen(false)}>✕</div>
          </div>
          <div className="waiting-body">
            <div className="players-slots">
              <div className="player-slot">
                <div className="slot-avatar filled">🤠</div>
                <div className="slot-name">{userAddress.slice(0, 10)}…</div>
              </div>
              <div className="player-slot">
                <div className="slot-avatar empty" />
                <div className="slot-empty-name">---</div>
              </div>
              <div className="player-slot">
                <div className="slot-avatar empty" />
                <div className="slot-empty-name">---</div>
              </div>
              <div className="player-slot">
                <div className="slot-avatar empty" />
                <div className="slot-empty-name">---</div>
              </div>
              <div className="player-slot">
                <div className="slot-avatar empty" />
                <div className="slot-empty-name">---</div>
              </div>
            </div>
            <div className="waiting-timer-row">
              <div className="timer-pill">0:00</div>
              <div className="avg-wait">Average waiting time 0:10</div>
            </div>
            <div className="waiting-spinner">
              <div className="spinner-ring" />
              <div className="spinner-text">Searching for players...</div>
            </div>
          </div>
        </div>
      </div>

      {/* Hand Ranks Modal */}
      <div className={`modal-overlay ${handRanksOpen ? 'open' : ''}`} onClick={() => setHandRanksOpen(false)} role="presentation">
        <div className="handranks-modal" onClick={(e) => e.stopPropagation()}>
          <div className="hr-header">
            <div className="hr-info-icon">i</div>
            <div className="hr-header-inner">
              <div>
                <h2 className="hr-title">HAND RANKS</h2>
                <p className="hr-sub">The best 5 cards make the winning hand</p>
              </div>
            </div>
            <button type="button" className="hr-close" onClick={() => setHandRanksOpen(false)}>✕</button>
          </div>
          <div className="hr-body">
            <div className="hr-col">
              {([
                { n:1,  name:'Royal Flush',     color:'#f5c400', cards:[['A','♥','r'],['K','♥','r'],['Q','♥','r'],['J','♥','r'],['10','♥','r']] },
                { n:2,  name:'Straight Flush',  color:'#e91e8c', cards:[['9','♦','r'],['8','♦','r'],['7','♦','r'],['6','♦','r'],['5','♦','r']] },
                { n:3,  name:'Four of a Kind',  color:'#e91e8c', cards:[['A','♥','r'],['A','♣','b'],['A','♦','r'],['A','♠','b'],['8','♣','d']] },
                { n:4,  name:'Full House',      color:'#ff8c00', cards:[['K','♣','b'],['K','♥','r'],['K','♠','b'],['J','♥','r'],['J','♦','r']] },
                { n:5,  name:'Flush',           color:'#f5c400', cards:[['A','♠','b'],['10','♠','b'],['7','♠','b'],['6','♠','b'],['3','♠','b']] },
              ] as const).map(hand => (
                <div key={hand.n} className="hr-row">
                  <div className="hr-info">
                    <span className="hr-num">{hand.n}</span>
                    <span className="hr-name" style={{ color: hand.color }}>{hand.name}</span>
                  </div>
                  <div className="hr-cards">
                    {hand.cards.map(([rank, suit, c], i) => (
                      <div key={i} className={`mini-card mc-${c}`}>
                        <span className="mc-rank">{rank}</span>
                        <span className="mc-suit">{suit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="hr-divider" />
            <div className="hr-col">
              {([
                { n:6,  name:'Straight',        color:'#1ab59a', cards:[['6','♠','b'],['5','♦','r'],['4','♦','r'],['3','♣','b'],['2','♥','r']] },
                { n:7,  name:'Three of a Kind', color:'#29b6f6', cards:[['A','♣','b'],['A','♦','r'],['A','♠','b'],['Q','♣','d'],['10','♦','d']] },
                { n:8,  name:'Two Pair',        color:'#5c6bc0', cards:[['K','♥','r'],['K','♣','b'],['10','♦','r'],['10','♥','r'],['4','♠','d']] },
                { n:9,  name:'Pair',            color:'#29b6f6', cards:[['J','♦','r'],['J','♣','b'],['K','♣','d'],['9','♠','d'],['3','♦','d']] },
                { n:10, name:'High Card',       color:'#9e9e9e', cards:[['A','♥','r'],['Q','♦','d'],['10','♦','d'],['4','♠','d'],['3','♣','d']] },
              ] as const).map(hand => (
                <div key={hand.n} className="hr-row">
                  <div className="hr-info">
                    <span className="hr-num">{hand.n}</span>
                    <span className="hr-name" style={{ color: hand.color }}>{hand.name}</span>
                  </div>
                  <div className="hr-cards">
                    {hand.cards.map(([rank, suit, c], i) => (
                      <div key={i} className={`mini-card mc-${c}`}>
                        <span className="mc-rank">{rank}</span>
                        <span className="mc-suit">{suit}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg ?? ''}</div>
    </div>
  );
}
