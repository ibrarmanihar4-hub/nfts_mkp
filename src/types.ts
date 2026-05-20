// Shape of items in the `recentlyListed` array returned by
// https://api.doggy.market/nfts/{slug}
export interface DoggyListing {
  inscriptionId: string;
  inscriptionNumber?: number;
  status: string; // "listed", "bought", ...
  type: string; // "nft"
  contentType: string;
  sellerAddress: string;
  listedAt: string; // ISO timestamp
  price: number; // shibes (1 DOGE = 1e8)
}

export interface DoggyCollectionResponse {
  volume: number;
  listed: number;
  recentlyListed: DoggyListing[];
  recentlySold: DoggyListing[];
  // (other stats fields exist but we don't need them for sniping)
}

export type HitStatus = 'DETECTED' | 'NOTIFIED' | 'BUYING' | 'BOUGHT' | 'FAILED' | 'SKIPPED';

// GET /inscriptions/{id}
export interface DoggyInscription {
  inscriptionId: string;
  inscriptionNumber: number;
  owner: string;
  nft?: {
    collectionId?: string;
    itemName?: string;
    itemId?: string;
  };
  listed?: {
    listingId: string;
    status: string; // "listed"
    price: number; // shibes
    listedAt: string;
  };
}

// POST /buyer/createBuyingPSBT response. Field name is observed; the API
// likely returns the unsigned-by-buyer PSBT here. Adjust if doggy.market
// returns a different shape.
export interface DoggyBuyingPSBT {
  buyingPSBTBase64?: string;
  psbtBase64?: string;
  // Some implementations also return outputs the buyer must approve.
  totalShibes?: number;
}

export interface DoggyBuyResult {
  txId?: string;
  txid?: string;
  status?: string;
  message?: string;
}
