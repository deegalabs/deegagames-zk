import { useState, useRef, useEffect, useCallback } from 'react';

export interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  pending?: boolean;
  failed?: boolean;
  txHash?: string;
}

const EXPLORER = 'https://stellar.expert/explorer/testnet';

interface ChatPanelProps {
  onClose: () => void;
  userAddress: string;
  gameId: bigint | null;
  onSend: (message: string) => Promise<string | undefined>;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length <= 14) return addr || 'Unknown';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ChatPanel({ onClose, userAddress, gameId, onSend }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending || !gameId) return;

    const id = `${Date.now()}-${Math.random()}`;
    const msg: ChatMessage = {
      id,
      sender: userAddress,
      text,
      timestamp: new Date(),
      pending: true,
    };

    setMessages(prev => [...prev, msg]);
    setDraft('');
    setSending(true);

    try {
      const txHash = await onSend(text);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, pending: false, txHash } : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, pending: false, failed: true } : m));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const isMe = (addr: string) => addr === userAddress;

  return (
    <div className="cp-panel">
      {/* ── Header ── */}
      <div className="cp-titlebar">
        <span className="cp-title">💬 Table Chat</span>
        {gameId && <span className="cp-game-id">game #{gameId.toString()}</span>}
        <button type="button" className="cp-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* ── Notice ── */}
      <div className="cp-notice">
        Messages are sent on-chain · cleared on refresh
      </div>

      {/* ── Message list ── */}
      <div className="cp-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="cp-empty">No messages yet. Say something!</div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`cp-msg ${isMe(msg.sender) ? 'cp-msg-me' : 'cp-msg-them'}`}>
            <div className="cp-msg-header">
              <span className="cp-msg-addr">{isMe(msg.sender) ? 'You' : shortAddr(msg.sender)}</span>
              <span className="cp-msg-time">{fmtTime(msg.timestamp)}</span>
              {msg.pending && <span className="cp-msg-status cp-pending">sending…</span>}
              {msg.failed && <span className="cp-msg-status cp-failed">✕ failed</span>}
              {msg.txHash && (
                <a
                  className="cp-tx-link"
                  href={`${EXPLORER}/tx/${msg.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View on stellar.expert"
                >⛓</a>
              )}
            </div>
            <div className="cp-msg-bubble">{msg.text}</div>
          </div>
        ))}
      </div>

      {/* ── Input ── */}
      <div className="cp-input-row">
        {!gameId ? (
          <div className="cp-no-game">Join a game to chat</div>
        ) : (
          <>
            <input
              ref={inputRef}
              className="cp-input"
              type="text"
              placeholder="Type a message…"
              maxLength={280}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKey}
              disabled={sending}
            />
            <button
              type="button"
              className="cp-send-btn"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
            >
              {sending ? '…' : '→'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
