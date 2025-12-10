import { Connection, PublicKey } from "@solana/web3.js";

// Jupiter Program IDs for swap detection
const JUPITER_PROGRAM_IDS = [
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",  // Jupiter v6
  "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB",  // Jupiter v4
  "JUP3c2Uh3WA4Ng34tw6kPd2G4C5BB21Xo36Je1s32Ph",  // Jupiter v3
  "JUP2jxvXaqu7NQY1GmNF4m1vodw12LVXYxbFL2uJvfo",  // Jupiter v2
];

// Squads Program ID for vault detection
const SQUADS_PROGRAM_ID = "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf";

export interface Transaction {
  signature: string;
  timestamp: number;
  type: "send" | "receive" | "swap" | "vault-proposal" | "vault-execute" | "unknown";
  amount: number;
  status: "success" | "failed";
  from?: string;
  to?: string;
  slot?: number;
}

export const fetchTransactionHistory = async (
  connection: Connection,
  address: PublicKey,
  limit: number = 20
): Promise<Transaction[]> => {
  try {
    const signatures = await connection.getSignaturesForAddress(address, {
      limit
    });

    const transactions: Transaction[] = [];

    for (const sig of signatures) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0
        });

        if (!tx || !tx.meta) continue;

        const isSuccess = tx.meta.err === null;
        const timestamp = tx.blockTime || 0;

        // Parse instructions to determine type and amount
        let type: "send" | "receive" | "swap" | "vault-proposal" | "vault-execute" | "unknown" = "unknown";
        let amount = 0;
        let from: string | undefined;
        let to: string | undefined;

        // Check if this is a Jupiter swap by looking for Jupiter program in account keys
        const accountKeys = tx.transaction.message.accountKeys.map(k => k.pubkey.toBase58());
        const isSwap = JUPITER_PROGRAM_IDS.some(jupId => accountKeys.includes(jupId));
        
        // Check if this is a Squads/Vault transaction
        const isSquadsTransaction = accountKeys.includes(SQUADS_PROGRAM_ID);
        
        // Determine if it's a proposal or execution
        let isVaultProposal = false;
        let isVaultExecute = false;
        
        if (isSquadsTransaction) {
          // Check pre/post balances to get the fee amount
          const accountIdx = tx.transaction.message.accountKeys.findIndex(
            key => key.pubkey.toBase58() === address.toBase58()
          );
          
          let feeAmount = 0;
          if (accountIdx !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
            feeAmount = Math.abs(tx.meta.postBalances[accountIdx] - tx.meta.preBalances[accountIdx]);
          }
          
          // Simple and reliable: 
          // Proposal = higher fee (~0.0027 SOL / 2700000 lamports) because it creates/rents accounts
          // Execute = lower fee (~0.0024 SOL / 2400000 lamports) just executes
          // Threshold: 2600000 lamports (0.0026 SOL)
          
          if (feeAmount >= 2600000) {
            isVaultProposal = true;
          } else {
            isVaultExecute = true;
          }
          
          console.log(`[TX ${sig.signature.slice(0,8)}] Squads tx - fee: ${feeAmount} lamports (${feeAmount/1e9} SOL), type: ${isVaultProposal ? 'proposal' : 'execute'}`);
        }

        // Check pre/post balances to determine if send or receive
        const accountIndex = tx.transaction.message.accountKeys.findIndex(
          key => key.pubkey.toBase58() === address.toBase58()
        );

        if (accountIndex !== -1 && tx.meta.preBalances && tx.meta.postBalances) {
          const preBalance = tx.meta.preBalances[accountIndex];
          const postBalance = tx.meta.postBalances[accountIndex];
          const change = postBalance - preBalance;

          if (isSwap) {
            // It's a swap - show the absolute change
            type = "swap";
            amount = Math.abs(change) / 1e9;
          } else if (isVaultExecute && change < 0) {
            // Vault execution - the actual transfer happens here
            type = "vault-execute";
            amount = Math.abs(change) / 1e9;
          } else if (isVaultProposal && change < 0) {
            // Vault proposal creation - just paying for proposal fees
            type = "vault-proposal";
            amount = Math.abs(change) / 1e9;
          } else if (change > 0) {
            type = "receive";
            amount = change / 1e9; // Convert lamports to SOL
          } else if (change < 0) {
            type = "send";
            amount = Math.abs(change) / 1e9;
          }

          // Try to find the other party
          if (tx.transaction.message.instructions.length > 0) {
            const firstInstruction = tx.transaction.message.instructions[0];
            if ('parsed' in firstInstruction && firstInstruction.parsed?.type === 'transfer') {
              from = firstInstruction.parsed.info?.source;
              to = firstInstruction.parsed.info?.destination;
            }
          }
        }

        transactions.push({
          signature: sig.signature,
          timestamp: timestamp * 1000,
          type,
          amount,
          status: isSuccess ? "success" : "failed",
          from,
          to,
          slot: tx.slot // Store slot for ordering
        });
      } catch (e) {
        console.error("Error parsing transaction:", e);
      }
    }

    // Post-process: Fix vault transaction types based on order
    // Group Squads transactions that happened close together (within 60 seconds)
    const vaultTxs = transactions.filter(t => t.type === 'vault-proposal' || t.type === 'vault-execute');
    
    // Sort by slot (blockchain order) - lower slot = earlier transaction
    vaultTxs.sort((a, b) => (a.slot || 0) - (b.slot || 0));
    
    // For each pair of vault transactions close in time, first is proposal, second is execute
    for (let i = 0; i < vaultTxs.length - 1; i++) {
      const current = vaultTxs[i];
      const next = vaultTxs[i + 1];
      
      // If they're within 60 seconds of each other, they're likely a pair
      if (Math.abs(current.timestamp - next.timestamp) < 60000) {
        // First one (lower slot) is proposal, second is execution
        current.type = 'vault-proposal';
        next.type = 'vault-execute';
        i++; // Skip the next one since we already processed it
        console.log(`[Vault Pair] Proposal: ${current.signature.slice(0,8)}, Execute: ${next.signature.slice(0,8)}`);
      }
    }

    return transactions;
  } catch (error) {
    console.error("Error fetching transaction history:", error);
    return [];
  }
};
