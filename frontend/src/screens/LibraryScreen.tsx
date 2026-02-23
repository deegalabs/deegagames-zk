export interface LibraryScreenProps {
  onLaunchPoker: () => void;
}

export function LibraryScreen({ onLaunchPoker }: LibraryScreenProps) {
  return (
    <div id="library" className="screen active">
      <div className="page-wrap">

        {/* Hero */}
        <div className="lib-hero">
          <div className="lib-hero-eyebrow">
            <span className="lib-hero-dot" />
            <span>Games Library · DeegaLabs</span>
          </div>
          <h1 className="lib-hero-title">Choose your game</h1>
          <p className="lib-hero-sub">
            All games use <strong style={{ color: 'var(--green)' }}>Zero-Knowledge Proofs</strong> and run on the Stellar Testnet.
          </p>
        </div>

        {/* Games grid */}
        <div className="lib-grid">

          {/* ─── Poker ZK Card ─── */}
          <div
            className="lib-card lib-card-poker"
            onClick={onLaunchPoker}
            onKeyDown={(e) => e.key === 'Enter' && onLaunchPoker()}
            role="button"
            tabIndex={0}
          >
            {/* Felt background with card pattern */}
            <div className="lib-card-bg">
              <div className="lib-felt-pattern" />
              {/* Decorative suits */}
              <span className="lib-suit lib-suit-1">♠</span>
              <span className="lib-suit lib-suit-2">♥</span>
              <span className="lib-suit lib-suit-3">♦</span>
              <span className="lib-suit lib-suit-4">♣</span>
            </div>

            {/* Glowing edge */}
            <div className="lib-card-glow" />

            <div className="lib-card-inner">
              {/* Top row */}
              <div className="lib-card-top">
                <div className="lib-card-badge-live">
                  <span className="lib-live-dot" />
                  LIVE
                </div>
                <div className="lib-card-chip-row">
                  <span className="lib-chip lc-red" />
                  <span className="lib-chip lc-blue" />
                  <span className="lib-chip lc-gold" />
                </div>
              </div>

              {/* Preview cards */}
              <div className="lib-preview-cards">
                <div className="lib-pc red" style={{ transform: 'rotate(-12deg) translateY(4px)' }}>
                  <span>A</span><span>♥</span>
                </div>
                <div className="lib-pc blk" style={{ transform: 'rotate(-4deg)' }}>
                  <span>K</span><span>♠</span>
                </div>
                <div className="lib-pc red" style={{ transform: 'rotate(5deg)' }}>
                  <span>Q</span><span>♦</span>
                </div>
                <div className="lib-pc blk" style={{ transform: 'rotate(14deg) translateY(4px)' }}>
                  <span>J</span><span>♣</span>
                </div>
              </div>

              {/* Content */}
              <div className="lib-card-content">
                <h3 className="lib-card-title">Poker ZK</h3>
                <p className="lib-card-subtitle">Texas Hold'em · Provably Fair</p>
                <p className="lib-card-desc">
                  Cards committed on-chain via commit-reveal.
                  ZK Proofs verified by the Soroban contract.
                  No server. No cheating.
                </p>
                <div className="lib-card-tags">
                  <span className="tag green">ZK Proofs</span>
                  <span className="tag cyan">2 Players</span>
                  <span className="tag">Stellar Soroban</span>
                  <span className="tag">XLM Stakes</span>
                </div>
              </div>

              {/* CTA */}
              <div className="lib-card-cta">
                <button type="button" className="lib-launch-btn" onClick={onLaunchPoker}>
                  <span>Play now</span>
                  <span className="lib-launch-arrow">→</span>
                </button>
                <span className="lib-card-meta">Testnet · Free to play</span>
              </div>
            </div>
          </div>

          {/* ─── Blackjack Card (locked) ─── */}
          <div className="lib-card lib-card-locked">
            <div className="lib-card-bg lib-card-bg-locked">
              <div className="lib-felt-pattern lib-felt-locked" />
            </div>
            <div className="lib-card-inner">
              <div className="lib-card-top">
                <div className="lib-card-badge-soon">🔒 Coming Soon</div>
              </div>
              <div className="lib-preview-cards lib-preview-locked">
                <div className="lib-pc-back" />
                <div className="lib-pc-back" style={{ transform: 'rotate(8deg)' }} />
                <div className="lib-pc-back" style={{ transform: 'rotate(-5deg)' }} />
              </div>
              <div className="lib-card-content">
                <h3 className="lib-card-title" style={{ color: 'var(--muted)' }}>21 Blackjack ZK</h3>
                <p className="lib-card-subtitle" style={{ color: 'var(--muted-2)' }}>Blackjack · On-Chain Dealer</p>
                <p className="lib-card-desc" style={{ color: 'var(--muted-2)' }}>
                  Dealer verified by ZK proof. Each round proves a valid hand without revealing the deck.
                  Powered by Noir circuit.
                </p>
                <div className="lib-card-tags">
                  <span className="tag">ZK Proofs</span>
                  <span className="tag">1–4 Players</span>
                  <span className="tag">Noir Circuit</span>
                </div>
              </div>
              <div className="lib-card-cta">
                <span className="lib-soon-label">Coming Soon →</span>
              </div>
            </div>
          </div>

        </div>

        {/* ZK Info section */}
        <div className="section-eyebrow" style={{ marginBottom: 20, marginTop: 48 }}>Zero Knowledge Games</div>
        <div className="zk-section">
          <div className="zk-header">
            <div className="zk-header-icon">🔐</div>
            <div className="zk-header-text">
              <div className="zk-header-title">What are ZK Games?</div>
              <div className="zk-header-sub">Zero-Knowledge Proofs applied to on-chain games</div>
            </div>
          </div>

          <div className="zk-body">
            <div className="zk-cell">
              <div className="zk-cell-icon">🃏</div>
              <div className="zk-cell-title">True Privacy</div>
              <p className="zk-cell-text">
                In a ZK Game, you prove you have a winning hand <em>without revealing your cards</em>.
                Using Zero-Knowledge circuits (Noir/Groth16), we generate a mathematical proof
                that any node can verify — without seeing the private content.
              </p>
            </div>
            <div className="zk-cell">
              <div className="zk-cell-icon">⛓️</div>
              <div className="zk-cell-title">On-Chain Fairness</div>
              <p className="zk-cell-text">
                No server decides the winner. The Soroban contract verifies
                the ZK proof directly on Stellar — if the proof is valid,
                the pot is automatically transferred in XLM.
                No intermediaries, no cheating.
              </p>
            </div>
            <div className="zk-cell">
              <div className="zk-cell-icon">🔬</div>
              <div className="zk-cell-title">How we generate the proof</div>
              <p className="zk-cell-text">
                We write the game logic in <strong style={{ color: 'var(--cyan)' }}>Noir</strong> —
                a language for ZK circuits. The client compiles and generates
                the proof locally (off-chain).
                The Soroban contract only needs to verify: much cheaper and faster.
              </p>
            </div>
          </div>

          <div className="zk-flow">
            <div className="zk-flow-title">ZK match flow</div>
            <div className="zk-flow-steps">
              <div className="zk-step">Cards shuffled</div>
              <div className="zk-arrow">→</div>
              <div className="zk-step">Hash committed on-chain</div>
              <div className="zk-arrow">→</div>
              <div className="zk-step highlight">ZK Proof generated (Noir)</div>
              <div className="zk-arrow">→</div>
              <div className="zk-step">Proof submitted to contract</div>
              <div className="zk-arrow">→</div>
              <div className="zk-step highlight">Verified on-chain</div>
              <div className="zk-arrow">→</div>
              <div className="zk-step">Pot settled in XLM ✓</div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', padding: '40px 0 10px', fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted-2)', letterSpacing: '2px', textTransform: 'uppercase' }}>
          Built with <span style={{ color: 'var(--green)' }}>♥</span> by DeegaLabs — <a href="mailto:contato@deegalabs.com.br">contato@deegalabs.com.br</a>
        </div>
      </div>
    </div>
  );
}
