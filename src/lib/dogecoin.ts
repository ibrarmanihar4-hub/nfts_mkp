// Dogecoin network params for bitcoinjs-lib.
// Source: https://github.com/dogecoin/dogecoin/blob/master/src/chainparams.cpp
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory, ECPairAPI } from 'ecpair';

bitcoin.initEccLib(ecc);

export const dogecoinNetwork: bitcoin.networks.Network = {
  messagePrefix: '\x19Dogecoin Signed Message:\n',
  bech32: 'doge', // unused (no native segwit on doge)
  bip32: { public: 0x02facafd, private: 0x02fac398 },
  pubKeyHash: 0x1e, // addresses start with "D"
  scriptHash: 0x16,
  wif: 0x9e, // private keys start with "Q" or "6"
};

export const ECPair: ECPairAPI = ECPairFactory(ecc);
export { bitcoin };
