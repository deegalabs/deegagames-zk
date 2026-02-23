/**
 * Auth Entry utilities for multi-sig transaction flows
 */

import { Buffer } from 'buffer';
import { xdr, Address, authorizeEntry } from '@stellar/stellar-base';
import { contract } from '@stellar/stellar-sdk';
import { calculateValidUntilLedger } from './ledgerUtils';
import { DEFAULT_AUTH_TTL_MINUTES } from './constants';

type CredsLike = { address?: () => { address?: () => unknown } };

/**
 * Obtém tipo e endereço das credentials sem aceder a .switch() (evita "reading 'switch'" quando o objeto não o expõe).
 * Infere "sorobanCredentialsAddress" pela presença de .address().
 */
export function getCredentialTypeAndAddress(creds: unknown): { type: string; addressString: string } | null {
  if (creds == null) return null;
  const c = creds as CredsLike;
  if (typeof c.address !== 'function') return null;
  try {
    const addr = c.address();
    const scAddr = addr?.address?.();
    const addressString = scAddr != null ? Address.fromScAddress(scAddr).toString() : '';
    if (!addressString) return null;
    return { type: 'sorobanCredentialsAddress', addressString };
  } catch {
    return null;
  }
}

/**
 * Obtém o endereço (string) a partir das credentials de um auth entry. Não usa .switch().
 */
export function getAddressFromAuthEntryCredentials(creds: unknown): string | null {
  const info = getCredentialTypeAndAddress(creds);
  return info?.addressString ?? null;
}

/**
 * Inject a signed auth entry from Player 1 into Player 2's transaction
 * Used in multi-sig flows where Player 1 has pre-signed an auth entry
 *
 * @param tx - The assembled transaction from Player 2
 * @param player1AuthEntryXDR - Player 1's signed auth entry in XDR format
 * @param player2Address - Player 2's address
 * @param player2Signer - Player 2's signing functions
 * @returns Updated transaction with both auth entries signed
 */
export async function injectSignedAuthEntry(
  tx: contract.AssembledTransaction<any>,
  player1AuthEntryXDR: string,
  player2Address: string,
  player2Signer: Pick<contract.ClientOptions, 'signTransaction' | 'signAuthEntry'>,
  validUntilLedgerSeq?: number
): Promise<contract.AssembledTransaction<any>> {
  // Parse Player 1's signed auth entry (sem usar .switch() para evitar erro em alguns ambientes)
  const player1SignedAuthEntry = xdr.SorobanAuthorizationEntry.fromXDR(
    player1AuthEntryXDR,
    'base64'
  );
  const player1Creds = player1SignedAuthEntry.credentials?.();
  const player1AddressString =
    getAddressFromAuthEntryCredentials(player1Creds) ??
    (() => {
      throw new Error('Invalid Player 1 auth entry: could not read address from credentials');
    })();

  // Get the simulation data
  if (!tx.simulationData?.result?.auth) {
    throw new Error('No auth entries found in transaction simulation');
  }

  const authEntries = tx.simulationData.result.auth;

  // Find Player 1's stub entry and Player 2's entry
  let player1StubIndex = -1;
  let player2AuthEntry: xdr.SorobanAuthorizationEntry | null = null;
  let player2Index = -1;

  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    try {
      const creds = entry?.credentials?.();
      const info = getCredentialTypeAndAddress(creds);
      if (!info?.type) continue;

      // Note: the invoker (transaction source) may show up as `sorobanCredentialsSourceAccount`,
      // which does NOT require an auth entry signature (it is authorized by the envelope signature).
      if (info.type === 'sorobanCredentialsAddress' && info.addressString) {
        const entryAddressString = info.addressString;

        if (entryAddressString === player1AddressString) {
          player1StubIndex = i;
        } else if (entryAddressString === player2Address) {
          player2AuthEntry = entry;
          player2Index = i;
        }
      }
    } catch {
      continue;
    }
  }

  if (player1StubIndex === -1) {
    throw new Error('Could not find Player 1 stub entry in transaction');
  }

  // Replace Player 1's stub with their signed entry
  authEntries[player1StubIndex] = player1SignedAuthEntry;

  // Entradas que não têm credentials de endereço (ex.: source account) podem ser objetos da simulação
  // sem .credentials().switch(); o SDK chama isso em sign() e falha. Substituir por uma instância
  // XDR explícita do tipo sorobanCredentialsSourceAccount (mesmo rootInvocation que P1).
  for (let i = 0; i < authEntries.length; i++) {
    const entry = authEntries[i];
    const creds = entry?.credentials?.();
    if (getCredentialTypeAndAddress(creds) === null) {
      authEntries[i] = new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation: player1SignedAuthEntry.rootInvocation(),
      });
    }
  }

  // O sign() do SDK usa this.built.operations[0].auth, não simulationData.result.auth. Garantir
  // que o built usa o mesmo array com as entradas já substituídas (P1 assinada + source account XDR).
  const built = (tx as { built?: { operations?: { auth?: xdr.SorobanAuthorizationEntry[] }[] } }).built;
  if (built?.operations?.[0]) {
    built.operations[0].auth = authEntries;
  }

  // Sign Player 2's auth entry (only if Player 2 appears as a non-invoker address auth entry)
  if (player2AuthEntry && player2Index !== -1) {
    if (!player2Signer.signAuthEntry) {
      throw new Error('signAuthEntry function not available');
    }

    // authorizeEntry() do stellar-base chama entry.credentials().switch() — as entradas da simulação
    // podem não ser instâncias XDR completas e credentials() devolve algo sem .switch(). Normalizar
    // via XDR para obter uma instância com credentials().switch() definido.
    let entryToSign: xdr.SorobanAuthorizationEntry = player2AuthEntry;
    try {
      if (typeof (player2AuthEntry as { toXDR?: (f?: string) => string | Buffer }).toXDR === 'function') {
        const raw = (player2AuthEntry as { toXDR: (f: string) => string }).toXDR('base64');
        entryToSign = xdr.SorobanAuthorizationEntry.fromXDR(raw, 'base64');
      }
    } catch {
      // use entry as-is if normalisation fails
    }

    const authValidUntilLedgerSeq =
      validUntilLedgerSeq ??
      (await calculateValidUntilLedger(tx.options.rpcUrl, DEFAULT_AUTH_TTL_MINUTES));

    const player2SignedAuthEntry = await authorizeEntry(
      entryToSign,
      async (preimage: xdr.HashIdPreimage) => {
        if (!player2Signer.signAuthEntry) {
          throw new Error('Wallet does not support auth entry signing');
        }

        const signResult = await player2Signer.signAuthEntry(preimage.toXDR('base64'), {
          networkPassphrase: tx.options.networkPassphrase,
          address: player2Address,
        });

        if (signResult.error) {
          throw new Error(`Failed to sign auth entry: ${signResult.error.message}`);
        }

        return Buffer.from(signResult.signedAuthEntry, 'base64');
      },
      authValidUntilLedgerSeq,
      tx.options.networkPassphrase
    );

    authEntries[player2Index] = player2SignedAuthEntry;
  }

  // O SDK faz entry.credentials().toXDR() e depois credentials.switch(). Se entry.credentials()
  // for undefined ou não tiver toXDR(), falha. Substituir só entradas inválidas (não P1/P2 assinadas).
  const rootInv = player1SignedAuthEntry.rootInvocation();
  for (let i = 0; i < authEntries.length; i++) {
    if (i === player1StubIndex || i === player2Index) continue;
    const entry = authEntries[i];
    const creds = entry?.credentials?.();
    try {
      if (creds == null || typeof (creds as { toXDR?: (f: string) => string }).toXDR !== 'function') {
        authEntries[i] = new xdr.SorobanAuthorizationEntry({
          credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
          rootInvocation: rootInv,
        });
        continue;
      }
      (creds as { toXDR: (f: string) => string }).toXDR('base64');
    } catch {
      authEntries[i] = new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation: rootInv,
      });
    }
  }

  // O SDK em sign() lê auth de this.built.operations[0].auth. Garantir que esse array é o que editámos:
  // se for outra referência, sincronizar in-place para o SDK ver as nossas entradas.
  const builtAuth = built?.operations?.[0]?.auth;
  if (builtAuth && Array.isArray(builtAuth) && builtAuth !== authEntries) {
    builtAuth.length = 0;
    builtAuth.push(...authEntries);
  } else if (built?.operations?.[0]) {
    built.operations[0].auth = authEntries;
  }

  return tx;
}
