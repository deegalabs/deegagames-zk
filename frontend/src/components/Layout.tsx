import { useWallet } from '../hooks/useWallet';
import { WalletSwitcher } from './WalletSwitcher';

export type NavScreen = 'home' | 'library';

interface LayoutProps {
  title?: string;
  subtitle?: string;
  activeNav: NavScreen;
  onNavHome: () => void;
  onNavLibrary: () => void;
  onNavDocs: () => void;
  children: React.ReactNode;
}

export function Layout({ title, subtitle, activeNav, onNavHome, onNavLibrary, onNavDocs, children }: LayoutProps) {
  const { publicKey, isConnected, isConnecting, walletType, switchPlayer, getCurrentDevPlayer } = useWallet();
  const currentPlayer = getCurrentDevPlayer();
  const shortAddr = publicKey ? `${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` : '';

  const handleSwitch = async () => {
    if (walletType !== 'dev') return;
    const next = currentPlayer === 1 ? 2 : 1;
    try {
      await switchPlayer(next);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="deegalabs-app">
      <header>
        <div className="header-wrap">
          <div className="header-top">
            <button type="button" className="logo-block" onClick={onNavHome} style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <div className="logo-mark">♟️</div>
              <div className="logo-text">
                <div className="logo-title">{title || 'DeegaLabs Game'}</div>
                <div className="logo-sub">{subtitle || 'ZK Gaming · Stellar Network'}</div>
              </div>
            </button>
            <div className="header-wallet">
              <div className="net-badge">Testnet</div>
              {isConnected ? (
                <div className="wallet-pill">
                  <div className="w-dot" />
                  <div className="w-info">
                    <div className="w-label">Connected · Player {currentPlayer ?? 1}</div>
                    <div className="w-addr">{shortAddr}</div>
                  </div>
                  {walletType === 'dev' && (
                    <button type="button" className="switch-btn" onClick={handleSwitch} disabled={isConnecting}>
                      Switch P{currentPlayer === 1 ? 2 : 1}
                    </button>
                  )}
                </div>
              ) : (
                <div className="wallet-pill wallet-pill-connect">
                  <WalletSwitcher />
                </div>
              )}
            </div>
          </div>
          <nav className="header-nav">
            <button type="button" className={`nav-item ${activeNav === 'home' ? 'active' : ''}`} onClick={onNavHome}>Home</button>
            <div className="nav-sep" />
            <button type="button" className={`nav-item ${activeNav === 'library' ? 'active' : ''}`} onClick={onNavLibrary}>Games Library</button>
            <div className="nav-sep" />
            <button type="button" className="nav-item" onClick={onNavDocs}>Documentation</button>
          </nav>
        </div>
      </header>

      <main className="studio-main">{children}</main>
    </div>
  );
}
