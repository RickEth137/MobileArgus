import { Connection, Keypair, clusterApiUrl, Transaction, VersionedTransaction, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js"
import bs58 from "bs58"
import * as anchor from "@coral-xyz/anchor";
import * as bip39 from "bip39";
import { Buffer } from "buffer";

// Polyfill Buffer for browser environment if needed
if (typeof window !== 'undefined') {
    window.Buffer = window.Buffer || Buffer;
}

export const connection = new Connection(
  "https://methodical-flashy-tab.solana-mainnet.quiknode.pro/8646c55f34925aabfc2e920cc12c8c236183c29f/",
  {
    commitment: "confirmed",
    wsEndpoint: "wss://methodical-flashy-tab.solana-mainnet.quiknode.pro/8646c55f34925aabfc2e920cc12c8c236183c29f/"
  }
)

export const createNewWallet = () => {
  const mnemonic = bip39.generateMnemonic();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  // Use the first 32 bytes of the seed for the keypair (Simplified derivation)
  const keypair = Keypair.fromSeed(new Uint8Array(seed.slice(0, 32)));
  
  return {
    mnemonic,
    keypair,
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey)
  };
}

export const generateKeypair = () => {
  const kp = Keypair.generate()
  return {
    publicKey: kp.publicKey.toBase58(),
    secretKey: bs58.encode(kp.secretKey),
    keypair: kp
  }
}

export const getKeypairFromSecret = (secret: string) => {
  return Keypair.fromSecretKey(bs58.decode(secret))
}

export const getBalance = async (publicKey: PublicKey) => {
  const balance = await connection.getBalance(publicKey)
  return balance / LAMPORTS_PER_SOL
}

export class SimpleWallet implements anchor.Wallet {
  constructor(readonly payer: Keypair) {
    this.payer = payer;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    } else {
      tx.sign([this.payer]);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((t) => {
      if (t instanceof Transaction) {
        t.partialSign(this.payer);
      } else {
        t.sign([this.payer]);
      }
      return t;
    });
  }

  get publicKey() {
    return this.payer.publicKey;
  }
}

export const sendSol = async (
    fromWallet: Keypair,
    toAddress: string,
    amountSol: number
) => {
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: fromWallet.publicKey,
            toPubkey: new PublicKey(toAddress),
            lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
        })
    );

    const signature = await connection.sendTransaction(transaction, [fromWallet]);
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
}

// Derive a wallet from a seed phrase at a specific index
// For index 0: use first 32 bytes of seed
// For index > 0: hash(seed + index) to get unique 32-byte seed
export const deriveWalletFromSeed = async (mnemonic: string, index: number): Promise<{
    publicKey: string;
    secretKey: string;
    keypair: Keypair;
}> => {
    const seed = await bip39.mnemonicToSeed(mnemonic);
    
    let derivedSeed: Uint8Array;
    
    if (index === 0) {
        derivedSeed = new Uint8Array(seed.slice(0, 32));
    } else {
        // For additional accounts, create a unique seed by hashing seed + index
        const encoder = new TextEncoder();
        const indexBytes = encoder.encode(index.toString());
        const combined = new Uint8Array(seed.length + indexBytes.length);
        combined.set(seed, 0);
        combined.set(indexBytes, seed.length);
        
        // Use SHA-256 to derive a unique 32-byte seed
        const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
        derivedSeed = new Uint8Array(hashBuffer);
    }
    
    const keypair = Keypair.fromSeed(derivedSeed);
    
    return {
        publicKey: keypair.publicKey.toBase58(),
        secretKey: bs58.encode(keypair.secretKey),
        keypair
    };
}
