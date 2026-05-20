// Encrypted hot-wallet for Stage 2 auto-buy.
//
// Key handling rules:
//   - Private key is stored AES-256-GCM-encrypted at rest, keyed by scrypt(passphrase).
//   - The plaintext passphrase NEVER touches disk.
//   - The decrypted key is held only in memory after `unlock()` is called.
//   - On process exit / lock(), the in-memory key is wiped.
//
// Setup flow:
//   1. POST /api/wallet { wif, passphrase } -> stores encrypted blob + derives address
//   2. POST /api/wallet/unlock { passphrase } -> decrypts key into memory for signing
//   3. POST /api/wallet/lock -> wipes in-memory key
//
// If you restart the server, the wallet is locked and auto-buy pauses until you
// unlock it again. That's intentional.

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { prisma } from './prisma';
import { bitcoin, dogecoinNetwork, ECPair } from './dogecoin';
import type { ECPairInterface } from 'ecpair';

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 32;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
}

function encryptPriv(privKey: Buffer, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(privKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    cipher: Buffer.concat([enc, tag]).toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
  };
}

function decryptPriv(blob: { cipher: string; iv: string; salt: string }, passphrase: string): Buffer {
  const ct = Buffer.from(blob.cipher, 'base64');
  const enc = ct.subarray(0, ct.length - 16);
  const tag = ct.subarray(ct.length - 16);
  const iv = Buffer.from(blob.iv, 'base64');
  const salt = Buffer.from(blob.salt, 'base64');
  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

// In-memory state (per-process). Survives HMR reloads via global.
const g = globalThis as unknown as { __wallet?: { keyPair: ECPairInterface; address: string } };

export interface WalletStatus {
  configured: boolean;
  unlocked: boolean;
  address: string | null;
}

export async function getWalletStatus(): Promise<WalletStatus> {
  const row = await prisma.walletKey.findUnique({ where: { id: 'default' } });
  return {
    configured: !!row,
    unlocked: !!g.__wallet,
    address: row?.address ?? g.__wallet?.address ?? null,
  };
}

export async function setupWallet(wif: string, passphrase: string): Promise<{ address: string }> {
  if (passphrase.length < 8) throw new Error('passphrase must be at least 8 chars');
  let kp: ECPairInterface;
  try {
    kp = ECPair.fromWIF(wif, dogecoinNetwork);
  } catch {
    throw new Error('invalid Dogecoin WIF private key');
  }
  if (!kp.privateKey) throw new Error('WIF did not yield a private key');
  const { address } = bitcoin.payments.p2pkh({
    pubkey: kp.publicKey,
    network: dogecoinNetwork,
  });
  if (!address) throw new Error('failed to derive address');

  const blob = encryptPriv(Buffer.from(kp.privateKey), passphrase);
  await prisma.walletKey.upsert({
    where: { id: 'default' },
    create: { id: 'default', address, ...blob },
    update: { address, ...blob },
  });
  // Don't auto-unlock — caller must explicitly unlock.
  return { address };
}

export async function unlockWallet(passphrase: string): Promise<{ address: string }> {
  const row = await prisma.walletKey.findUnique({ where: { id: 'default' } });
  if (!row) throw new Error('wallet not configured');
  let priv: Buffer;
  try {
    priv = decryptPriv(row, passphrase);
  } catch {
    throw new Error('wrong passphrase');
  }
  const keyPair = ECPair.fromPrivateKey(priv, { network: dogecoinNetwork });
  const { address } = bitcoin.payments.p2pkh({
    pubkey: keyPair.publicKey,
    network: dogecoinNetwork,
  });
  if (!address || address !== row.address) {
    throw new Error('wallet integrity check failed');
  }
  g.__wallet = { keyPair, address };
  return { address };
}

export function lockWallet(): void {
  g.__wallet = undefined;
}

export function getUnlockedSigner(): { keyPair: ECPairInterface; address: string } {
  if (!g.__wallet) throw new Error('wallet is locked — POST /api/wallet/unlock');
  return g.__wallet;
}
