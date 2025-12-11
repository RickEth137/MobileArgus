/**
 * Ghost Transfer for ARGUS Wallet
 * 
 * Uses Privacy Cash SDK DIRECTLY in the browser/mobile app for private transfers.
 * No backend API needed - ZK proofs are generated client-side.
 * 
 * HOW IT WORKS:
 * Privacy Cash uses a mixer-pool architecture with zero-knowledge proofs:
 * 1. Shield (Deposit) - Funds go into a privacy pool, generating a commitment in a Merkle tree
 * 2. Withdraw - Funds are withdrawn to ANY address using ZK proofs, breaking the link
 * 
 * The magic: From the user's perspective, it's just ONE "Ghost Send" action.
 * Behind the scenes, we handle shield+withdraw automatically when needed.
 * 
 * @module ghost-transfer
 */

// @ts-ignore - Privacy Cash SDK doesn't have type declarations
declare module 'privacycash' {
  export class PrivacyCash {
    constructor(config: { RPC_url: string; owner: string; enableDebug?: boolean })
    getPrivateBalance(): Promise<{ lamports: number }>
    getPrivateBalanceUSDC(): Promise<{ base_units: number }>
    deposit(params: { lamports: number }): Promise<{ tx: string }>
    depositUSDC(params: { base_units: number }): Promise<{ tx: string }>
    withdraw(params: { lamports: number; recipientAddress: string }): Promise<{ tx: string; fee_in_lamports: number }>
    withdrawUSDC(params: { base_units: number; recipientAddress: string }): Promise<{ tx: string; fee_base_units: number }>
  }
}

import { 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL
} from "@solana/web3.js"
import bs58 from "bs58"

// Minimum amounts (Privacy Cash requires minimum due to fees)
const MIN_GHOST_AMOUNT_SOL = 0.01 // 0.01 SOL minimum
const MIN_GHOST_AMOUNT_USDC = 1.0 // 1 USDC minimum

// RPC endpoint for Solana mainnet
const RPC_URL = "https://api.mainnet-beta.solana.com"

// Privacy Cash SDK - lazy loaded
let PrivacyCashClass: any = null

const loadPrivacyCash = async () => {
  if (!PrivacyCashClass) {
    try {
      // @ts-ignore - Dynamic import of untyped module
      const module = await import(/* @vite-ignore */ 'privacycash')
      PrivacyCashClass = module.PrivacyCash
      console.log("[GhostTransfer] Privacy Cash SDK loaded")
    } catch (error: any) {
      console.error("[GhostTransfer] Failed to load SDK:", error)
      throw new Error("Privacy Cash SDK not available: " + error.message)
    }
  }
  return PrivacyCashClass
}

export interface GhostBalance {
  sol: number
  solFormatted: string
  usdc: number
  usdcFormatted: string
}

export interface GhostTransferResult {
  success: boolean
  signature?: string
  recipientAddress?: string
  amount?: number
  amountFormatted?: string
  fee?: number
  feeFormatted?: string
  error?: string
  errorCode?: "INSUFFICIENT_BALANCE" | "BELOW_MINIMUM" | "SHIELDING_FAILED" | "WITHDRAW_FAILED" | "SDK_ERROR" | "NETWORK_ERROR" | "NOT_AVAILABLE"
  steps?: {
    shield?: { signature: string; status: "pending" | "confirmed" | "failed" }
    withdraw?: { signature: string; status: "pending" | "confirmed" | "failed" }
  }
}

export interface GhostTransferConfig {
  fromWallet: Keypair
  toAddress: string
  amount: number
  isUsdc?: boolean
  onProgress?: (step: "checking" | "shielding" | "waiting" | "withdrawing" | "confirming", message: string) => void
}

/**
 * Check if Ghost transfers are available
 */
export const isGhostTransferAvailable = async (): Promise<{ 
  available: boolean
  reason?: string 
  features?: { sol: boolean; usdc: boolean }
}> => {
  try {
    await loadPrivacyCash()
    return { 
      available: true,
      features: { sol: true, usdc: true }
    }
  } catch (error: any) {
    return { 
      available: false, 
      reason: error.message || "Privacy Cash SDK not available" 
    }
  }
}

/**
 * Get user's private balance in Privacy Cash pool
 */
export const getGhostBalance = async (wallet: Keypair): Promise<GhostBalance> => {
  try {
    const PrivacyCash = await loadPrivacyCash()
    const secretKey = bs58.encode(wallet.secretKey)
    
    const client = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: secretKey,
      enableDebug: true
    })
    
    const solBalance = await client.getPrivateBalance()
    let usdcBalance = { base_units: 0 }
    try {
      usdcBalance = await client.getPrivateBalanceUSDC()
    } catch { /* USDC might not be available */ }
    
    const solLamports = solBalance.lamports || 0
    const usdcUnits = usdcBalance.base_units || 0
    
    return {
      sol: solLamports,
      solFormatted: (solLamports / LAMPORTS_PER_SOL).toFixed(4),
      usdc: usdcUnits,
      usdcFormatted: (usdcUnits / 1_000_000).toFixed(2)
    }
    
  } catch (error: any) {
    console.error("[GhostTransfer] Error getting balance:", error)
    return {
      sol: 0,
      solFormatted: "0.0000",
      usdc: 0,
      usdcFormatted: "0.00"
    }
  }
}

/**
 * Execute a Ghost Transfer - runs entirely client-side
 */
export const executeGhostTransfer = async (
  config: GhostTransferConfig
): Promise<GhostTransferResult> => {
  const { fromWallet, toAddress, amount, isUsdc = false, onProgress } = config
  
  try {
    console.log("[GhostTransfer] Starting ghost transfer...")
    console.log("[GhostTransfer] Amount:", amount, isUsdc ? "USDC base units" : "lamports")
    console.log("[GhostTransfer] Recipient:", toAddress)
    
    // Step 1: Validate inputs
    onProgress?.("checking", "Validating transfer...")
    
    try {
      new PublicKey(toAddress)
    } catch {
      return {
        success: false,
        error: "Invalid recipient address",
        errorCode: "SDK_ERROR"
      }
    }
    
    const minAmount = isUsdc ? MIN_GHOST_AMOUNT_USDC * 1_000_000 : MIN_GHOST_AMOUNT_SOL * LAMPORTS_PER_SOL
    if (amount < minAmount) {
      return {
        success: false,
        error: `Minimum ghost transfer is ${isUsdc ? MIN_GHOST_AMOUNT_USDC + " USDC" : MIN_GHOST_AMOUNT_SOL + " SOL"}`,
        errorCode: "BELOW_MINIMUM"
      }
    }
    
    // Step 2: Load SDK and create client
    onProgress?.("checking", "Loading privacy engine...")
    const PrivacyCash = await loadPrivacyCash()
    const secretKey = bs58.encode(fromWallet.secretKey)
    
    const client = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: secretKey,
      enableDebug: true
    })
    
    // Step 3: Check private balance
    onProgress?.("checking", "Checking private balance...")
    let privateBalance: number
    if (isUsdc) {
      const balance = await client.getPrivateBalanceUSDC()
      privateBalance = balance.base_units || 0
    } else {
      const balance = await client.getPrivateBalance()
      privateBalance = balance.lamports || 0
    }
    console.log("[GhostTransfer] Private balance:", privateBalance)
    
    // Step 4: Shield if needed
    let shieldSignature: string | undefined
    if (privateBalance < amount) {
      onProgress?.("shielding", "Shielding funds into privacy pool...")
      console.log("[GhostTransfer] Need to shield", amount, "units")
      
      try {
        let depositResult
        if (isUsdc) {
          depositResult = await client.depositUSDC({ base_units: amount })
        } else {
          depositResult = await client.deposit({ lamports: amount })
        }
        shieldSignature = depositResult?.tx
        console.log("[GhostTransfer] Shield complete:", shieldSignature)
        
        // Wait for indexer
        onProgress?.("waiting", "Waiting for confirmation...")
        await new Promise(r => setTimeout(r, 3000))
      } catch (shieldError: any) {
        console.error("[GhostTransfer] Shield failed:", shieldError)
        return {
          success: false,
          error: "Failed to shield funds: " + shieldError.message,
          errorCode: "SHIELDING_FAILED"
        }
      }
    }
    
    // Step 5: Withdraw to recipient
    onProgress?.("withdrawing", "Sending privately to recipient...")
    console.log("[GhostTransfer] Withdrawing to:", toAddress)
    
    let withdrawResult
    try {
      if (isUsdc) {
        withdrawResult = await client.withdrawUSDC({
          base_units: amount,
          recipientAddress: toAddress
        })
      } else {
        withdrawResult = await client.withdraw({
          lamports: amount,
          recipientAddress: toAddress
        })
      }
    } catch (withdrawError: any) {
      console.error("[GhostTransfer] Withdraw failed:", withdrawError)
      return {
        success: false,
        error: "Withdraw failed: " + withdrawError.message,
        errorCode: "WITHDRAW_FAILED",
        steps: shieldSignature ? {
          shield: { signature: shieldSignature, status: "confirmed" }
        } : undefined
      }
    }
    
    const fee = isUsdc 
      ? withdrawResult.fee_base_units || 0
      : withdrawResult.fee_in_lamports || 0
    
    onProgress?.("confirming", "Ghost transfer complete!")
    console.log("[GhostTransfer] Success! Withdraw sig:", withdrawResult.tx)
    
    return {
      success: true,
      signature: withdrawResult.tx,
      recipientAddress: toAddress,
      amountFormatted: isUsdc 
        ? `${(amount / 1_000_000).toFixed(2)} USDC`
        : `${(amount / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
      feeFormatted: isUsdc
        ? `${(fee / 1_000_000).toFixed(4)} USDC`
        : `${(fee / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      steps: {
        shield: shieldSignature ? { signature: shieldSignature, status: "confirmed" } : undefined,
        withdraw: { signature: withdrawResult.tx, status: "confirmed" }
      }
    }
    
  } catch (error: any) {
    console.error("[GhostTransfer] Error:", error)
    return {
      success: false,
      error: error.message || "Ghost transfer failed",
      errorCode: "SDK_ERROR"
    }
  }
}

/**
 * Get ghost transfer fee estimate
 */
export const estimateGhostFee = async (
  amount: number,
  isUsdc: boolean = false
): Promise<{
  fee: number
  feeFormatted: string
  total: number
  totalFormatted: string
}> => {
  // Privacy Cash fees: ~0.35% + rent (~0.006 SOL or ~0.78 USDC)
  const feeRate = 0.0035
  const rentFee = isUsdc ? 0.78 * 1_000_000 : 0.006 * LAMPORTS_PER_SOL
  
  const percentageFee = Math.floor(amount * feeRate)
  const totalFee = percentageFee + rentFee
  const total = amount + totalFee
  
  if (isUsdc) {
    return {
      fee: totalFee,
      feeFormatted: `${(totalFee / 1_000_000).toFixed(4)} USDC`,
      total,
      totalFormatted: `${(total / 1_000_000).toFixed(2)} USDC`
    }
  } else {
    return {
      fee: totalFee,
      feeFormatted: `${(totalFee / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      total,
      totalFormatted: `${(total / LAMPORTS_PER_SOL).toFixed(4)} SOL`
    }
  }
}

/**
 * Shield funds into Privacy Cash pool (for pre-shielding)
 */
export const shieldFunds = async (
  wallet: Keypair,
  amount: number,
  isUsdc: boolean = false,
  onProgress?: (message: string) => void
): Promise<{ success: boolean; error?: string; signature?: string }> => {
  try {
    onProgress?.("Loading privacy engine...")
    const PrivacyCash = await loadPrivacyCash()
    const secretKey = bs58.encode(wallet.secretKey)
    
    const client = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: secretKey,
      enableDebug: true
    })
    
    onProgress?.("Shielding funds...")
    let result
    if (isUsdc) {
      result = await client.depositUSDC({ base_units: amount })
    } else {
      result = await client.deposit({ lamports: amount })
    }
    
    onProgress?.("Funds shielded successfully!")
    return { success: true, signature: result?.tx }
    
  } catch (error: any) {
    console.error("[GhostTransfer] Shield failed:", error)
    return { 
      success: false, 
      error: error.message || "Failed to shield funds" 
    }
  }
}

// Legacy exports for compatibility
export const getGhostFeeEstimate = estimateGhostFee

/**
 * Get info about ghost transfers for UI display
 */
export const getGhostTransferInfo = () => ({
  name: "Ghost Transfer",
  description: "Send funds privately using zero-knowledge proofs",
  features: [
    "Sender address hidden from recipient",
    "Amount hidden from chain observers", 
    "Transaction link broken (no on-chain connection)"
  ],
  fees: {
    percentage: "0.35%",
    rent: "~0.006 SOL"
  },
  minimums: {
    sol: "0.01 SOL",
    usdc: "1 USDC"
  }
})

/**
 * Get explanation of ghost transfer for UI
 */
export const getGhostTransferExplanation = () => 
  "Ghost transfers use Privacy Cash's zero-knowledge proof mixer. " +
  "Your funds are first shielded into a privacy pool, then withdrawn to the recipient. " +
  "This breaks the on-chain link between sender and recipient, providing financial privacy."
