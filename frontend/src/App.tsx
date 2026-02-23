import { useState, useEffect } from 'react';
import { config } from './config';
import { Layout } from './components/Layout';
import { useWallet } from './hooks/useWallet';
import { PokerZkGame } from './games/poker-zk/PokerZkGame';
import { HomeScreen } from './screens/HomeScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { GameIntroScreen } from './screens/GameIntroScreen';

const GAME_ID = 'poker-zk';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || 'DeegaLabs Game';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'ZK Gaming · Stellar Network';

type Screen = 'home' | 'library' | 'intro' | 'poker';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const { publicKey, isConnected, isConnecting, error, isDevModeAvailable } = useWallet();
  const userAddress = publicKey ?? '';
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = contractId && contractId !== 'YOUR_CONTRACT_ID';
  const devReady = isDevModeAvailable();

  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const activeNav = screen === 'home' ? 'home' : 'library';
  const isFullscreen = screen === 'intro';

  const renderContent = () => {
    if (screen === 'home') {
      return (
        <HomeScreen
          onExploreGames={() => setScreen('library')}
          onToast={setToastMsg}
        />
      );
    }
    if (screen === 'library') {
      return (
        <LibraryScreen
          onLaunchPoker={() => setScreen('intro')}
        />
      );
    }
    if (screen === 'intro') {
      return (
        <GameIntroScreen
          gameName="Poker ZK"
          tagline="Texas Hold'em · Zero-Knowledge · Stellar Soroban"
          onComplete={() => setScreen('poker')}
        />
      );
    }
    // screen === 'poker'
    if (!hasContract) {
      return (
        <div className="page-wrap">
          <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
            <h3 className="gradient-text">Contract Not Configured</h3>
            <p style={{ color: 'var(--muted)', marginTop: '1rem' }}>
              Run <code>bun run setup</code> to deploy and configure testnet contract IDs, or set
              <code>VITE_POKER_ZK_CONTRACT_ID</code> in the root <code>.env</code>.
            </p>
            <button type="button" className="back-btn" style={{ marginTop: 16 }} onClick={() => setScreen('library')}>← Back to Library</button>
          </div>
        </div>
      );
    }
    if (!devReady) {
      return (
        <div className="page-wrap">
          <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
            <h3 className="gradient-text">Dev Wallets Missing</h3>
            <p style={{ color: 'var(--muted)', marginTop: '0.75rem' }}>
              Run <code>bun run setup</code> to generate dev wallets for Player 1 and Player 2.
            </p>
            <button type="button" className="back-btn" style={{ marginTop: 16 }} onClick={() => setScreen('library')}>← Back to Library</button>
          </div>
        </div>
      );
    }
    if (!isConnected) {
      return (
        <div className="page-wrap">
          <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
            <h3 className="gradient-text">Connecting Dev Wallet</h3>
            <p style={{ color: 'var(--muted)', marginTop: '0.75rem' }}>
              The dev wallet switcher auto-connects Player 1. Use the switcher to toggle players.
            </p>
            {error && (
              <div className="notice error" style={{ marginTop: '1rem' }}>
                {error}
                {error.includes('Account not found') && (() => {
                  const addr = (error.match(/Account not found: (G[A-Z0-9]{55})/)?.[1])
                    || publicKey
                    || config.devPlayer1Address
                    || '';
                  return addr ? (
                    <p style={{ marginTop: '0.75rem', fontSize: '0.9em' }}>
                      A conta ainda não existe na testnet. Abre este link para a criar e financiar (10 000 XLM de teste):{' '}
                      <a href={`https://friendbot.stellar.org/?addr=${addr}`} target="_blank" rel="noopener noreferrer">
                        Friendbot — financiar esta conta
                      </a>
                      . Depois recarrega a página.
                    </p>
                  ) : null;
                })()}
              </div>
            )}
            {isConnecting && <div className="notice info" style={{ marginTop: '1rem' }}>Connecting...</div>}
            <button type="button" className="back-btn" style={{ marginTop: 16 }} onClick={() => setScreen('library')}>← Back to Library</button>
          </div>
        </div>
      );
    }
    return (
      <PokerZkGame
        userAddress={userAddress}
        availablePoints={1000000000n}
        onStandingsRefresh={() => {}}
        onGameComplete={() => {}}
        onBackToLibrary={() => setScreen('library')}
      />
    );
  };

  return (
    <>
      {isFullscreen ? (
        renderContent()
      ) : (
        <Layout
          title={GAME_TITLE}
          subtitle={GAME_TAGLINE}
          activeNav={activeNav}
          onNavHome={() => setScreen('home')}
          onNavLibrary={() => setScreen('library')}
          onNavDocs={() => setToastMsg('Documentation coming soon...')}
        >
          {renderContent()}
        </Layout>
      )}
      <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg ?? ''}</div>
    </>
  );
}
