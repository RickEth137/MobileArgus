import { Connection, PublicKey } from "@solana/web3.js"
import type { AccountChangeCallback, Logs, LogsCallback } from "@solana/web3.js"

// Store active subscriptions
const subscriptions: Map<string, number> = new Map()

/**
 * Subscribe to account balance changes using WebSocket
 * This provides real-time updates when the account's SOL balance changes
 */
export function subscribeToAccountChanges(
  connection: Connection,
  publicKey: PublicKey,
  callback: (lamports: number) => void
): number {
  const key = `account:${publicKey.toBase58()}`
  
  // Unsubscribe from existing subscription if any
  const existingId = subscriptions.get(key)
  if (existingId !== undefined) {
    connection.removeAccountChangeListener(existingId)
    subscriptions.delete(key)
  }
  
  // Create new subscription
  const subscriptionId = connection.onAccountChange(
    publicKey,
    (accountInfo, context) => {
      console.log(`[WebSocket] Account ${publicKey.toBase58().slice(0, 8)}... balance changed at slot ${context.slot}`)
      callback(accountInfo.lamports)
    },
    'confirmed'
  )
  
  subscriptions.set(key, subscriptionId)
  console.log(`[WebSocket] Subscribed to account changes for ${publicKey.toBase58().slice(0, 8)}... (id: ${subscriptionId})`)
  
  return subscriptionId
}

/**
 * Subscribe to logs mentioning an account
 * This notifies when any transaction references this account
 */
export function subscribeToLogs(
  connection: Connection,
  publicKey: PublicKey,
  callback: (logs: Logs) => void
): number {
  const key = `logs:${publicKey.toBase58()}`
  
  // Unsubscribe from existing subscription if any
  const existingId = subscriptions.get(key)
  if (existingId !== undefined) {
    connection.removeOnLogsListener(existingId)
    subscriptions.delete(key)
  }
  
  // Create new subscription
  const subscriptionId = connection.onLogs(
    publicKey,
    (logs, context) => {
      console.log(`[WebSocket] Logs for ${publicKey.toBase58().slice(0, 8)}... at slot ${context.slot}`)
      callback(logs)
    },
    'confirmed'
  )
  
  subscriptions.set(key, subscriptionId)
  console.log(`[WebSocket] Subscribed to logs for ${publicKey.toBase58().slice(0, 8)}... (id: ${subscriptionId})`)
  
  return subscriptionId
}

/**
 * Unsubscribe from account changes
 */
export function unsubscribeFromAccountChanges(
  connection: Connection,
  publicKey: PublicKey
): void {
  const key = `account:${publicKey.toBase58()}`
  const subscriptionId = subscriptions.get(key)
  
  if (subscriptionId !== undefined) {
    connection.removeAccountChangeListener(subscriptionId)
    subscriptions.delete(key)
    console.log(`[WebSocket] Unsubscribed from account changes for ${publicKey.toBase58().slice(0, 8)}...`)
  }
}

/**
 * Unsubscribe from logs
 */
export function unsubscribeFromLogs(
  connection: Connection,
  publicKey: PublicKey
): void {
  const key = `logs:${publicKey.toBase58()}`
  const subscriptionId = subscriptions.get(key)
  
  if (subscriptionId !== undefined) {
    connection.removeOnLogsListener(subscriptionId)
    subscriptions.delete(key)
    console.log(`[WebSocket] Unsubscribed from logs for ${publicKey.toBase58().slice(0, 8)}...`)
  }
}

/**
 * Unsubscribe from all active subscriptions
 */
export function unsubscribeAll(connection: Connection): void {
  subscriptions.forEach((subscriptionId, key) => {
    if (key.startsWith('account:')) {
      connection.removeAccountChangeListener(subscriptionId)
    } else if (key.startsWith('logs:')) {
      connection.removeOnLogsListener(subscriptionId)
    }
  })
  subscriptions.clear()
  console.log('[WebSocket] Unsubscribed from all subscriptions')
}

/**
 * Get the number of active subscriptions
 */
export function getActiveSubscriptionCount(): number {
  return subscriptions.size
}
