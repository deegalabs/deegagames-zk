// Hand Ranker circuit - CIRCUITS_SPEC section 3
// Proves: claimed_rank (1-10) is correct for (hole_cards, board); commitment consistent with hand_validator.
//
// Commitment: same binding as hand_validator (c0 + c1*53). Rank: 1=High Card .. 10=Royal Flush.

fn main(
    hole_cards: [u8; 2],
    board: pub [u8; 5],
    claimed_rank: pub u8,
    commitment: pub Field,
) {
    let c0 = hole_cards[0] as Field;
    let c1 = hole_cards[1] as Field;
    let computed_commitment = c0 + c1 * 53;
    assert(commitment == computed_commitment);

    let actual_rank = compute_poker_hand(hole_cards, board);
    assert(claimed_rank == actual_rank);
}

fn compute_poker_hand(hole: [u8; 2], board: [u8; 5]) -> u8 {
    let all_cards = [
        hole[0],
        hole[1],
        board[0],
        board[1],
        board[2],
        board[3],
        board[4],
    ];
    let r10 = is_royal_flush(all_cards);
    let sf = is_straight_flush(all_cards);
    let r9 = sf & !r10;
    let r8 = is_four_kind(all_cards) & !sf;
    let r7 = is_full_house(all_cards) & !sf;
    let r6 = is_flush(all_cards) & !sf;
    let st = is_straight(all_cards);
    let r5 = st & !sf;
    let fh = is_full_house(all_cards);
    let fl = is_flush(all_cards);
    let r4 = is_three_kind(all_cards) & !fh & !st & !fl;
    let r3 = is_two_pair(all_cards) & !(is_three_kind(all_cards)) & !fh & !st & !fl;
    let r2 = is_one_pair(all_cards) & !(is_two_pair(all_cards)) & !(is_three_kind(all_cards)) & !st & !fl;
    let r1 = !r2 & !r3 & !r4 & !r5 & !r6 & !r7 & !r8 & !r9 & !r10;
    let sum_b = (r1 as u8) + (r2 as u8) + (r3 as u8) + (r4 as u8) + (r5 as u8) + (r6 as u8) + (r7 as u8) + (r8 as u8) + (r9 as u8) + (r10 as u8);
    assert(sum_b == 1);
    let rank = (r1 as u8) * 1 + (r2 as u8) * 2 + (r3 as u8) * 3 + (r4 as u8) * 4 + (r5 as u8) * 5 + (r6 as u8) * 6 + (r7 as u8) * 7 + (r8 as u8) * 8 + (r9 as u8) * 9 + (r10 as u8) * 10;
    rank
}

fn is_royal_flush(cards: [u8; 7]) -> bool {
    let mut out = false;
    if is_straight_flush(cards) {
        let ranks = extract_ranks(cards);
        let has_ace = contains(ranks, 14);
        let has_king = contains(ranks, 13);
        let has_queen = contains(ranks, 12);
        let has_jack = contains(ranks, 11);
        let has_ten = contains(ranks, 10);
        if has_ace & has_king & has_queen & has_jack & has_ten {
            out = true;
        }
    }
    out
}

fn is_straight_flush(cards: [u8; 7]) -> bool {
    let mut out = false;
    if is_flush(cards) & is_straight(cards) {
        out = true;
    }
    out
}

fn is_four_kind(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    let mut out = false;
    for i in 0..13 {
        let r = (i + 2) as u32;
        if counts[r] == 4 {
            out = true;
        }
    }
    out
}

fn is_full_house(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    let mut has_three = false;
    let mut has_pair = false;
    for i in 0..13 {
        let r = (i + 2) as u32;
        if counts[r] == 3 {
            has_three = true;
        }
        if counts[r] == 2 {
            has_pair = true;
        }
    }
    let mut out = false;
    if has_three & has_pair {
        out = true;
    }
    out
}

fn is_flush(cards: [u8; 7]) -> bool {
    let suits = extract_suits(cards);
    let suit_counts = count_suits(suits);
    let mut out = false;
    for i in 0..4 {
        if suit_counts[i] >= 5 {
            out = true;
        }
    }
    out
}

fn is_straight(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let sorted_ranks = sort_ranks(ranks);
    let mut consecutive = 1u8;
    let mut out = false;
    for i in 0..6 {
        if sorted_ranks[i + 1] == sorted_ranks[i] + 1 {
            consecutive += 1;
            if consecutive >= 5 {
                out = true;
            }
        } else if sorted_ranks[i + 1] != sorted_ranks[i] {
            consecutive = 1;
        }
    }
    let has_ace = contains(sorted_ranks, 14);
    let has_two = contains(sorted_ranks, 2);
    let has_three = contains(sorted_ranks, 3);
    let has_four = contains(sorted_ranks, 4);
    let has_five = contains(sorted_ranks, 5);
    if has_ace & has_two & has_three & has_four & has_five {
        out = true;
    }
    out
}

fn is_three_kind(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    let mut out = false;
    for i in 0..13 {
        let r = (i + 2) as u32;
        if counts[r] == 3 {
            out = true;
        }
    }
    out
}

fn is_two_pair(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    let mut pair_count = 0u8;
    for i in 0..13 {
        let r = (i + 2) as u32;
        if counts[r] == 2 {
            pair_count += 1;
        }
    }
    let mut out = false;
    if pair_count >= 2 {
        out = true;
    }
    out
}

fn is_one_pair(cards: [u8; 7]) -> bool {
    let ranks = extract_ranks(cards);
    let counts = count_ranks(ranks);
    let mut out = false;
    for i in 0..13 {
        let r = (i + 2) as u32;
        if counts[r] == 2 {
            out = true;
        }
    }
    out
}

fn extract_ranks(cards: [u8; 7]) -> [u8; 7] {
    let mut ranks = [0u8; 7];
    for i in 0..7 {
        ranks[i] = ((cards[i] - 1) / 4) + 2;
    }
    ranks
}

fn extract_suits(cards: [u8; 7]) -> [u8; 7] {
    let mut suits = [0u8; 7];
    for i in 0..7 {
        suits[i] = (cards[i] - 1) % 4;
    }
    suits
}

fn count_ranks(ranks: [u8; 7]) -> [u8; 15] {
    let mut counts = [0u8; 15];
    for i in 0..7 {
        let r = ranks[i] as u32;
        counts[r] += 1;
    }
    counts
}

fn count_suits(suits: [u8; 7]) -> [u8; 4] {
    let mut counts = [0u8; 4];
    for i in 0..7 {
        let s = suits[i] as u32;
        counts[s] += 1;
    }
    counts
}

fn sort_ranks(ranks: [u8; 7]) -> [u8; 7] {
    let mut sorted = ranks;
    for i in 0..6 {
        for j in 0..6 {
            if j < 6 - i {
                if sorted[j] > sorted[j + 1] {
                    let temp = sorted[j];
                    sorted[j] = sorted[j + 1];
                    sorted[j + 1] = temp;
                }
            }
        }
    }
    sorted
}

fn contains(arr: [u8; 7], value: u8) -> bool {
    let mut out = false;
    for i in 0..7 {
        if arr[i] == value {
            out = true;
        }
    }
    out
}

// --- Tests: one per rank (card encoding: (rank-2)*4+suit+1, rank 2-14, suit 0-3) ---

#[test]
fn test_rank_1_high_card() {
    let hole = [1, 6];
    let board = [11, 16, 21, 26, 31];
    assert(compute_poker_hand(hole, board) == 1);
}

#[test]
fn test_rank_2_one_pair() {
    let hole = [1, 2];
    let board = [9, 18, 26, 33, 41];
    assert(compute_poker_hand(hole, board) == 2);
}

#[test]
fn test_rank_3_two_pair() {
    let hole = [1, 2];
    let board = [33, 34, 9, 18, 26];
    assert(compute_poker_hand(hole, board) == 3);
}

#[test]
fn test_rank_4_three_of_a_kind() {
    let hole = [14, 27];
    let board = [23, 22, 21, 7, 2];
    assert(compute_poker_hand(hole, board) == 4);
}

#[test]
fn test_rank_5_straight() {
    let hole = [9, 14];
    let board = [19, 23, 28, 1, 2];
    assert(compute_poker_hand(hole, board) == 5);
}

#[test]
fn test_rank_6_flush() {
    // 5 spades, no straight: 2,3,4,7,8s + 9d,10d
    let hole = [1, 5];
    let board = [9, 21, 25, 30, 34];
    assert(compute_poker_hand(hole, board) == 6);
}

#[test]
fn test_rank_7_full_house() {
    let hole = [1, 2];
    let board = [3, 5, 6, 9, 13];
    assert(compute_poker_hand(hole, board) == 7);
}

#[test]
fn test_rank_8_four_of_a_kind() {
    let hole = [1, 2];
    let board = [3, 4, 5, 9, 13];
    assert(compute_poker_hand(hole, board) == 8);
}

#[test]
fn test_rank_9_straight_flush() {
    let hole = [1, 5];
    let board = [9, 13, 17, 21, 25];
    assert(compute_poker_hand(hole, board) == 9);
}

#[test]
fn test_rank_10_royal_flush() {
    let hole = [49, 45];
    let board = [41, 37, 33, 1, 2];
    assert(compute_poker_hand(hole, board) == 10);
}
