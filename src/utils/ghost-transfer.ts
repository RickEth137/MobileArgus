/**
 * Ghost Transfer for ARGUS Wallet
 * 
 * Uses Privacy Cash via ARGUS backend API to enable private/anonymous SOL and USDC transfers.
 * 
 * HOW IT WORKS:
 * Privacy Cash uses a mixer-pool architecture with zero-knowledge proofs:
 * 1. Shield (Deposit) - Funds go into a privacy pool, generating a commitment in a Merkle tree
 * 2. Withdraw - Funds are withdrawn to ANY address using ZK proofs, breaking the link
 * 
 * The magic: From the user's perspective, it's just ONE "Ghost Send" action.
 * Behind the scenes, we handle shield+withdraw automatically when needed.
 * 
 * PRIVACY BENEFITS:
 * - Sender address is hidden (recipient can't see who sent)
 * - Amount is hidden from chain observers
 * - Transaction link is broken (no on-chain connection between sender/recipient)
 * 
 * @module ghost-transfer
 * @see https://github.com/Privacy-Cash/privacy-cash-sdk
 */

import { 
  Keypair, 
  PublicKey, 
  LAMPORTS_PER_SOL
} from "@solana/web3.js"
import bs58 from "bs58"

// ARGUS API endpoint for Ghost transfers
const GHOST_API_URL = "https://api.argus.foundation"

// Minimum amounts (Privacy Cash requires minimum due to fees)
const MIN_GHOST_AMOUNT_SOL = 0.01 // 0.01 SOL minimum
const MIN_GHOST_AMOUNT_USDC = 1.0 // 1 USDC minimum

export interface GhostBalance {
  sol: number // Private SOL balance in lamports
  solFormatted: string // Formatted SOL amount
  usdc: number // Private USDC balance in base units (6 decimals)
  usdcFormatted: string // Formatted USDC amount
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
  // For multi-step transactions
  steps?: {
    shield?: { signature: string; status: "pending" | "confirmed" | "failed" }
    withdraw?: { signature: string; status: "pending" | "confirmed" | "failed" }
  }
}

export interface GhostTransferConfig {
  fromWallet: Keypair
  toAddress: string
  amount: number // In lamports for SOL, base units for tokens
  isUsdc?: boolean
  // Callback for progress updates (for UI)
  onProgress?: (step: "checking" | "shielding" | "waiting" | "withdrawing" | "confirming", message: string) => void
}

/**
 * Check if Ghost transfers are available
 * Verifies Privacy Cash program is deployed and relayer is online
 */
export const isGhostTransferAvailable = async (): Promise<{ 
  available: boolean
  reason?: string 
  features?: {
    sol: boolean
    usdc: boolean
  }
}> => {
  try {
    const response = await fetch(`${GHOST_API_URL}/ghost/status?_t=${Date.now()}`, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Cache-Control': 'no-cache' }
    })
    
    if (!response.ok) {
      return { 
        available: false, 
        reason: "Ghost transfer service unavailable" 
      }
    }
    
    const data = await response.json()
    
    return { 
      available: data.available,
      reason: data.available ? undefined : "Privacy Cash not available",
      features: {
        sol: true,
        usdc: true
      }
    }
  } catch (error: any) {
    console.error("[GhostTransfer] Availability check failed:", error)
    return { 
      available: false, 
      reason: error.message || "Unable to verify Ghost transfer availability" 
    }
  }
}

/**
 * Get user's private balance in Privacy Cash pool
 * This is how much they can ghost-send immediately without needing to shield first
 */
export const getGhostBalance = async (wallet: Keypair): Promise<GhostBalance> => {
  try {
    const response = await fetch(`${GHOST_API_URL}/ghost/balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secretKey: bs58.encode(wallet.secretKey)
      })
    })
    
    if (!response.ok) {
      throw new Error('Failed to get ghost balance')
    }
    
    const data = await response.json()
    
    return {
      sol: data.balance.sol.lamports || 0,
      solFormatted: data.balance.sol.formatted || "0.0000",
      usdc: data.balance.usdc.baseUnits || 0,
      usdcFormatted: data.balance.usdc.formatted || "0.00"
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
 * Shield funds (deposit into Privacy Cash pool)
 * This adds to the user's private balance
 */
export const shieldFunds = async (
  wallet: Keypair,
  amount: number,
  isUsdc: boolean = false,
  onProgress?: (message: string) => void
): Promise<{ success: boolean; error?: string; signature?: string }> => {
  try {
    onProgress?.("Shielding funds into privacy pool...")
    
    const response = await fetch(`${GHOST_API_URL}/ghost/shield`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secretKey: bs58.encode(wallet.secretKey),
        amount,
        isUsdc
      })
    })
    
    const data = await response.json()
    
    if (!data.success) {
      throw new Error(data.error || 'Shield failed')
    }
    
    onProgress?.("Funds shielded successfully!")
    return { success: true, signature: data.signature }
    
  } catch (error: any) {
    console.error("[GhostTransfer] Shield failed:", error)
    return { 
      success: false, 
      error: error.message || "Failed to shield funds" 
    }
  }
}

/**
 * Execute a Ghost Transfer
 * 
 * This is the main function - handles everything seamlessly:
 * 1. Checks if user has enough private balance
 * 2. If not enough, shields the required amount first
 * 3. Then withdraws to recipient address privately
 * 
 * From user's perspective: just one "Ghost Send" action
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
    
    // Validate recipient address
    try {
      new PublicKey(toAddress)
    } catch {
      return {
        success: false,
        error: "Invalid recipient address",
        errorCode: "SDK_ERROR"
      }
    }
    
    // Check minimum amounts
    const minAmount = isUsdc ? MIN_GHOST_AMOUNT_USDC * 1_000_000 : MIN_GHOST_AMOUNT_SOL * LAMPORTS_PER_SOL
    if (amount < minAmount) {
      return {
        success: false,
        error: `Minimum ghost transfer is ${isUsdc ? MIN_GHOST_AMOUNT_USDC + " USDC" : MIN_GHOST_AMOUNT_SOL + " SOL"}`,
        errorCode: "BELOW_MINIMUM"
      }
    }
    
    // Step 2: Check availability
    const availability = await isGhostTransferAvailable()
    if (!availability.available) {
      return {
        success: false,
        error: availability.reason || "Ghost transfers are not available",
        errorCode: "NOT_AVAILABLE"
      }
    }
    
    // Step 3: Execute ghost transfer via backend API
    onProgress?.("shielding", "Processing ghost transfer...")
    
    // Add cache buster to prevent browser caching issues
    const response = await fetch(`${GHOST_API_URL}/ghost/transfer?_t=${Date.now()}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: JSON.stringify({
        secretKey: bs58.encode(fromWallet.secretKey),
        recipient: toAddress,
        amount,
        isUsdc
      })
    })
    
    const data = await response.json()
    
    if (!data.success) {
      return {
        success: false,
        error: data.error || "Ghost transfer failed",
        errorCode: data.step === 'shield' ? "SHIELDING_FAILED" : "WITHDRAW_FAILED"
      }
    }
    
    onProgress?.("confirming", "Ghost transfer complete!")
    
    return {
      success: true,
      signature: data.signatures.withdraw,
      recipientAddress: toAddress,
      amountFormatted: data.amount,
      feeFormatted: data.fee,
      steps: {
        shield: data.signatures.shield ? { signature: data.signatures.shield, status: "confirmed" } : undefined,
        withdraw: { signature: data.signatures.withdraw, status: "confirmed" }
      }
    }
    
  } catch (error: any) {
    console.error("[GhostTransfer] Error:", error)
    return {
      success: false,
      error: error.message || "Ghost transfer failed",
      errorCode: "NETWORK_ERROR"
    }
  }
}

/**
 * Get ghost transfer fee estimate
 */
export const estimateGhostFee = async (
  amount: number,
  isUsdc: boolean = false
): Promise<{ fee: number; feeFormatted: string; totalWithFee: number }> => {
  try {
    const response = await fetch(`${GHOST_API_URL}/ghost/fees`)
    const data = await response.json()
    
    const feeRate = data.fees.withdrawFeeRate || 0.005
    const rentFee = isUsdc 
      ? (data.fees.withdrawRentFeeUsdc || 0.002) * 1_000_000 
      : (data.fees.withdrawRentFeeSol || 0.002) * LAMPORTS_PER_SOL
    
    const percentageFee = Math.floor(amount * feeRate)
    const totalFee = percentageFee + rentFee
    
    return {
      fee: totalFee,
      feeFormatted: isUsdc 
        ? `${(totalFee / 1_000_000).toFixed(4)} USDC`
        : `${(totalFee / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      totalWithFee: amount + totalFee
    }
    
  } catch (error) {
    // Return default estimate
    const fee = isUsdc 
      ? Math.floor(amount * 0.005) + 2000 // 0.5% + 0.002 USDC
      : Math.floor(amount * 0.005) + 2_000_000 // 0.5% + 0.002 SOL
    
    return {
      fee,
      feeFormatted: isUsdc 
        ? `~${(fee / 1_000_000).toFixed(4)} USDC`
        : `~${(fee / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
      totalWithFee: amount + fee
    }
  }
}

/**
 * Get information about ghost transfer support
 */
export const getGhostTransferInfo = async (tokenMint?: string): Promise<{
  supported: boolean
  available: boolean
  reason: string
  minAmount?: string
}> => {
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
  const availability = await isGhostTransferAvailable()
  
  // Check if it's SOL or USDC (only supported tokens for now)
  const isSol = !tokenMint || tokenMint === "So11111111111111111111111111111111111111112"
  const isUsdc = tokenMint === USDC_MINT
  
  if (!isSol && !isUsdc) {
    return {
      supported: false,
      available: false,
      reason: "Ghost transfers currently only support SOL and USDC"
    }
  }
  
  if (!availability.available) {
    return {
      supported: true,
      available: false,
      reason: availability.reason || "Ghost transfers temporarily unavailable"
    }
  }
  
  return {
    supported: true,
    available: true,
    reason: "Ghost transfers available",
    minAmount: isSol ? `${MIN_GHOST_AMOUNT_SOL} SOL` : `${MIN_GHOST_AMOUNT_USDC} USDC`
  }
}

/**
 * Format a ghost transfer explanation for the user
 */
export const getGhostTransferExplanation = (): {
  title: string
  description: string
  whatIsHidden: string[]
  whatIsVisible: string[]
  howItWorks: string[]
  warning: string
} => ({
  title: "Ghost Transaction",
  description: "Ghost transactions use Privacy Cash's ZK-proof mixer to make your transfer untraceable. The recipient cannot see who sent the funds.",
  whatIsHidden: [
    "Your wallet address (sender)",
    "Connection between sender & recipient",
    "Your transaction history"
  ],
  whatIsVisible: [
    "Recipient address",
    "Amount received (to recipient)",
    "That a privacy withdrawal occurred"
  ],
  howItWorks: [
    "Funds enter a shared privacy pool",
    "Zero-knowledge proofs verify validity",
    "Funds exit to recipient anonymously"
  ],
  warning: "Ghost transfers have a ~0.5% fee + small rent cost. Minimum: 0.01 SOL or 1 USDC."
})
