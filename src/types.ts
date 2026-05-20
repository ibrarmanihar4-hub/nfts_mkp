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

export type HitStatus = 'DETECTED' | 'NOTIFIED' | 'BUYING' | 'BOUGHT' | 'FAILED';
