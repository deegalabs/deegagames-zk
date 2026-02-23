export interface HomeScreenProps {
  onExploreGames: () => void;
  onToast: (msg: string) => void;
}

export function HomeScreen({ onExploreGames, onToast }: HomeScreenProps) {
  return (
    <div id="home" className="screen active">
      <div className="page-wrap">
        <div className="hero">
          <div className="hero-grid">
            <div className="hero-left">
              <div className="hero-eyebrow">
                <div className="eyebrow-line" />
                <span className="eyebrow-text">DeegaLabs · Stellar Blockchain · ZK Proofs</span>
              </div>
              <h1 className="hero-title">
                On-chain games
                <br />
                with <em>verifiable</em>
                <br />
                privacy
              </h1>
              <p className="hero-desc">
                We build Web3 games using <strong style={{ color: 'var(--text)' }}>Zero-Knowledge Proofs</strong> on the Stellar network.
                No centralised server. No blind trust.
                Every move is cryptographically proven and settled on-chain.
              </p>
              <div className="hero-ctas">
                <button type="button" className="btn-primary" onClick={onExploreGames}>
                  Explore Games →
                </button>
                <button type="button" className="btn-outline" onClick={() => onToast('Coming soon on GitHub...')}>
                  View GitHub
                </button>
              </div>
            </div>
            <div className="hero-visual">
              <div className="terminal-card">
                <div className="terminal-bar">
                  <div className="t-dot red" />
                  <div className="t-dot yel" />
                  <div className="t-dot grn" />
                  <span className="t-title">poker_zk_proof.json</span>
                </div>
                <div className="terminal-body">
                  <span className="t-comment">// Poker ZK — Proof generated off-chain</span>
                  <br />
                  <span className="t-brace">{'{'}</span>
                  <br />
                  &nbsp;&nbsp;<span className="t-key">"protocol"</span>: <span className="t-str">"noir_groth16"</span>,<br />
                  &nbsp;&nbsp;<span className="t-key">"circuit"</span>: <span className="t-str">"poker_hand_v1"</span>,<br />
                  &nbsp;&nbsp;<span className="t-key">"public_inputs"</span>: <span className="t-brace">{'{'}</span>
                  <br />
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="t-key">"hand_commit"</span>: <span className="t-val">"0x4f8a..."</span>,<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="t-key">"is_valid_hand"</span>: <span className="t-val">true</span>,<br />
                  &nbsp;&nbsp;&nbsp;&nbsp;<span className="t-key">"winner"</span>: <span className="t-str">"player_1"</span>
                  <br />
                  &nbsp;&nbsp;<span className="t-brace">{'}'}</span>,<br />
                  &nbsp;&nbsp;<span className="t-key">"proof"</span>: <span className="t-val">"0x1a2b3c..."</span>,<br />
                  &nbsp;&nbsp;<span className="t-key">"verified_on_chain"</span>: <span className="t-val">true</span>,<br />
                  &nbsp;&nbsp;<span className="t-key">"stellar_tx"</span>: <span className="t-str">"testnet"</span>
                  <br />
                  <span className="t-brace">{'}'}</span>
                  <br />
                  <span className="t-comment">// ✓ Verified by the Soroban contract</span> <span className="t-cursor" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-cell">
            <span className="stat-num">ZK</span>
            <span className="stat-label">Zero Knowledge</span>
          </div>
          <div className="stat-cell">
            <span className="stat-num">0</span>
            <span className="stat-label">Central Servers</span>
          </div>
          <div className="stat-cell">
            <span className="stat-num">XLM</span>
            <span className="stat-label">Native Token</span>
          </div>
          <div className="stat-cell">
            <span className="stat-num">∞</span>
            <span className="stat-label">Verifiable</span>
          </div>
        </div>

        <div className="section-header">
          <div className="section-eyebrow">How it works</div>
          <h2 className="section-title">ZK Gaming in practice</h2>
          <p className="section-sub">
            Zero-Knowledge Proofs let you prove you played correctly without revealing your cards.
            The Soroban contract verifies the proof and settles the pot automatically.
          </p>
        </div>

        <div className="steps-grid">
          <div className="step-card">
            <div className="step-num">01</div>
            <div className="step-icon">🔒</div>
            <h3 className="step-title">Commit On-Chain</h3>
            <p className="step-desc">
              Cards are shuffled with multi-party commit-reveal.
              The hand hash is registered on the Soroban contract before the match begins.
            </p>
          </div>
          <div className="step-card">
            <div className="step-num">02</div>
            <div className="step-icon">⚡</div>
            <h3 className="step-title">Off-Chain Proof</h3>
            <p className="step-desc">
              During the game, the client generates ZK Proofs (Noir/Groth16) that prove
              the validity of each move without revealing opponents' cards.
            </p>
          </div>
          <div className="step-card">
            <div className="step-num">03</div>
            <div className="step-icon">✅</div>
            <h3 className="step-title">Verify & Settle</h3>
            <p className="step-desc">
              The Soroban contract verifies the proof on-chain and automatically transfers
              the pot in XLM to the proven winner.
            </p>
          </div>
        </div>

        <div className="section-header">
          <div className="section-eyebrow">Tech Stack</div>
          <h2 className="section-title">Powered by</h2>
        </div>

        <div className="tech-row">
          <div className="tech-badge">
            <div className="tech-icon">⭐</div>
            <div>
              <div className="tech-name" style={{ color: 'var(--gold-light)' }}>Stellar / Soroban</div>
              <div className="tech-sub">Smart Contracts WASM</div>
            </div>
          </div>
          <div className="tech-badge">
            <div className="tech-icon">🔬</div>
            <div>
              <div className="tech-name" style={{ color: 'var(--cyan)' }}>Noir</div>
              <div className="tech-sub">ZK Circuit Language</div>
            </div>
          </div>
          <div className="tech-badge">
            <div className="tech-icon">🏗️</div>
            <div>
              <div className="tech-name" style={{ color: 'var(--green)' }}>Stellar Game Studio</div>
              <div className="tech-sub">Web3 Game Toolkit</div>
            </div>
          </div>
          <div className="tech-badge">
            <div className="tech-icon">⚙️</div>
            <div>
              <div className="tech-name">Groth16</div>
              <div className="tech-sub">Proof System</div>
            </div>
          </div>
          <div className="tech-badge">
            <div className="tech-icon">🌐</div>
            <div>
              <div className="tech-name">React + TypeScript</div>
              <div className="tech-sub">Frontend</div>
            </div>
          </div>
        </div>

        <div className="home-footer">
          <div className="home-footer-left">
            Built with <span style={{ color: 'var(--green)' }}>♥</span> by <strong>DeegaLabs</strong> —{' '}
            <a href="mailto:contato@deegalabs.com.br" className="footer-link">contato@deegalabs.com.br</a>
          </div>
          <div className="home-footer-right">
            <span className="footer-link">GitHub</span>
            <span className="footer-link">LinkedIn</span>
            <span className="footer-link">Discord</span>
            <span className="footer-link">X.com</span>
          </div>
        </div>
      </div>
    </div>
  );
}
