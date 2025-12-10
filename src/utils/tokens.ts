import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface TokenSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
}

export interface TokenDetailData {
  mint: string;
  symbol: string;
  name: string;
  logoURI?: string;
  bannerURI?: string;
  socials?: TokenSocials;
  price: number;
  priceChange24h?: number;
  volume24h?: number;
  liquidity?: number;
  marketCap?: number;
  fdv?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  pairAddress?: string;
  dexId?: string;
  pairCreatedAt?: number;
}

export interface TokenData {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
  price: number;
  value: number;
  logoURI?: string;
  bannerURI?: string;
  socials?: TokenSocials;
  change24h?: number;
}

// Local cache for token metadata (logos, names, symbols)
const TOKEN_CACHE_KEY = 'token_metadata_cache';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedTokenData {
  symbol: string;
  name: string;
  logoURI?: string;
  timestamp: number;
}

const getTokenCache = (): Map<string, CachedTokenData> => {
  try {
    const cached = localStorage.getItem(TOKEN_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error('Error reading token cache:', e);
  }
  return new Map();
};

const saveTokenCache = (cache: Map<string, CachedTokenData>) => {
  try {
    const obj = Object.fromEntries(cache);
    localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.error('Error saving token cache:', e);
  }
};

// Mark a logo as successfully loaded (called from UI)
export const cacheSuccessfulLogo = (mint: string, logoURI: string, symbol: string, name: string) => {
  const cache = getTokenCache();
  cache.set(mint, { symbol, name, logoURI, timestamp: Date.now() });
  saveTokenCache(cache);
};

// Mark a logo as failed (so we don't try it again)
export const cacheFailedLogo = (mint: string, symbol: string, name: string) => {
  const cache = getTokenCache();
  cache.set(mint, { symbol, name, logoURI: undefined, timestamp: Date.now() });
  saveTokenCache(cache);
};

// Jupiter APIs - V2 supports ALL tokens including Pump.fun
const JUPITER_TOKENS_V2_API = "https://lite-api.jup.ag/tokens/v2/search";
const JUPITER_PRICE_V3_API = "https://lite-api.jup.ag/price/v3";
// CoinGecko API (fallback for SOL price)
const COINGECKO_PRICE_API = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";

interface JupiterTokenV2 {
  id: string;
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  usdPrice?: number;
  priceChange24h?: number;
  tags?: string[];
}

export const getSolanaPrice = async (): Promise<number> => {
    try {
        // Try Jupiter Price API V3 first (more reliable)
        const jupResponse = await fetch(`${JUPITER_PRICE_V3_API}?ids=So11111111111111111111111111111111111111112`);
        if (jupResponse.ok) {
            const data = await jupResponse.json();
            const solPrice = data['So11111111111111111111111111111111111111112']?.usdPrice;
            if (solPrice) return solPrice;
        }
        
        // Fallback to CoinGecko
        const response = await fetch(COINGECKO_PRICE_API);
        if (response.status === 429) {
            console.warn("CoinGecko Rate Limit (429). Using fallback price.");
            return 240.00; // Fallback price
        }
        const data = await response.json();
        return data.solana?.usd || 0;
    } catch (e) {
        console.error("Failed to fetch SOL price", e);
        return 240.00; // Fallback price
    }
};

// Fetch token metadata and price from Jupiter V2 API (supports ALL tokens including Pump.fun)
const fetchTokenMetadata = async (mints: string[]): Promise<Map<string, JupiterTokenV2>> => {
    const metadataMap = new Map<string, JupiterTokenV2>();
    const cache = getTokenCache();
    const now = Date.now();
    
    // Check cache first - use cached data if available and not expired
    const mintsNeedingFetch: string[] = [];
    for (const mint of mints) {
        const cached = cache.get(mint);
        if (cached && (now - cached.timestamp) < CACHE_EXPIRY_MS) {
            // Use cached data
            metadataMap.set(mint, {
                id: mint,
                name: cached.name,
                symbol: cached.symbol,
                icon: cached.logoURI,
                decimals: 0, // Will be filled from chain data
            });
        } else {
            mintsNeedingFetch.push(mint);
        }
    }
    
    // Only fetch mints that aren't cached
    if (mintsNeedingFetch.length === 0) {
        console.log('[TokenCache] All tokens found in cache');
        return metadataMap;
    }
    
    console.log(`[TokenCache] Fetching ${mintsNeedingFetch.length} tokens from API (${mints.length - mintsNeedingFetch.length} from cache)`);
    
    // Jupiter V2 search API needs individual queries per mint address
    // Fetch in parallel for speed, limit to first 15 tokens
    const mintsToFetch = mintsNeedingFetch.slice(0, 15);
    
    try {
        const promises = mintsToFetch.map(async (mint) => {
            try {
                const response = await fetch(`${JUPITER_TOKENS_V2_API}?query=${mint}`);
                if (response.ok) {
                    const tokens: JupiterTokenV2[] = await response.json();
                    // Find exact match by mint address (id field)
                    const exactMatch = tokens.find(t => t.id === mint);
                    if (exactMatch) {
                        return { mint, token: exactMatch };
                    }
                }
            } catch (e) {
                // Silent fail for individual tokens
            }
            return null;
        });
        
        const results = await Promise.all(promises);
        results.forEach(result => {
            if (result) {
                metadataMap.set(result.mint, result.token);
            }
        });
    } catch (e) {
        console.error("Error fetching token metadata from Jupiter V2:", e);
    }
    
    return metadataMap;
};

// Fetch banners and socials from DexScreener API
interface DexScreenerData {
    banner?: string;
    socials?: TokenSocials;
}

const fetchDexScreenerData = async (mints: string[]): Promise<Map<string, DexScreenerData>> => {
    const dataMap = new Map<string, DexScreenerData>();
    
    try {
        // DexScreener API - fetch token profiles for banners and socials
        // Limit to first 10 tokens to avoid too many requests
        const mintsToFetch = mints.slice(0, 10);
        
        for (const mint of mintsToFetch) {
            try {
                const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
                if (response.ok) {
                    const data = await response.json();
                    // DexScreener returns pairs, get info from the first pair
                    if (data.pairs && data.pairs.length > 0) {
                        const pair = data.pairs[0];
                        const tokenData: DexScreenerData = {};
                        
                        // Get banner/header
                        if (pair.info?.header) {
                            tokenData.banner = pair.info.header;
                        }
                        
                        // Get socials from pair.info.socials array
                        if (pair.info?.socials && Array.isArray(pair.info.socials)) {
                            const socials: TokenSocials = {};
                            for (const social of pair.info.socials) {
                                if (social.type === 'twitter' && social.url) socials.twitter = social.url;
                                if (social.type === 'telegram' && social.url) socials.telegram = social.url;
                                if (social.type === 'discord' && social.url) socials.discord = social.url;
                            }
                            // Get website from pair.info.websites array
                            if (pair.info.websites && Array.isArray(pair.info.websites) && pair.info.websites.length > 0) {
                                socials.website = pair.info.websites[0].url || pair.info.websites[0];
                            }
                            if (Object.keys(socials).length > 0) {
                                tokenData.socials = socials;
                            }
                        }
                        
                        if (tokenData.banner || tokenData.socials) {
                            dataMap.set(mint, tokenData);
                        }
                    }
                }
            } catch (e) {
                // Silent fail for individual tokens
            }
        }
    } catch (e) {
        console.error("Error fetching data from DexScreener:", e);
    }
    
    return dataMap;
};

// Fetch detailed token data from DexScreener for a single token
export const fetchTokenDetailData = async (mint: string, baseTokenData?: TokenData): Promise<TokenDetailData | null> => {
    try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
        if (!response.ok) return null;
        
        const data = await response.json();
        if (!data.pairs || data.pairs.length === 0) return null;
        
        // Get the most liquid/active pair (usually first)
        const pair = data.pairs[0];
        
        // Parse socials
        let socials: TokenSocials | undefined;
        if (pair.info?.socials && Array.isArray(pair.info.socials)) {
            socials = {};
            for (const social of pair.info.socials) {
                if (social.type === 'twitter' && social.url) socials.twitter = social.url;
                if (social.type === 'telegram' && social.url) socials.telegram = social.url;
                if (social.type === 'discord' && social.url) socials.discord = social.url;
            }
            if (pair.info.websites && Array.isArray(pair.info.websites) && pair.info.websites.length > 0) {
                socials.website = pair.info.websites[0].url || pair.info.websites[0];
            }
        }
        
        const detailData: TokenDetailData = {
            mint,
            symbol: pair.baseToken?.symbol || baseTokenData?.symbol || 'Unknown',
            name: pair.baseToken?.name || baseTokenData?.name || 'Unknown Token',
            logoURI: pair.info?.imageUrl || baseTokenData?.logoURI,
            bannerURI: pair.info?.header || baseTokenData?.bannerURI,
            socials,
            price: pair.priceUsd ? parseFloat(pair.priceUsd) : baseTokenData?.price || 0,
            priceChange24h: pair.priceChange?.h24 !== undefined ? parseFloat(pair.priceChange.h24) : baseTokenData?.change24h,
            volume24h: pair.volume?.h24 !== undefined ? parseFloat(pair.volume.h24) : undefined,
            liquidity: pair.liquidity?.usd !== undefined ? parseFloat(pair.liquidity.usd) : undefined,
            marketCap: pair.marketCap !== undefined ? parseFloat(pair.marketCap) : undefined,
            fdv: pair.fdv !== undefined ? parseFloat(pair.fdv) : undefined,
            pairAddress: pair.pairAddress,
            dexId: pair.dexId,
            pairCreatedAt: pair.pairCreatedAt
        };
        
        return detailData;
    } catch (e) {
        console.error("Error fetching token detail data:", e);
        return null;
    }
};

// Fetch prices from Jupiter Price V3 API
const fetchTokenPrices = async (mints: string[]): Promise<Map<string, { usdPrice: number; priceChange24h?: number }>> => {
    const priceMap = new Map<string, { usdPrice: number; priceChange24h?: number }>();
    
    try {
        // Jupiter Price V3 allows up to 50 mints at once
        const chunks = [];
        for (let i = 0; i < mints.length; i += 50) {
            chunks.push(mints.slice(i, i + 50));
        }
        
        for (const chunk of chunks) {
            const mintsQuery = chunk.join(',');
            const response = await fetch(`${JUPITER_PRICE_V3_API}?ids=${mintsQuery}`);
            
            if (response.ok) {
                const data = await response.json();
                for (const mint of chunk) {
                    if (data[mint]) {
                        priceMap.set(mint, {
                            usdPrice: data[mint].usdPrice || 0,
                            priceChange24h: data[mint].priceChange24h
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error("Error fetching prices from Jupiter V3:", e);
    }
    
    return priceMap;
};

export const fetchUserTokens = async (connection: Connection, walletPublicKey: PublicKey): Promise<TokenData[]> => {
  try {
    // 1. Fetch all token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
      programId: TOKEN_PROGRAM_ID,
    });

    // 2. Filter for non-zero balance
    const activeTokens = tokenAccounts.value.filter((account) => {
      const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
      return amount > 0;
    });

    if (activeTokens.length === 0) return [];

    // 3. Get Mints
    const mints = activeTokens.map((t) => t.account.data.parsed.info.mint);
    
    // 4. Fetch Metadata from Jupiter V2 API (supports ALL tokens including Pump.fun)
    const metadataMap = await fetchTokenMetadata(mints);
    
    // 5. Fetch Prices from Jupiter Price V3 API
    const priceMap = await fetchTokenPrices(mints);
    
    // 6. Fetch Banners & Socials from DexScreener API
    const dexScreenerData = await fetchDexScreenerData(mints);

    // 7. Combine Data
    const tokens: TokenData[] = activeTokens.map((t) => {
      const mint = t.account.data.parsed.info.mint;
      const amount = t.account.data.parsed.info.tokenAmount.uiAmount;
      const decimals = t.account.data.parsed.info.tokenAmount.decimals;
      
      const meta = metadataMap.get(mint);
      const priceInfo = priceMap.get(mint);
      
      // Use Jupiter V2 metadata price if available, otherwise use Price V3
      const price = meta?.usdPrice || priceInfo?.usdPrice || 0;
      const change24h = meta?.priceChange24h || priceInfo?.priceChange24h || 0;

      const dexData = dexScreenerData.get(mint);
      
      return {
        mint,
        symbol: meta?.symbol || "UNKNOWN",
        name: meta?.name || "Unknown Token",
        amount,
        decimals,
        price,
        value: amount * price,
        logoURI: meta?.icon,
        bannerURI: dexData?.banner,
        socials: dexData?.socials,
        change24h
      };
    });

    // Sort by value
    return tokens.sort((a, b) => b.value - a.value);

  } catch (e) {
    console.error("Error fetching tokens:", e);
    return [];
  }
};
