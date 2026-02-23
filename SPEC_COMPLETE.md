# Complete spec for development start

**Document that closes the 10 pending specification items.**

---

## 1. Game Hub: when and where to call

### Decision

| Call | Where | When | Parameters |
|------|-------|------|------------|
| **start_game** | In **join_game()** | As soon as P2 joins (both at the table) | `game_id` = `env.current_contract_address()`, `session_id` = game id (u32), `player1`, `player2`, `player1_points` = 0, `player2_points` = 0 |
| **end_game** | After **payout** | Whenever the hand ends (fold or showdown) | `session_id` = game id (u32), `player1_won` = true if P1 won |

Do **not** call start_game in create_game (only when both players are in).

**Alignment:** CONTRACTS_SPEC §2.2. Constructor/init must store Admin + GameHub in instance storage. Call `game_hub.start_game` before persisting the game (in join_game); call `game_hub.end_game` before finalizing the winner. Use temporary storage and extend_ttl (30 days) on every write. Deterministic randomness (PRNG with derived seed). See [Stellar Game Studio](https://github.com/jamesbachini/Stellar-Game-Studio) AGENTS.md for reference.

**Where to update:** CONTRACTS_SPEC §2.5.2 (create_game does not call Hub), §2.5.3 (join_game calls notify_game_start), §2.5.6 Fold (notify_game_end), §2.5.7 reveal_hand (notify_game_end), §2.5.8 claim_timeout (notify_game_end). Always use `session_id: u32` and `player1_won: bool`; internal game id may be u64 with cast to u32 when calling the Hub.

---

## 2. act() — round details and action order

### When the round is "matched"

- **Condition:** `current_bet_p1 == current_bet_p2` **and** the next to act has already "matched" (i.e. just did Check or Call and it is back to the first to act in the round).
- **Implementation:** after each Check/Call/Raise, swap `actor` (0↔1). When, after that swap, `current_bet_p1 == current_bet_p2`, consider the round matched: zero `current_bet_p1` and `current_bet_p2`, increment `board_revealed` (0→3, 3→4, 4→5), advance state (PreFlop→Flop, FlopBetting→Turn, etc.) and set `actor` = dealer (heads-up: dealer_position 0 ⇒ actor 0, dealer_position 1 ⇒ actor 1).

### Action order (heads-up)

- **PreFlop:** Big Blind acts first (dealer_position 0 ⇒ P1 is SB, P2 is BB ⇒ actor 1 = P2).
- **Flop, Turn, River:** Dealer (Small Blind) acts first: dealer_position 0 ⇒ actor 0 = P1.

### Minimal sequence example (PreFlop)

1. State: PreFlop, pot = SB+BB, current_bet_p1 = SB, current_bet_p2 = BB, actor = 1 (P2).
2. P2 act(Check) → to_call = 0, allowed. actor → 0. current_bet_p1 == current_bet_p2? No (SB ≠ BB). End of turn.
3. P1 act(Call) → to_call = BB - SB. Lock BB-SB, pot updated. actor → 1. current_bet_p1 == current_bet_p2? Yes. Round matched → board_revealed = 3, state = FlopBetting, actor = dealer (0).

**Where to update:** CONTRACTS_SPEC §2.5.6 (text before/after act code) and GAME_FLOW §6.

---

## 3. Board in the contract

### Decision

- **Storage:** The **full board (5 cards)** is derived in **reveal_seed** (when computing `final_seed`) and stored in `game.board` (Vec<u8> of size 5). Do not store "only the revealed ones".
- **Progressive revelation:** Only the field `game.board_revealed` (0, 3, 4 or 5) indicates how many cards are "public" in that phase. Frontend and contract use `board[0 .. board_revealed]` for display and for proof publics.
- **derive_board_cards:** Returns the 5 cards in the correct order (indices 0–4 of the deck derived from the seed). The contract persists these 5 in `game.board` once when leaving ShuffleReveal for DealCards (or PostBlinds).

**Where to update:** CONTRACTS_SPEC §2.4 (Game struct), §2.5.4 (reveal_seed: set board and board_revealed = 0), §2.6 (derive_board_cards) and GAME_FLOW §4 (deal cards).

---

## 4. Proof required per action

### Single rule

- **Proof (hand_validator) + commitment required** when:
  - It is the **player's first action in the hand** (first time that player calls `act` in that game session), **or**
  - The action is **Raise** (any raise, even if proof was already sent before).
- **Proof/commitment optional** when:
  - Action is **Check** or **Call** and the player **has already** sent proof+commitment in a previous action in the same hand (contract already has hand_commitment for that player).

The contract keeps `hand_commitment1` and `hand_commitment2`; when receiving act(Raise) or act(Call/Check) for the first time from a player, it requires proof and commitment and stores the commitment. On subsequent Call/Check, it does not require a new proof.

**Where to update:** CONTRACTS_SPEC §2.5.6 (act) and GAME_FLOW §6.2.

---

## 5. CIRCUITS_SPEC — board always 5 cards

### Convention

- **hand_validator** and **hand_ranker** always receive **board as an array of 5 elements** (public).
- In rounds where only part of the board is revealed (PreFlop 0, Flop 3, Turn 4), the **contract** builds the public array as follows:
  - Already revealed positions: real values from `game.board[0..board_revealed]`.
  - Not yet revealed positions: use a sentinel value (e.g. 0) or the seed hash to keep fixed size; the circuit must accept that those positions "don't count" for duplicate constraints (e.g. only check hole vs board[0..board_revealed] in practice). Simpler alternative: **always pass the 5 cards**; in PreFlop the contract already has all 5 in `game.board` and can expose all 5 as public (board is already defined, only the UI does not show them). Recommendation: **always pass the 5 board cards**; the frontend sends all 5 in all rounds (derived from the same seed). Thus the circuit keeps board: pub [u8; 5] with no change.

**Final decision:** Board in the circuit is always **5 cards**. The contract and frontend derive the full board after reveal_seed; in act() and reveal_hand() calls they always use the same 5-card board. No change needed in CIRCUITS_SPEC beyond documenting this.

**Where to update:** CIRCUITS_SPEC §1 or §2: add note "Public board: always 5 cards; derived from same seed after reveal; used in all rounds."

---

## 6. Table configuration (SB/BB and buy-in)

### Decision

- **Blinds:** Only in **GameConfig** (set in **initialize**). Fields `small_blind` and `big_blind` (i128). No per-game blind parameter in create_game.
- **Buy-in:** Parameter of **create_game(player, buy_in)**. It is the initial stack per player (each locks buy_in when creating/joining). Limits come from config: min_buy_in, max_buy_in.
- **Summary:** One table = one global config (SB, BB, rake, timeouts, treasury, game_hub). Each game uses that config; only buy_in varies per create_game.

**Where to update:** CONTRACTS_SPEC §2.4 (GameConfig) and §2.5.1 (create_game: validate buy_in against config; do not accept SB/BB).

---

## 7. Timeout per phase

### Table

| Phase | Timeout (seconds) | Who can claim | Result on claim_timeout |
|-------|-------------------|---------------|-------------------------|
| ShuffleCommit | config.reveal_timeout (e.g. 300) | Anyone | Player who did not commit loses; the other wins the pot (other's stakes) |
| ShuffleReveal | config.reveal_timeout | Anyone | Player who did not reveal loses; the other wins |
| PostBlinds | (optional: same reveal_timeout) | — | If implemented: consider cancel + refund |
| PreFlop, FlopBetting, TurnBetting, RiverBetting | config.bet_timeout (e.g. 300) | Anyone | Player who did not act loses the hand; the other wins the pot |
| Showdown | config.bet_timeout | Anyone | Player who did not reveal loses; the other wins |

**claim_timeout result:** Whenever applicable: `game.winner` = player who acted; `game.state` = Finished (or Cancelled, as preferred); payout to the "honest" player; call **notify_game_end(session_id, player1_won)**.

**Where to update:** CONTRACTS_SPEC §2.5.8 and new subsection "Timeout per phase" with this table; update determine_non_acting_player for PreFlop, FlopBetting, TurnBetting, RiverBetting states (who is the pending actor).

---

## 8. Error codes and messages for the frontend

### Stable list (contract)

| Code | Name | When | Suggested message (frontend) |
|------|------|------|-----------------------------|
| 100 | InvalidState | State does not allow the action | "Action not allowed at this time." |
| 101 | GameNotFound | game_id does not exist | "Game not found." |
| 102 | GameFull | P2 already joined | "Table full." |
| 103 | GameAlreadyFinished | Game already finished | "Game already ended." |
| 104 | GameCancelled | Game cancelled (timeout) | "Game cancelled." |
| 105 | NotPlayer | Address is not P1 or P2 | "You are not a player at this table." |
| 106 | CannotPlaySelf | P1 tries to play against self | "Cannot play against yourself." |
| 107 | NotYourTurn | act() out of turn | "Not your turn." |
| 108 | GameAlreadyDecided | act() after fold | "Hand already decided (fold)." |
| 200 | BuyInTooLow | buy_in < config.min_buy_in | "Buy-in below minimum." |
| 201 | BuyInTooHigh | buy_in > config.max_buy_in | "Buy-in above maximum." |
| 202 | InvalidAmount | Invalid value (e.g. call 0) | "Invalid bet amount." |
| 203 | InsufficientFunds | Insufficient balance/escrow | "Insufficient funds." |
| 204 | AlreadyBet | (legacy; may remove if using act) | "Bet already recorded." |
| 205 | MustCallOrRaise | Check when to_call > 0 | "You must call or raise." |
| 206 | RaiseTooSmall | Raise < min_raise | "Raise below minimum." |
| 300 | AlreadyCommitted | duplicate commit_seed | "Seed already committed." |
| 301 | AlreadyRevealed | duplicate reveal_seed | "Seed already revealed." |
| 302 | InvalidSeed | hash(seed) != commitment | "Seed does not match commitment." |
| 303 | InvalidCommitment | commitment does not match cards | "Invalid commitment." |
| 400 | InvalidProof | Proof verification failed | "Invalid ZK proof." |
| 401 | InvalidInputs | public_inputs wrong size | "Invalid proof inputs." |
| 402 | VerificationFailed | (verifier) | "Verification failed." |
| 500 | InvalidCards | hole_cards.len() != 2 etc. | "Invalid cards." |
| 501 | InvalidRank | claimed_rank outside 1..10 | "Invalid rank." |
| 502 | DuplicateCards | (if applicable) | "Duplicate cards." |
| 600 | TimeoutNotReached | claim_timeout before time | "Timeout not yet reached." |
| 601 | NoTimeoutApplicable | State has no timeout | "Timeout not applicable." |
| 109 | ConfigNotSet | Config not initialized | "Contract not configured." |
| 110 | TableNotFound | table_id does not exist | "Table not found." |
| 111 | NoWaitingSession | get_table_waiting when 0/2 | "No one waiting at this table." |
| 112 | WaitingTimeoutNotReached | cancel_waiting by non-waiting player before timeout | "Waiting timeout not yet reached." |
| 900 | Unauthorized | Admin-only | "Unauthorized." |
| 901 | Overflow | Arithmetic overflow | "Overflow error." |
| 902 | NotImplemented | (legacy) | "Not implemented." |

**Where to update:** CONTRACTS_SPEC §8 (Error Codes): ensure all of these exist and add "Suggested message (frontend)" table or reference to this doc.

---

## 9. Data persisted per game (checklist)

### Game (per session_id / game_id)

| Field | Type | Use |
|-------|------|-----|
| id | u64 | Internal id; session_id = id as u32 for Game Hub |
| state | GameState | Current phase |
| player1, player2 | Address, Option<Address> | Players |
| buy_in | i128 | Initial stack per player |
| pot | i128 | Current pot |
| small_blind, big_blind | i128 | From config (copied on create or read from config) |
| dealer_position | u8 | 0 = P1 dealer, 1 = P2 dealer |
| board | Vec<u8> (5) | 5 community cards (filled in DealCards) |
| board_revealed | u8 | 0, 3, 4 or 5 |
| current_bet_p1, current_bet_p2 | i128 | Bet in current round |
| total_bet_p1, total_bet_p2 | i128 | Total bet in the hand |
| min_raise, last_raise_amount | i128 | Raise rules |
| actor | u8 | 0 = P1's turn, 1 = P2's turn |
| folded | Option<Address> | Who folded (if any) |
| seed_commitment1/2, seed_reveal1/2, final_seed | Option<BytesN<32>> | Shuffle |
| hand_commitment1/2 | Option<BytesN<32>> | Hand commitments |
| hand_rank1/2 | Option<u8> | Rankings at showdown |
| winner | Option<Address> | Winner |
| created_at, last_action_at | u64 | Timestamps |
| table_id | u64 | Table of origin (get_table for blinds/limits) |

Ensure CONTRACTS_SPEC §2.4 and ARCHITECTURE (if it has struct Game) match this list.

**Where to update:** CONTRACTS_SPEC §2.4 and §6; ARCHITECTURE if it has state table.

---

## 10. SPEC_MAP — "Implement X → see doc Y"

| Implement | Document | Section |
|-----------|----------|---------|
| Setup + Game Hub | GAME_STUDIO_INTEGRATION.md | 3 (Workflow), 5 (Game Hub) |
| State machine + act() | CONTRACTS_SPEC.md | 2.3 (State Machine), 2.5.5–2.5.6 |
| Blinds and post_blinds | CONTRACTS_SPEC.md | 2.5.5, 2.4 (GameConfig) |
| Board and derive_board_cards | CONTRACTS_SPEC.md | 2.4 (board, board_revealed), 2.6 (derive_board_cards) |
| When to require proof in act() | CONTRACTS_SPEC.md | 2.5.6; SPEC_COMPLETE.md §4 |
| Game Hub (start/end) | CONTRACTS_SPEC.md | 5; SPEC_COMPLETE.md §1 |
| Timeout and claim_timeout | CONTRACTS_SPEC.md | 2.5.8, SPEC_COMPLETE.md §7 |
| Errors and UI messages | CONTRACTS_SPEC.md | 8; SPEC_COMPLETE.md §8 |
| hand_validator.nr | CIRCUITS_SPEC.md | 2 |
| hand_ranker.nr | CIRCUITS_SPEC.md | 3 |
| Board in circuit (5 cards) | CIRCUITS_SPEC.md | 1–2; SPEC_COMPLETE.md §5 |
| Full flow (phases) | GAME_FLOW.md | 1.1, 5–8, 10 |
| Table config (SB/BB, buy-in) | CONTRACTS_SPEC.md | 2.4 (GameConfig), 2.5.1; SPEC_COMPLETE.md §6 |
| Mesas (Table, sit_at_table, cancel_waiting, waiting_timeout) | CONTRACTS_SPEC.md | 2.4 (Table, WaitingSession, SitResult), 2.5.1–2.5.2; docs/MESAS_VIRTUAIS_N_JOGADORES.md |
| Storage per game + TTL (Game Studio) | CONTRACTS_SPEC.md | 2.2, 2.4, 6; SPEC_COMPLETE.md §9 |

**Where to use:** INDEX.md or README: add link to SPEC_COMPLETE.md and optionally this table (or "For full spec details, see SPEC_COMPLETE.md and SPEC_MAP above").

---

**Version:** 1.0  
**Date:** 2026  
**Status:** Spec ready to start development after applying the "Where to update" items in the referenced docs.
