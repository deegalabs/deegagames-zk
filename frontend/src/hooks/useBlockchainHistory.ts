import { useState, useCallback } from 'react';
import { rpc, xdr } from '@stellar/stellar-sdk';
import { scValToNative } from '@stellar/stellar-base';
import { RPC_URL, POKER_ZK_CONTRACT } from '@/utils/constants';

/**
 * Converte um ScVal para valor nativo.
 * Suporta tanto objetos xdr.ScVal já decodificados (SDK v12+)
 * quanto strings base64 (SDK v11).
 */
function nativeFrom(val: unknown): unknown {
  if (val == null) return null;
  try {
    // SDK v12+: já é um objeto xdr.ScVal com método .switch()
    if (typeof (val as { switch?: unknown }).switch === 'function') {
      return scValToNative(val as xdr.ScVal);
    }
    // SDK v11: string base64 XDR
    if (typeof val === 'string' && val.length > 0) {
      return scValToNative(xdr.ScVal.fromXDR(val, 'base64'));
    }
  } catch { /* ignora falhas de parse */ }
  return null;
}

/** Extrai o contractId string de Contract object ou string. */
function resolveContractId(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  // Contract object tem .contractId() ou .toString()
  const c = raw as { contractId?: () => string; toString?: () => string };
  if (typeof c.contractId === 'function') return c.contractId();
  if (typeof c.toString === 'function') {
    const s = c.toString();
    if (s !== '[object Object]') return s;
  }
  return '';
}

/** Extrai o value de um evento — suporta xdr.ScVal direto ou { xdr: string }. */
function resolveValue(val: unknown): unknown {
  if (val == null) return null;
  // { xdr: string } (formato antigo)
  const asObj = val as { xdr?: string };
  if (typeof asObj.xdr === 'string') return nativeFrom(asObj.xdr);
  // xdr.ScVal direto
  return nativeFrom(val);
}

export type HistoryEventType =
  | 'CREATE' | 'JOIN' | 'FOLD' | 'NEXT_HAND'
  | 'TBL_SIT' | 'TBL_START' | 'TBL_ADDED'
  | 'CHECK' | 'CALL' | 'RAISE' | 'PAYOUT'
  | 'SHUFFLE' | 'REVEAL' | 'TIMEOUT' | 'COMMIT'
  | 'UNKNOWN';

export interface HistoryEvent {
  id: string;
  ledger: number;
  timestamp: string;
  type: HistoryEventType;
  gameId: string | null;
  tableId: string | null;
  player: string | null;
  contractId: string;
}

const LEDGERS_PER_HOUR = 720; // ~5s por ledger

export function useBlockchainHistory() {
  const [events, setEvents]       = useState<HistoryEvent[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetch = useCallback(async (contractId?: string, hoursBack = 24) => {
    const cId = contractId || POKER_ZK_CONTRACT;
    if (!cId) { setError('Contract ID not configured'); return; }

    setLoading(true);
    setError(null);

    try {
      const server = new rpc.Server(RPC_URL, { allowHttp: true });
      const latest = await server.getLatestLedger();
      const startLedger = Math.max(1, latest.sequence - LEDGERS_PER_HOUR * hoursBack);

      const response = await server.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds: [cId] }],
        limit: 200,
      });

      const parsed: HistoryEvent[] = (response.events ?? []).map(ev => {
        // Tópicos podem ser xdr.ScVal[] (SDK v12) ou string[] (SDK v11)
        const rawTopics: unknown[] = Array.isArray(ev.topic) ? ev.topic : [];
        const topics = rawTopics.map(t => nativeFrom(t));
        const value  = resolveValue(ev.value);

        // topic[0] é sempre o nome do evento (Symbol)
        let typeName = topics[0];
        // Symbol nativo vira Symbol JS — converte para string
        if (typeof typeName === 'symbol') typeName = String(typeName).replace(/^Symbol\(|\)$/g, '');
        const type = (typeof typeName === 'string' && typeName.length > 0
          ? typeName
          : 'UNKNOWN') as HistoryEventType;

        let gameId: string | null  = null;
        let tableId: string | null = null;
        let player: string | null  = null;

        const g1 = topics[1] != null ? String(topics[1]) : null;
        const g2 = topics[2] != null ? String(topics[2]) : null;
        const v  = value     != null ? String(value)     : null;

        switch (type) {
          case 'CREATE':
          case 'JOIN':
          case 'FOLD':
          case 'NEXT_HAND':
          case 'CHECK':
          case 'CALL':
          case 'RAISE':
          case 'SHUFFLE':
          case 'REVEAL':
          case 'TIMEOUT':
          case 'PAYOUT':
          case 'COMMIT':
            gameId = g1; player = v;
            break;
          case 'TBL_START':
            tableId = g1; gameId = g2; player = v;
            break;
          case 'TBL_SIT':
          case 'TBL_ADDED':
            tableId = g1; player = v;
            break;
          default:
            gameId = g1;
        }

        return {
          id: String(ev.id ?? ''),
          ledger: Number(ev.ledger ?? 0),
          timestamp: String(ev.ledgerClosedAt ?? ''),
          type,
          gameId,
          tableId,
          player,
          contractId: resolveContractId(ev.contractId),
        };
      });

      setEvents(parsed);
      setLastFetch(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  }, []);

  return { events, loading, error, lastFetch, fetch };
}
