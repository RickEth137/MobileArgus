/**
 * Jupiter Swap Integration for ARGUS Wallet
 * 
 * CRITICAL: This module handles user funds - all operations must be:
 * - Thoroughly validated
 * - Error-handled gracefully
 * - Transparently reported to users
 * 
 * Uses Jupiter Ultra API for best execution (handles slippage, MEV protection, etc.)
 * Falls back to Legacy API for vault swaps requiring custom instructions
 * 
 * Jupiter API Documentation: https://dev.jup.ag/docs/ultra
 * 
 * NOTE: All Jupiter API calls are proxied through ARGUS backend to keep API key secure
 */

import { Connection, VersionedTransaction, Keypair, PublicKey, TransactionMessage, AddressLookupTableAccount } from "@solana/web3.js"
import bs58 from "bs58"
import { connection } from "./solana"

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

// ARGUS API Proxy for Jupiter (keeps API key secure on server)
const ARGUS_API_URL = "https://argus-api-gpcu.onrender.com"

// Jupiter Ultra API (recommended - simpler, better slippage handling)
const JUPITER_ULTRA_ORDER_API = `${ARGUS_API_URL}/jupiter/ultra/order`
const JUPITER_ULTRA_EXECUTE_API = `${ARGUS_API_URL}/jupiter/ultra/execute`

// Jupiter Legacy API (for vault swaps requiring custom instructions)
const JUPITER_QUOTE_API = `${ARGUS_API_URL}/jupiter/quote`
const JUPITER_SWAP_API = `${ARGUS_API_URL}/jupiter/swap`
const JUPITER_TOKEN_API = "https://tokens.jup.ag/token"  // Public, no auth needed

// ARGUS Platform Fee Configuration
// 1% platform fee on all swaps (buys and sells)
export const ARGUS_FEE_WALLET = "52fW2NkJ9Yj7hLmKh2WpUWZ8eyjTB6x3EPoKuWw48Xnx"
export const ARGUS_PLATFORM_FEE_BPS = 100  // 1% = 100 basis points

// Slippage Presets (in basis points - 100 bps = 1%)
export const SLIPPAGE_PRESETS = {
  LOW: 10,       // 0.1% - for stable pairs
  NORMAL: 50,    // 0.5% - default, good for most swaps
  HIGH: 100,     // 1% - for volatile tokens
  TURBO: 300,    // 3% - for very volatile/low liquidity
  DEGEN: 1500,   // 15% - for memecoins
  MAX: 5000,     // 50% - absolute max for insane volatility
} as const

// Priority Fee Levels
export const PRIORITY_LEVELS = {
  NONE: { level: "none", maxLamports: 0, label: "Normal", description: "Standard speed" },
  LOW: { level: "low", maxLamports: 10_000, label: "Fast", description: "~10 sec" },
  MEDIUM: { level: "medium", maxLamports: 100_000, label: "Turbo", description: "~5 sec" },
  HIGH: { level: "high", maxLamports: 500_000, label: "Ultra", description: "~2 sec" },
  TURBO: { level: "veryHigh", maxLamports: 1_000_000, label: "MEV", description: "Max priority" },
} as const

// Safety Limits
const MAX_PRICE_IMPACT_WARNING = 1    // 1% - show warning
const MAX_PRICE_IMPACT_DANGER = 5     // 5% - show danger
const MAX_PRICE_IMPACT_BLOCK = 15     // 15% - block swap (user can override)
const MAX_ACCOUNTS_LIMIT = 64         // Jupiter recommendation
const QUOTE_TIMEOUT_MS = 15_000       // 15 seconds
const SWAP_TIMEOUT_MS = 90_000        // 90 seconds for full execution

// Token Program IDs
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
const WSOL_MINT = "So11111111111111111111111111111111111111112"

// ============================================================================
// FEE ACCOUNT HELPERS
// ============================================================================

/**
 * Derive the Associated Token Account (ATA) address for the fee wallet
 * This is deterministic - we don't need to check if it exists, Jupiter will handle that
 * 
 * @param mint - The token mint address
 * @param owner - The owner wallet address (defaults to ARGUS_FEE_WALLET)
 * @returns The ATA address as a string
 */
export function getFeeTokenAccount(mint: string, owner: string = ARGUS_FEE_WALLET): string {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(owner).toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  return ata.toBase58()
}

/**
 * Get the fee account for a swap
 * 
 * IMPORTANT: We ALWAYS take the fee in SOL (WSOL) because:
 * 1. SOL is always part of Quick Trade swaps (our main use case)
 * 2. You receive SOL which is more useful than random tokens
 * 3. One fee account handles all swaps
 * 
 * For swaps that don't involve SOL, Jupiter will fail to apply the fee
 * and the swap will proceed without a platform fee. This is acceptable
 * since most of our swaps are SOL-based.
 * 
 * @param inputMint - Input token mint (optional, for future use)
 * @param outputMint - Output token mint (optional, for future use)
 * @returns The WSOL fee account address for the ARGUS fee wallet
 */
export function getSwapFeeAccount(inputMint?: string, outputMint?: string): string {
  // Always return the WSOL token account for the fee wallet
  // This means ALL fees are collected in SOL
  return getFeeTokenAccount(WSOL_MINT)
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface TokenInfo {
  mint: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
  price?: number
}

export interface SwapRoute {
  ammKey: string
  label: string          // DEX name (e.g., "Raydium", "Orca")
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  feeAmount: string
  feeMint: string
  percent: number        // percentage of this route
}

export interface SwapQuote {
  // Core amounts
  inputMint: string
  outputMint: string
  inAmount: string           // Raw input amount
  outAmount: string          // Raw output amount (best case)
  otherAmountThreshold: string  // Minimum output after slippage
  
  // Pricing info
  priceImpactPct: string     // Price impact percentage
  
  // Route info
  routePlan: SwapRoute[]     // DEXes used in the route
  
  // Fees
  platformFee?: {
    amount: string
    feeBps: number
  }
  
  // Settings used
  slippageBps: number
  swapMode: "ExactIn" | "ExactOut"
  
  // Metadata
  contextSlot: number
  timeTaken: number
  
  // Raw response for swap execution
  _raw: any
}

export interface SwapQuoteParams {
  inputMint: string
  outputMint: string
  amount: string              // Raw amount in smallest units (lamports)
  slippageBps?: number        // Default: 50 (0.5%)
  autoSlippage?: boolean      // Let Jupiter calculate optimal slippage
  autoSlippageCollisionUsdValue?: number // Collision value for auto slippage
  onlyDirectRoutes?: boolean  // Single hop only
  restrictIntermediateTokens?: boolean  // Use only stable intermediates
  maxAccounts?: number        // Limit transaction accounts
  excludeDexes?: string[]     // DEXes to exclude
  platformFeeBps?: number     // Platform fee in basis points (100 = 1%)
}

export interface SwapParams {
  quote: SwapQuote
  userPublicKey: string
  priorityLevel?: keyof typeof PRIORITY_LEVELS
  dynamicComputeUnitLimit?: boolean
  wrapAndUnwrapSol?: boolean
  dynamicSlippage?: boolean  // Let Jupiter auto-adjust slippage
  maxAutoSlippageBps?: number // Max slippage for dynamic mode
  feeAccount?: string        // Token account to receive platform fees
}

export interface SwapTransaction {
  transaction: string         // Base64 encoded transaction
  lastValidBlockHeight: number
  prioritizationFeeLamports: number
}

// Swap instructions for vault swaps (wrapping in Squads transaction)
export interface SwapInstructionAccount {
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

export interface SwapInstructionData {
  programId: string
  accounts: SwapInstructionAccount[]
  data: string  // Base64 encoded
}

export interface SwapInstructionsResponse {
  computeBudgetInstructions: SwapInstructionData[]
  setupInstructions: SwapInstructionData[]
  swapInstruction: SwapInstructionData
  cleanupInstruction?: SwapInstructionData
  otherInstructions: SwapInstructionData[]
  addressLookupTableAddresses: string[]
}

export interface SwapResult {
  success: boolean
  signature?: string
  error?: string
  errorCode?: string
}

export type PriceImpactLevel = "safe" | "warning" | "danger" | "extreme"

// ============================================================================
// JUPITER ULTRA API TYPES (Recommended for most swaps)
// ============================================================================

export interface UltraSwapOrderParams {
  inputMint: string
  outputMint: string
  amount: string
  taker: string           // The wallet performing the swap
  slippageBps?: number    // Optional, Ultra has RTSE (Real Time Slippage Estimator)
}

export interface UltraSwapOrder {
  requestId: string       // Required for execute
  transaction: string     // Base64 encoded unsigned transaction
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  slippageBps: number
  priceImpactPct: string
  priceImpact?: number
  routePlan: SwapRoute[]
  platformFee?: {
    amount: string
    feeBps: number
  }
  prioritizationFeeLamports: number
  signatureFeeLamports: number
  rentFeeLamports: number
  gasless: boolean
  router: string
  errorCode?: number
  errorMessage?: string
}

export interface UltraExecuteResult {
  signature: string
  status: 'Success' | 'Failed' | 'Pending'
  slot?: number
  error?: string
  inputAmountResult?: string
  outputAmountResult?: string
}

// ============================================================================
// JUPITER ULTRA API FUNCTIONS (Best for master wallet swaps)
// ============================================================================

/**
 * Get a swap order from Jupiter Ultra API
 * Ultra handles slippage automatically with RTSE (Real Time Slippage Estimator)
 * and includes MEV protection and optimized transaction landing
 * 
 * @param params - Ultra swap order parameters
 * @returns UltraSwapOrder with transaction ready to sign
 */
export async function getUltraSwapOrder(params: UltraSwapOrderParams): Promise<UltraSwapOrder> {
  const { inputMint, outputMint, amount, taker, slippageBps } = params

  // Validate inputs
  if (!inputMint || !outputMint) {
    throw new SwapError("Invalid token mints", "INVALID_MINTS")
  }
  
  if (!amount || BigInt(amount) <= 0n) {
    throw new SwapError("Invalid amount", "INVALID_AMOUNT")
  }

  if (inputMint === outputMint) {
    throw new SwapError("Cannot swap token to itself", "SAME_TOKEN")
  }

  if (!taker) {
    throw new SwapError("Taker wallet address required", "MISSING_TAKER")
  }

  // Build query parameters for Ultra API
  const queryParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    taker,
  })

  // Only add slippage if explicitly set - Ultra has RTSE by default
  if (slippageBps !== undefined) {
    queryParams.set("slippageBps", slippageBps.toString())
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)

  try {
    console.log("[Ultra] Getting swap order:", { inputMint, outputMint, amount, taker })
    
    const response = await fetch(`${JUPITER_ULTRA_ORDER_API}?${queryParams}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error("[Ultra] Order failed:", errorData)
      throw new SwapError(
        errorData.error || errorData.errorMessage || `Order failed: ${response.status}`,
        "ORDER_FAILED",
        response.status
      )
    }

    const data = await response.json()
    console.log("[Ultra] Order received:", { 
      outAmount: data.outAmount, 
      slippageBps: data.slippageBps,
      router: data.router,
      hasTransaction: !!data.transaction
    })

    // Check for errors in the response
    if (data.errorCode || data.errorMessage) {
      throw new SwapError(
        data.errorMessage || `Order error: ${data.errorCode}`,
        data.errorCode === 1 ? "INSUFFICIENT_FUNDS" : "ORDER_ERROR"
      )
    }

    if (!data.transaction) {
      throw new SwapError("No transaction returned from Ultra API", "NO_TRANSACTION")
    }

    // Parse route plan
    const routePlan: SwapRoute[] = (data.routePlan || []).map((route: any) => ({
      ammKey: route.swapInfo?.ammKey || "",
      label: route.swapInfo?.label || "Unknown",
      inputMint: route.swapInfo?.inputMint || "",
      outputMint: route.swapInfo?.outputMint || "",
      inAmount: route.swapInfo?.inAmount || "0",
      outAmount: route.swapInfo?.outAmount || "0",
      feeAmount: route.swapInfo?.feeAmount || "0",
      feeMint: route.swapInfo?.feeMint || "",
      percent: route.percent || 100,
    }))

    return {
      requestId: data.requestId,
      transaction: data.transaction,
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inAmount: data.inAmount,
      outAmount: data.outAmount,
      otherAmountThreshold: data.otherAmountThreshold,
      slippageBps: data.slippageBps,
      priceImpactPct: data.priceImpactPct || "0",
      priceImpact: data.priceImpact,
      routePlan,
      platformFee: data.platformFee,
      prioritizationFeeLamports: data.prioritizationFeeLamports || 0,
      signatureFeeLamports: data.signatureFeeLamports || 0,
      rentFeeLamports: data.rentFeeLamports || 0,
      gasless: data.gasless || false,
      router: data.router || "iris",
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error instanceof SwapError) throw error
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new SwapError("Order request timed out", "TIMEOUT")
      }
      throw new SwapError(error.message, "NETWORK_ERROR")
    }
    
    throw new SwapError("Unknown error getting swap order", "UNKNOWN")
  }
}

/**
 * Execute a signed Ultra swap transaction
 * Uses Jupiter's optimized transaction sending engine for better landing rates
 * 
 * @param order - The Ultra swap order
 * @param signedTransaction - The base64 encoded SIGNED transaction
 * @returns UltraExecuteResult with execution status
 */
export async function executeUltraSwap(
  order: UltraSwapOrder,
  signedTransaction: string
): Promise<UltraExecuteResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SWAP_TIMEOUT_MS)

  try {
    console.log("[Ultra] Executing swap with requestId:", order.requestId)
    
    const response = await fetch(JUPITER_ULTRA_EXECUTE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        signedTransaction,
        requestId: order.requestId,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error("[Ultra] Execute failed:", errorData)
      throw new SwapError(
        errorData.error || `Execute failed: ${response.status}`,
        "EXECUTE_FAILED",
        response.status
      )
    }

    const data = await response.json()
    console.log("[Ultra] Execute result:", data)

    return {
      signature: data.signature,
      status: data.status || 'Pending',
      slot: data.slot,
      error: data.error,
      inputAmountResult: data.inputAmountResult,
      outputAmountResult: data.outputAmountResult,
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error instanceof SwapError) throw error
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new SwapError("Execute request timed out", "TIMEOUT")
      }
      throw new SwapError(error.message, "NETWORK_ERROR")
    }
    
    throw new SwapError("Unknown error executing swap", "UNKNOWN")
  }
}

/**
 * Full Ultra swap flow - get order, sign, and execute
 * This is the recommended method for master wallet swaps
 * 
 * @param params - Ultra swap parameters
 * @param signer - The wallet keypair to sign with
 * @returns SwapResult with signature or error
 */
export async function executeUltraSwapFull(
  params: UltraSwapOrderParams,
  signer: Keypair
): Promise<SwapResult> {
  try {
    // Step 1: Get swap order from Ultra API
    console.log("[Ultra] Starting full swap flow")
    const order = await getUltraSwapOrder(params)
    
    // Step 2: Deserialize and sign the transaction
    const transactionBuffer = Buffer.from(order.transaction, "base64")
    const transaction = VersionedTransaction.deserialize(new Uint8Array(transactionBuffer))
    transaction.sign([signer])
    
    // Step 3: Get signed transaction as base64
    const signedTransaction = Buffer.from(transaction.serialize()).toString("base64")
    
    // Step 4: Execute via Ultra API (uses their optimized sending engine)
    const result = await executeUltraSwap(order, signedTransaction)
    
    if (result.status === 'Failed') {
      return {
        success: false,
        signature: result.signature,
        error: result.error || "Swap execution failed",
        errorCode: "ULTRA_FAILED",
      }
    }
    
    return {
      success: true,
      signature: result.signature,
    }
    
  } catch (error) {
    console.error("[Ultra] Full swap error:", error)
    
    if (error instanceof SwapError) {
      // Map specific error codes
      if (error.code === "INSUFFICIENT_FUNDS") {
        return {
          success: false,
          error: "Insufficient funds for this swap",
          errorCode: "INSUFFICIENT_FUNDS",
        }
      }
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
      }
    }
    
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        errorCode: "EXECUTION_ERROR",
      }
    }
    
    return {
      success: false,
      error: "Unknown error during swap",
      errorCode: "UNKNOWN",
    }
  }
}

/**
 * Execute swap with automatic fallback - tries Ultra first, then Legacy
 * This provides the best reliability for user swaps
 * 
 * @param params - Swap parameters
 * @param signer - The wallet keypair to sign with
 * @param conn - Optional connection for legacy fallback
 * @returns SwapResult with signature or error
 */
export async function executeSwapWithFallback(
  params: {
    inputMint: string
    outputMint: string
    amount: string
    taker: string
    slippageBps?: number
  },
  signer: Keypair,
  conn: Connection = connection
): Promise<SwapResult> {
  console.log("[Swap] Starting swap with fallback mechanism")
  
  // Try Ultra API first (best execution, handles everything automatically)
  try {
    console.log("[Swap] Attempting Ultra API swap...")
    const ultraResult = await executeUltraSwapFull(
      {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        taker: params.taker,
        slippageBps: params.slippageBps,
      },
      signer
    )
    
    if (ultraResult.success) {
      console.log("[Swap] Ultra API swap succeeded:", ultraResult.signature)
      return ultraResult
    }
    
    // Ultra failed but returned a result - check if we should fallback
    console.log("[Swap] Ultra API returned failure, attempting legacy fallback...")
  } catch (ultraError) {
    console.warn("[Swap] Ultra API error, falling back to legacy:", ultraError)
  }
  
  // Fallback to Legacy API with direct send
  try {
    console.log("[Swap] Using Legacy API with high slippage and direct routes...")
    
    // Get fresh quote with higher slippage for reliability
    const effectiveSlippage = Math.max(params.slippageBps || 300, 500) // At least 5%
    
    const quote = await getSwapQuote({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount,
      slippageBps: effectiveSlippage,
      onlyDirectRoutes: true,  // More reliable
      restrictIntermediateTokens: true,
    })
    
    if (!quote) {
      throw new Error("Failed to get quote")
    }
    
    console.log("[Swap] Legacy quote obtained, building transaction...")
    
    // Build transaction with dynamic slippage
    const swapTx = await buildSwapTransaction({
      quote,
      userPublicKey: params.taker,
      priorityLevel: 'HIGH',
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
      maxAutoSlippageBps: 1500,  // Allow up to 15% dynamic
    })
    
    console.log("[Swap] Executing legacy transaction...")
    const result = await executeSwap(swapTx, signer, conn)
    
    if (result.success) {
      console.log("[Swap] Legacy swap succeeded:", result.signature)
    } else {
      console.log("[Swap] Legacy swap failed:", result.error)
    }
    
    return result
    
  } catch (legacyError) {
    console.error("[Swap] Legacy fallback also failed:", legacyError)
    
    return {
      success: false,
      error: legacyError instanceof Error 
        ? legacyError.message 
        : "Swap failed. Please try again with higher slippage.",
      errorCode: "ALL_METHODS_FAILED",
    }
  }
}

// ============================================================================
// LEGACY QUOTE FETCHING (for vault swaps and custom flows)
// ============================================================================

/**
 * Fetch a swap quote from Jupiter
 * 
 * @param params - Quote parameters
 * @returns SwapQuote with all route and pricing info
 * @throws Error if quote fails
 */
export async function getSwapQuote(params: SwapQuoteParams): Promise<SwapQuote> {
  const {
    inputMint,
    outputMint,
    amount,
    slippageBps = SLIPPAGE_PRESETS.NORMAL,
    autoSlippage = false,
    autoSlippageCollisionUsdValue = 1000, // $1000 collision value for auto calc
    onlyDirectRoutes = false,
    restrictIntermediateTokens = true,  // Safer default
    maxAccounts = MAX_ACCOUNTS_LIMIT,
    excludeDexes = [],
    platformFeeBps = ARGUS_PLATFORM_FEE_BPS, // Default to ARGUS 1% fee
  } = params

  // Validate inputs
  if (!inputMint || !outputMint) {
    throw new SwapError("Invalid token mints", "INVALID_MINTS")
  }
  
  if (!amount || BigInt(amount) <= 0n) {
    throw new SwapError("Invalid amount", "INVALID_AMOUNT")
  }

  if (inputMint === outputMint) {
    throw new SwapError("Cannot swap token to itself", "SAME_TOKEN")
  }

  // Build query parameters
  const queryParams = new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    onlyDirectRoutes: onlyDirectRoutes.toString(),
    restrictIntermediateTokens: restrictIntermediateTokens.toString(),
    maxAccounts: maxAccounts.toString(),
  })

  // Add platform fee for ARGUS (1% = 100 bps)
  if (platformFeeBps > 0) {
    queryParams.set("platformFeeBps", platformFeeBps.toString())
  }

  // Use auto slippage for volatile tokens, otherwise use specified slippage
  if (autoSlippage) {
    queryParams.set("autoSlippage", "true")
    queryParams.set("autoSlippageCollisionUsdValue", autoSlippageCollisionUsdValue.toString())
  } else {
    queryParams.set("slippageBps", slippageBps.toString())
  }

  if (excludeDexes.length > 0) {
    queryParams.set("excludeDexes", excludeDexes.join(","))
  }

  // Fetch quote with timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)

  try {
    const response = await fetch(`${JUPITER_QUOTE_API}?${queryParams}`, {
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new SwapError(
        errorData.error || `Quote failed: ${response.status}`,
        "QUOTE_FAILED",
        response.status
      )
    }

    const data = await response.json()

    // Validate response
    if (!data.outAmount) {
      throw new SwapError("No route found for this swap", "NO_ROUTE")
    }

    // Parse route plan
    const routePlan: SwapRoute[] = (data.routePlan || []).map((route: any) => ({
      ammKey: route.swapInfo?.ammKey || "",
      label: route.swapInfo?.label || "Unknown",
      inputMint: route.swapInfo?.inputMint || "",
      outputMint: route.swapInfo?.outputMint || "",
      inAmount: route.swapInfo?.inAmount || "0",
      outAmount: route.swapInfo?.outAmount || "0",
      feeAmount: route.swapInfo?.feeAmount || "0",
      feeMint: route.swapInfo?.feeMint || "",
      percent: route.percent || 100,
    }))

    return {
      inputMint: data.inputMint,
      outputMint: data.outputMint,
      inAmount: data.inAmount,
      outAmount: data.outAmount,
      otherAmountThreshold: data.otherAmountThreshold,
      priceImpactPct: data.priceImpactPct || "0",
      routePlan,
      platformFee: data.platformFee,
      slippageBps: data.slippageBps,
      swapMode: data.swapMode || "ExactIn",
      contextSlot: data.contextSlot || 0,
      timeTaken: data.timeTaken || 0,
      _raw: data,
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error instanceof SwapError) throw error
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new SwapError("Quote request timed out", "TIMEOUT")
      }
      throw new SwapError(error.message, "NETWORK_ERROR")
    }
    
    throw new SwapError("Unknown error fetching quote", "UNKNOWN")
  }
}

// ============================================================================
// SWAP TRANSACTION BUILDING
// ============================================================================

/**
 * Build a swap transaction from a quote
 * 
 * @param params - Swap parameters including quote and user public key
 * @returns SwapTransaction ready for signing
 * @throws Error if transaction building fails
 */
export async function buildSwapTransaction(params: SwapParams): Promise<SwapTransaction> {
  const {
    quote,
    userPublicKey,
    priorityLevel = "NONE",
    dynamicComputeUnitLimit = true,
    wrapAndUnwrapSol = true,
    dynamicSlippage = false,
    maxAutoSlippageBps = 1500, // 15% max for dynamic
    feeAccount,  // Token account to receive platform fees
  } = params

  // Validate inputs
  if (!quote?._raw) {
    throw new SwapError("Invalid quote", "INVALID_QUOTE")
  }

  if (!userPublicKey) {
    throw new SwapError("User public key required", "MISSING_PUBKEY")
  }

  // Build request body
  const body: any = {
    userPublicKey,
    quoteResponse: quote._raw,
    wrapAndUnwrapSol,
    dynamicComputeUnitLimit,
    skipUserAccountsRpcCalls: false,  // Safer to let Jupiter check accounts
  }

  // Add fee account for ARGUS platform fee (1%)
  // The feeAccount must be a token account for input or output mint
  if (feeAccount) {
    body.feeAccount = feeAccount
  }

  // Enable dynamic slippage for volatile tokens
  if (dynamicSlippage) {
    body.dynamicSlippage = {
      minBps: quote.slippageBps,   // Use quote slippage as minimum
      maxBps: maxAutoSlippageBps,  // Cap at max
    }
  }

  // Add priority fee - use "auto" for automatic or fixed lamports as integer
  const priority = PRIORITY_LEVELS[priorityLevel]
  if (priority.level === "none") {
    // Use auto for no priority (Jupiter handles it)
    body.prioritizationFeeLamports = "auto"
  } else {
    // Use fixed lamports amount as a simple integer
    body.prioritizationFeeLamports = priority.maxLamports
  }

  // Fetch swap transaction with timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)

  try {
    const response = await fetch(JUPITER_SWAP_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new SwapError(
        errorData.error || `Failed to build swap: ${response.status}`,
        "BUILD_FAILED",
        response.status
      )
    }

    const data = await response.json()

    if (!data.swapTransaction) {
      throw new SwapError("No transaction returned", "NO_TRANSACTION")
    }

    return {
      transaction: data.swapTransaction,
      lastValidBlockHeight: data.lastValidBlockHeight,
      prioritizationFeeLamports: data.prioritizationFeeLamports || 0,
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error instanceof SwapError) throw error
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new SwapError("Swap request timed out", "TIMEOUT")
      }
      throw new SwapError(error.message, "NETWORK_ERROR")
    }
    
    throw new SwapError("Unknown error building swap", "UNKNOWN")
  }
}

// ============================================================================
// SWAP INSTRUCTIONS FOR VAULT SWAPS
// ============================================================================

/**
 * Get swap instructions for vault swaps (Squads multisig)
 * These instructions can be wrapped in a Squads vault transaction
 * 
 * @param params - Same as SwapParams but with vaultPda as userPublicKey
 * @returns SwapInstructionsResponse with individual instructions
 */
export async function getSwapInstructions(params: SwapParams & { payer?: string }): Promise<SwapInstructionsResponse> {
  const {
    quote,
    userPublicKey,  // This should be the vaultPda
    payer,          // This is the master wallet that pays tx fees
    priorityLevel = "NONE",
    dynamicComputeUnitLimit = true,
    wrapAndUnwrapSol = true,
    feeAccount,
  } = params

  // Validate inputs
  if (!quote?._raw) {
    throw new SwapError("Invalid quote", "INVALID_QUOTE")
  }

  if (!userPublicKey) {
    throw new SwapError("User public key (vault PDA) required", "MISSING_PUBKEY")
  }

  // Build request body - userPublicKey is the vault, payer is master wallet
  const body: any = {
    userPublicKey,
    quoteResponse: quote._raw,
    wrapAndUnwrapSol,
    dynamicComputeUnitLimit,
    skipUserAccountsRpcCalls: false,
    // Use legacy transaction for Squads compatibility (no address lookup tables)
    asLegacyTransaction: true,
  }

  // Add payer if different from userPublicKey (master wallet pays fees)
  if (payer && payer !== userPublicKey) {
    body.payer = payer
  }

  // Add fee account for ARGUS platform fee
  if (feeAccount) {
    body.feeAccount = feeAccount
  }

  // Add priority fee
  const priority = PRIORITY_LEVELS[priorityLevel]
  if (priority.level !== "none") {
    body.prioritizationFeeLamports = priority.maxLamports
  }

  // Fetch swap instructions
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS)

  try {
    const response = await fetch(`${ARGUS_API_URL}/jupiter/swap-instructions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new SwapError(
        errorData.error || `Failed to get swap instructions: ${response.status}`,
        "INSTRUCTIONS_FAILED",
        response.status
      )
    }

    const data = await response.json()

    if (!data.swapInstruction) {
      throw new SwapError("No swap instruction returned", "NO_INSTRUCTION")
    }

    return {
      computeBudgetInstructions: data.computeBudgetInstructions || [],
      setupInstructions: data.setupInstructions || [],
      swapInstruction: data.swapInstruction,
      cleanupInstruction: data.cleanupInstruction,
      otherInstructions: data.otherInstructions || [],
      addressLookupTableAddresses: data.addressLookupTableAddresses || [],
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error instanceof SwapError) throw error
    
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new SwapError("Swap instructions request timed out", "TIMEOUT")
      }
      throw new SwapError(error.message, "NETWORK_ERROR")
    }
    
    throw new SwapError("Unknown error getting swap instructions", "UNKNOWN")
  }
}

// ============================================================================
// SWAP EXECUTION
// ============================================================================

/**
 * Execute a swap transaction
 * 
 * @param swapTx - The swap transaction from buildSwapTransaction
 * @param signer - The wallet keypair to sign with
 * @param conn - Optional connection override
 * @returns SwapResult with signature or error
 */
export async function executeSwap(
  swapTx: SwapTransaction,
  signer: Keypair,
  conn: Connection = connection
): Promise<SwapResult> {
  try {
    // Deserialize the transaction
    const transactionBuffer = Buffer.from(swapTx.transaction, "base64")
    const transaction = VersionedTransaction.deserialize(new Uint8Array(transactionBuffer))

    // Sign the transaction
    transaction.sign([signer])

    // Send with confirmation
    const signature = await conn.sendTransaction(transaction, {
      skipPreflight: false,  // IMPORTANT: Keep preflight for safety
      preflightCommitment: "confirmed",
      maxRetries: 3,
    })

    // Wait for confirmation with timeout
    const confirmation = await Promise.race([
      conn.confirmTransaction({
        signature,
        blockhash: transaction.message.recentBlockhash,
        lastValidBlockHeight: swapTx.lastValidBlockHeight,
      }, "confirmed"),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Confirmation timeout")), SWAP_TIMEOUT_MS)
      ),
    ])

    if (confirmation.value.err) {
      return {
        success: false,
        signature,
        error: "Transaction failed on-chain",
        errorCode: "TX_FAILED",
      }
    }

    return {
      success: true,
      signature,
    }

  } catch (error) {
    console.error("Swap execution error:", error)
    
    if (error instanceof Error) {
      // Parse common Solana errors
      const message = error.message.toLowerCase()
      
      if (message.includes("insufficient funds") || message.includes("insufficient lamports")) {
        return {
          success: false,
          error: "Insufficient SOL for transaction fees",
          errorCode: "INSUFFICIENT_SOL",
        }
      }
      
      if (message.includes("slippage") || message.includes("0x1788")) {
        return {
          success: false,
          error: "Price changed too much. Try increasing slippage.",
          errorCode: "SLIPPAGE_EXCEEDED",
        }
      }
      
      if (message.includes("blockhash") || message.includes("expired")) {
        return {
          success: false,
          error: "Transaction expired. Please try again.",
          errorCode: "TX_EXPIRED",
        }
      }
      
      return {
        success: false,
        error: error.message,
        errorCode: "EXECUTION_ERROR",
      }
    }
    
    return {
      success: false,
      error: "Unknown error during swap",
      errorCode: "UNKNOWN",
    }
  }
}

/**
 * Execute swap via Jito - FAST MODE
 * 
 * For single transactions, we don't need bundles.
 * Just send directly to Jito's transaction endpoint with skipPreflight.
 * This is faster and more reliable than bundles for single txs.
 * 
 * @param swapTx - The swap transaction from buildSwapTransaction
 * @param signer - The wallet keypair to sign with
 * @param tipLamports - Priority tip (unused for now, priority is in the tx)
 * @param conn - Optional connection override
 * @returns SwapResult with signature or error
 */
export async function executeSwapJito(
  swapTx: SwapTransaction,
  signer: Keypair,
  tipLamports: number = 1_000_000,
  conn: Connection = connection
): Promise<SwapResult> {
  try {
    // Deserialize the swap transaction
    const transactionBuffer = Buffer.from(swapTx.transaction, "base64")
    const transaction = VersionedTransaction.deserialize(new Uint8Array(transactionBuffer))

    // Sign the transaction
    transaction.sign([signer])

    // Get signature for tracking
    const signature = bs58.encode(transaction.signatures[0])
    console.log(`[JITO] Sending transaction: ${signature}`)

    // Send to Jito's sendTransaction endpoint (faster than bundles for single tx)
    // This skips preflight and sends directly to Jito validators
    const serializedTx = bs58.encode(transaction.serialize())
    
    // Try Jito's transaction endpoints first
    const JITO_TX_ENDPOINTS = [
      "https://mainnet.block-engine.jito.wtf/api/v1/transactions",
      "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/transactions",
      "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/transactions",
      "https://ny.mainnet.block-engine.jito.wtf/api/v1/transactions",
      "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions",
    ]

    let sent = false
    for (const endpoint of JITO_TX_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [serializedTx, { encoding: "base58" }],
          }),
        })

        if (response.ok) {
          const data = await response.json()
          if (data.result) {
            console.log(`[JITO] Transaction sent via ${endpoint}`)
            sent = true
            break
          }
        }
      } catch (e) {
        continue
      }
    }

    // If Jito endpoints failed, send directly with skipPreflight for speed
    if (!sent) {
      console.log("[JITO] Falling back to direct RPC with skipPreflight")
      await conn.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        preflightCommitment: "confirmed",
        maxRetries: 0, // Don't retry, we'll handle it
      })
    }

    // Quick confirmation polling
    const startTime = Date.now()
    const timeout = 8_000 // 8 seconds for confirmation

    while (Date.now() - startTime < timeout) {
      try {
        const status = await conn.getSignatureStatus(signature)
        
        if (status?.value?.confirmationStatus === "confirmed" || 
            status?.value?.confirmationStatus === "finalized") {
          if (status.value.err) {
            // Parse the error for better messaging
            const errStr = JSON.stringify(status.value.err)
            console.error("[JITO] Transaction failed:", errStr)
            
            // Check for slippage error (0x1788 = 6024 in decimal)
            if (errStr.includes("6024") || errStr.includes("1788")) {
              return {
                success: false,
                signature,
                error: "Price moved too much - slippage exceeded",
                errorCode: "SLIPPAGE_EXCEEDED",
              }
            }
            
            return {
              success: false,
              signature,
              error: "Transaction failed on-chain",
              errorCode: "TX_FAILED",
            }
          }
          console.log(`[JITO] Confirmed in ${Date.now() - startTime}ms`)
          return {
            success: true,
            signature,
          }
        }
      } catch (e) {
        // Ignore polling errors
      }
      
      await new Promise(resolve => setTimeout(resolve, 200))
    }

    // Not confirmed yet - but tx was sent, let user know it's pending
    console.log(`[JITO] Not confirmed after ${timeout}ms - returning pending`)
    return {
      success: true, // Optimistically return success
      signature,
    }

  } catch (error) {
    console.error("[JITO] Execution error:", error)
    
    // Fall back to regular execution on any error
    console.log("[JITO] Falling back to regular execution")
    return executeSwap(swapTx, signer, conn)
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Determine price impact level for UI display
 */
export function getPriceImpactLevel(priceImpactPct: string | number): PriceImpactLevel {
  const impact = typeof priceImpactPct === "string" 
    ? parseFloat(priceImpactPct) 
    : priceImpactPct

  if (impact >= MAX_PRICE_IMPACT_BLOCK) return "extreme"
  if (impact >= MAX_PRICE_IMPACT_DANGER) return "danger"
  if (impact >= MAX_PRICE_IMPACT_WARNING) return "warning"
  return "safe"
}

/**
 * Format amount with proper decimals
 */
export function formatAmount(amount: string, decimals: number): string {
  const value = BigInt(amount)
  const divisor = BigInt(10 ** decimals)
  const integerPart = value / divisor
  const fractionalPart = value % divisor
  
  // Pad fractional part with leading zeros
  const fractionalStr = fractionalPart.toString().padStart(decimals, "0")
  
  // Trim trailing zeros but keep at least 2 decimal places
  const trimmed = fractionalStr.replace(/0+$/, "")
  const finalFraction = trimmed.length < 2 ? fractionalStr.slice(0, 2) : trimmed
  
  return `${integerPart}.${finalFraction}`
}

/**
 * Format amount for display with smart decimal truncation
 * Shows appropriate decimals based on value size
 */
export function formatAmountDisplay(amount: string, decimals: number): string {
  const value = BigInt(amount)
  const divisor = BigInt(10 ** decimals)
  const integerPart = Number(value / divisor)
  const fractionalPart = value % divisor
  
  // Convert to number for easier formatting
  const fullValue = integerPart + Number(fractionalPart) / (10 ** decimals)
  
  // Smart decimal places based on value size
  if (fullValue === 0) return "0"
  if (fullValue >= 1000) {
    // Use toLocaleString for proper thousand separators
    return fullValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (fullValue >= 100) return fullValue.toFixed(3)       // 123.456
  if (fullValue >= 10) return fullValue.toFixed(4)        // 12.3456
  if (fullValue >= 1) return fullValue.toFixed(4)         // 1.2345
  if (fullValue >= 0.01) return fullValue.toFixed(4)      // 0.1234
  if (fullValue >= 0.0001) return fullValue.toFixed(6)    // 0.000123
  return fullValue.toFixed(8)                              // Very small amounts
}

/**
 * Format route for display (e.g., "Raydium → Orca")
 */
export function formatRoute(routePlan: SwapRoute[]): string {
  if (!routePlan || routePlan.length === 0) return "Direct"
  
  const labels = routePlan.map(r => r.label).filter(Boolean)
  
  if (labels.length === 0) return "Direct"
  if (labels.length === 1) return labels[0]
  
  // Remove duplicates while preserving order
  const unique = [...new Set(labels)]
  return unique.join(" → ")
}

/**
 * Calculate exchange rate from quote
 */
export function calculateRate(
  inAmount: string, 
  outAmount: string, 
  inDecimals: number, 
  outDecimals: number
): number {
  const inValue = parseFloat(inAmount) / (10 ** inDecimals)
  const outValue = parseFloat(outAmount) / (10 ** outDecimals)
  
  if (inValue === 0) return 0
  return outValue / inValue
}

/**
 * Get unique DEX labels from route
 */
export function getRouteDexes(routePlan: SwapRoute[]): string[] {
  if (!routePlan) return []
  const labels = routePlan.map(r => r.label).filter(Boolean)
  return [...new Set(labels)]
}

/**
 * Estimate network fee in SOL (rough estimate)
 */
export function estimateNetworkFee(priorityLevel: keyof typeof PRIORITY_LEVELS): number {
  const baseFee = 0.000005  // ~5000 lamports base fee
  const priorityLamports = PRIORITY_LEVELS[priorityLevel].maxLamports
  const priorityFee = priorityLamports / 1_000_000_000  // Convert lamports to SOL
  return baseFee + priorityFee
}

/**
 * Fetch token info from Jupiter
 */
export async function fetchTokenInfo(mint: string): Promise<TokenInfo | null> {
  try {
    const response = await fetch(`${JUPITER_TOKEN_API}/${mint}`)
    if (!response.ok) return null
    
    const data = await response.json()
    if (!data || !data.symbol) return null
    
    return {
      mint: data.address || mint,
      symbol: data.symbol,
      name: data.name || data.symbol,
      decimals: data.decimals || 9,
      logoURI: data.logoURI,
    }
  } catch {
    return null
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class SwapError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = "SwapError"
  }
}

/**
 * Get user-friendly error message
 */
export function getSwapErrorMessage(error: SwapError | Error | unknown): string {
  if (error instanceof SwapError) {
    switch (error.code) {
      case "INVALID_MINTS":
        return "Invalid token selection"
      case "INVALID_AMOUNT":
        return "Please enter a valid amount"
      case "SAME_TOKEN":
        return "Cannot swap a token to itself"
      case "NO_ROUTE":
        return "No swap route available for this pair"
      case "TIMEOUT":
        return "Request timed out. Please try again."
      case "NETWORK_ERROR":
        return "Network error. Check your connection."
      case "QUOTE_FAILED":
        return "Unable to get quote. Try again later."
      case "BUILD_FAILED":
        return "Failed to prepare swap. Try again."
      case "INSUFFICIENT_SOL":
        return "Insufficient SOL for fees"
      case "SLIPPAGE_EXCEEDED":
        return "Price moved too much. Try higher slippage."
      case "TX_EXPIRED":
        return "Transaction expired. Please retry."
      default:
        return error.message || "Swap failed"
    }
  }
  
  if (error instanceof Error) {
    return error.message
  }
  
  return "An unexpected error occurred"
}
