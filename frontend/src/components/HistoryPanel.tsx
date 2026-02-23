import { useEffect, useRef, useState } from 'react';
import { useBlockchainHistory, type HistoryEvent, type HistoryEventType } from '../hooks/useBlockchainHistory';
import { POKER_ZK_CONTRACT } from '@/utils/constants';

const EXPLORER = 'https://stellar.expert/explorer/testnet';

interface HistoryPanelProps {
  onClose: () => void;
}

const EVENT_COLOR: Record<string, string> = {
  CREATE:    '#00ff88',
  JOIN:      '#00ccff',
  FOLD:      '#ff5555',
  NEXT_HAND: '#ffd700',
  TBL_SIT:   '#ff9900',
  TBL_START: '#aaff44',
  TBL_ADDED: '#888888',
  CHECK:     '#aaaaaa',
  CALL:      '#4488ff',
  RAISE:     '#cc44ff',
  PAYOUT:    '#ffee44',
  SHUFFLE:   '#44ddcc',
  REVEAL:    '#44aaff',
  TIMEOUT:   '#ff7744',
  COMMIT:    '#88ccff',
  UNKNOWN:   '#444444',
};

const EVENT_ICON: Record<string, string> = {
  CREATE:    '✦',
  JOIN:      '→',
  FOLD:      '✕',
  NEXT_HAND: '↺',
  TBL_SIT:   '⊕',
  TBL_START: '▶',
  TBL_ADDED: '□',
  CHECK:     '–',
  CALL:      '=',
  RAISE:     '↑',
  PAYOUT:    '★',
  SHUFFLE:   '⧉',
  REVEAL:    '◎',
  TIMEOUT:   '⏱',
  COMMIT:    '🔒',
  UNKNOWN:   '?',
};

const ALL_TYPES = 'ALL';
type FilterType = HistoryEventType | typeof ALL_TYPES;

const KNOWN_TYPES: HistoryEventType[] = [
  'CREATE', 'JOIN', 'COMMIT', 'REVEAL', 'FOLD', 'NEXT_HAND',
  'TBL_SIT', 'TBL_START', 'TBL_ADDED',
  'CHECK', 'CALL', 'RAISE', 'PAYOUT',
  'SHUFFLE', 'TIMEOUT',
];

function shortAddr(addr: string | null): string {
  if (!addr) return '—';
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch { return iso; }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  } catch { return ''; }
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const { events, loading, error, lastFetch, fetch } = useBlockchainHistory();
  const [filter, setFilter] = useState<FilterType>(ALL_TYPES);
  const [hoursBack, setHoursBack] = useState(24);
  const bodyRef = useRef<HTMLDivElement>(null);
  const contractId = POKER_ZK_CONTRACT || '—';

  useEffect(() => {
    fetch(undefined, hoursBack);
  }, [fetch, hoursBack]);

  /* Auto-scroll to bottom when new events arrive */
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events, filter]);

  const filtered = filter === ALL_TYPES
    ? events
    : events.filter(e => e.type === filter);

  const foundTypes = Array.from(new Set(events.map(e => e.type)));
  const filterTypes = Array.from(new Set([...KNOWN_TYPES, ...foundTypes]));

  return (
    <div className="hp-panel">

        {/* ── Top bar ── */}
        <div className="hp-titlebar">
          <span className="hp-title">⛓ Blockchain History</span>
          <button type="button" className="hp-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* ── Meta info ── */}
        <div className="hp-meta">
          <div className="hp-meta-row">
            <span className="hp-key">CONTRACT</span>
            <a
              className="hp-val hp-mono hp-link"
              href={`${EXPLORER}/contract/${contractId}`}
              target="_blank"
              rel="noopener noreferrer"
              title="View contract on stellar.expert"
            >{shortAddr(contractId)} ↗</a>
          </div>
          <div className="hp-meta-row">
            <span className="hp-key">NETWORK</span>
            <a
              className="hp-val hp-link"
              href={EXPLORER}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#ffd700' }}
            >TESTNET ↗</a>
          </div>
          <div className="hp-meta-row">
            <span className="hp-key">SYNC</span>
            <span className="hp-val">{lastFetch ? lastFetch.toLocaleTimeString('en-US', { hour12: false }) : '—'}</span>
          </div>
          <div className="hp-meta-row">
            <span className="hp-key">EVENTS</span>
            <span className="hp-val" style={{ color: '#00ff88' }}>{filtered.length}</span>
          </div>
        </div>

        {/* ── Controls ── */}
        <div className="hp-controls">
          <select
            className="hp-select"
            value={filter}
            onChange={e => setFilter(e.target.value as FilterType)}
          >
            <option value={ALL_TYPES}>ALL EVENTS</option>
            {filterTypes.map(t => {
              const count = events.filter(e => e.type === t).length;
              return (
                <option key={t} value={t}>
                  {t}{count > 0 ? ` (${count})` : ''}
                </option>
              );
            })}
          </select>

          <select
            className="hp-select"
            value={hoursBack}
            onChange={e => setHoursBack(Number(e.target.value))}
          >
            <option value={6}>LAST 6H</option>
            <option value={12}>LAST 12H</option>
            <option value={24}>LAST 24H</option>
            <option value={48}>LAST 48H</option>
          </select>

          <button
            type="button"
            className="hp-refresh-btn"
            onClick={() => fetch(undefined, hoursBack)}
            disabled={loading}
          >
            {loading ? '⟳ …' : '↺ REFRESH'}
          </button>
        </div>

        {/* ── Events list ── */}
        <div className="hp-body" ref={bodyRef}>

          {loading && events.length === 0 && (
            <div className="hp-loading">
              <span className="hp-spinner">⟳</span>
              <span> Fetching events…</span>
            </div>
          )}

          {error && (
            <div className="hp-error-line">
              <span style={{ color: '#ff5555' }}>✕ </span>{error}
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="hp-empty">No events found.</div>
          )}

          {filtered.map((ev, i) => (
            <EventLine key={ev.id} ev={ev} prev={filtered[i - 1]} />
          ))}
        </div>

      </div>
  );
}

function EventLine({ ev, prev }: { ev: HistoryEvent; prev?: HistoryEvent }) {
  const color = EVENT_COLOR[ev.type] ?? EVENT_COLOR.UNKNOWN;
  const icon  = EVENT_ICON[ev.type]  ?? '?';

  const sameDay = prev && fmtDate(prev.timestamp) === fmtDate(ev.timestamp);

  return (
    <div className="hp-event">
      {!sameDay && ev.timestamp && (
        <div className="hp-date-sep">{fmtDate(ev.timestamp)}</div>
      )}
      <div className="hp-event-header">
        <a
          className="hp-ledger hp-link"
          href={`${EXPLORER}/ledger/${ev.ledger}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`View ledger #${ev.ledger} on stellar.expert`}
        >#{ev.ledger} ↗</a>
        <span className="hp-time">{fmtTime(ev.timestamp)}</span>
        <span className="hp-event-type" style={{ color }}>
          {icon} {ev.type}
        </span>
        {ev.gameId && (
          <span className="hp-tag" style={{ color: '#aaa' }}>game&nbsp;<span style={{ color: '#fff' }}>#{ev.gameId}</span></span>
        )}
        {ev.tableId && !ev.gameId && (
          <span className="hp-tag" style={{ color: '#aaa' }}>table&nbsp;<span style={{ color: '#fff' }}>#{ev.tableId}</span></span>
        )}
      </div>
      {ev.player && (
        <div className="hp-player-line">
          <span style={{ color: '#555' }}>  └ </span>
          <span style={{ color: '#888' }}>player </span>
          <a
            className="hp-mono hp-link"
            href={`${EXPLORER}/account/${ev.player}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#00ccff', fontSize: '0.7rem' }}
            title="View account on stellar.expert"
          >{ev.player}</a>
        </div>
      )}
    </div>
  );
}
