import * as multisig from "@sqds/multisig";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, TransactionInstruction, VersionedTransaction, AddressLookupTableAccount } from "@solana/web3.js";
import type { SwapInstructionsResponse, SwapInstructionData } from "./swap";

const { multisigCreateV2, vaultTransactionCreate, proposalCreate, proposalApprove, vaultTransactionExecute } = multisig.rpc;
export const { getTransactionPda } = multisig;

// Helper to check if a proposal exists and its status
export const getProposalStatus = async (
  connection: Connection,
  multisigPda: PublicKey,
  transactionIndex: bigint,
  programId: PublicKey = SQUADS_PROGRAM_ID
): Promise<any | null> => {
  try {
    const [proposalPda] = multisig.getProposalPda({
      multisigPda,
      transactionIndex,
      programId
    });
    
    const proposalInfo = await connection.getAccountInfo(proposalPda, "confirmed");
    if (!proposalInfo) {
      return null;
    }
    
    const [proposal] = multisig.accounts.Proposal.fromAccountInfo(proposalInfo);
    return proposal;
  } catch (e) {
    return null;
  }
};

// Helper to get the next transaction index from the multisig account
export const getNextTransactionIndex = async (
  connection: Connection,
  multisigPda: PublicKey
): Promise<bigint> => {
  const multisigInfo = await connection.getAccountInfo(multisigPda, "confirmed");
  if (!multisigInfo) {
    throw new Error("Multisig account not found");
  }
  
  // Deserialize using the SDK
  const multisigAccount = multisig.accounts.Multisig.fromAccountInfo(multisigInfo)[0];
  const currentIndex = BigInt(multisigAccount.transactionIndex.toString());
  
  console.log(`[Squads] Multisig current transactionIndex: ${currentIndex}`);
  
  // Squads V4 uses the NEXT index (current + 1) for new transactions
  const nextIndex = currentIndex + 1n;
  
  // Find the first free transaction index starting from nextIndex
  for (let offset = 0; offset < 10; offset++) {
    const testIndex = nextIndex + BigInt(offset);
    const [vaultTransactionPda] = multisig.getTransactionPda({
      multisigPda,
      index: testIndex,
      programId: SQUADS_PROGRAM_ID
    });
    
    const txAccount = await connection.getAccountInfo(vaultTransactionPda);
    if (!txAccount) {
      console.log(`[Squads] Using transaction index: ${testIndex}`);
      return testIndex;
    }
    
    console.log(`[Squads] Index ${testIndex} already exists, trying next...`);
  }
  
  throw new Error("Could not find free transaction index after 10 attempts");
};

// SQUADS V4 (Official Mainnet ID)
// Program ID: SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
export const SQUADS_PROGRAM_ID = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf");

export const createSquad = async (
  connection: Connection,
  creator: Keypair,
  member2: PublicKey,
  threshold: number = 1  // Changed to 1: Only GPS approval needed
) => {
  // Auto-Rolling Seed Strategy
  const MAX_ATTEMPTS = 10;
  let lastError: any = null;
  
  // Check balance before starting
  const balance = await connection.getBalance(creator.publicKey);
  console.log(`[Squads] Creator Balance: ${balance / 1e9} SOL`);
  if (balance < 0.01 * 1e9) {
      throw new Error(`Insufficient funds. You have ${balance/1e9} SOL, but need ~0.01 SOL for network fees and rent.`);
  }

  console.log(`[Squads] Server Member Key: ${member2.toBase58()}`);

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
      console.log(`[Squads] Attempting creation with seed index ${i}...`);
      
      // Derive deterministic key for this index
      const seed = creator.publicKey.toBytes();
      seed[i % 32] ^= 0xFF; 
      const createKey = Keypair.fromSeed(seed);

      const [multisigPda] = multisig.getMultisigPda({
          createKey: createKey.publicKey,
          programId: SQUADS_PROGRAM_ID
      });

      const [vaultPda] = multisig.getVaultPda({
          multisigPda,
          index: 0,
          programId: SQUADS_PROGRAM_ID
      });

      // Check if this Multisig ALREADY exists
      const existingInfo = await connection.getAccountInfo(multisigPda);
      
      if (existingInfo && existingInfo.owner.toBase58() === SQUADS_PROGRAM_ID.toBase58()) {
          console.log(`[Squads] Found existing valid Multisig at index ${i}`);
          return { signature: "RECOVERED", multisigPda, vaultPda };
      }

      // If it doesn't exist (or RPC says so), try to create it
      if (!existingInfo) {
          try {
            const members = [
                { key: creator.publicKey, permissions: multisig.types.Permissions.all() },
                { key: member2, permissions: multisig.types.Permissions.fromPermissions([
                    multisig.types.Permission.Vote,
                    multisig.types.Permission.Initiate
                ]) }
            ];

            // Use V4 Creation Method (multisigCreateV2 is the correct one for this SDK)
            // FIX: Manually construct instruction to pass correct Program Config and Treasury
            // Program Config PDA: BSTq9w3kZwNwpBXJEvTZz2G9ZTNyKBvoSeXMvwb4cNZr (Derived from ["multisig", "program_config"])
            // Treasury (from Config): 5DH2e3cJmFpyi6mk65EGFediunm4ui6BiKNUNrhWtD1b
            
            const [programConfigPda] = multisig.getProgramConfigPda({ programId: SQUADS_PROGRAM_ID });
            const programTreasury = new PublicKey("5DH2e3cJmFpyi6mk65EGFediunm4ui6BiKNUNrhWtD1b");
            
            const ix = multisig.generated.createMultisigCreateV2Instruction(
                {
                    programConfig: programConfigPda,
                    treasury: programTreasury,
                    multisig: multisigPda,
                    createKey: createKey.publicKey,
                    creator: creator.publicKey,
                    systemProgram: SystemProgram.programId
                },
                {
                    args: {
                        configAuthority: null,
                        threshold,
                        members,
                        timeLock: 0,
                        rentCollector: null,
                        memo: null
                    }
                },
                SQUADS_PROGRAM_ID
            );

            const latestBlockhash = await connection.getLatestBlockhash();
            const message = new TransactionMessage({
                payerKey: creator.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [ix]
            }).compileToV0Message();

            const tx = new VersionedTransaction(message);
            tx.sign([creator, createKey]);

            const signature = await connection.sendTransaction(tx, { skipPreflight: false });

            const confirmation = await connection.confirmTransaction(signature, "confirmed");
            if (confirmation.value.err) {
                throw new Error("Creation Transaction Failed on-chain: " + JSON.stringify(confirmation.value.err));
            }
            
            // DOUBLE CHECK: Ensure the account is actually visible
            // This prevents "Ghost Vaults" where the tx confirms but the RPC doesn't see the account yet.
            let verifyRetries = 10;
            while (verifyRetries > 0) {
                const info = await connection.getAccountInfo(multisigPda, "confirmed");
                if (info) break;
                await new Promise(r => setTimeout(r, 1000));
                verifyRetries--;
            }
            
            console.log(`[Squads] Index ${i} created and verified (Signature: ${signature}).`);
            return { signature, multisigPda, vaultPda };

          } catch (e: any) {
              const errMsg = (e.message || "") + JSON.stringify(e);
              console.error(`[Squads] Index ${i} failed:`, errMsg);
              lastError = e;

              // SPECIAL HANDLING FOR ERROR 6014 (Already Initialized)
              if (errMsg.includes("6014") || errMsg.includes("already in use")) {
                  console.log(`[Squads] Index ${i} hit Error 6014. Verifying ownership...`);
                  
                  // STRICT VERIFICATION:
                  // We CANNOT assume it's valid just because it exists. It might be a "Zombie" (System Account).
                  // If RPC returns null (lag) OR owner is not Squads, we MUST SKIP.
                  // It is cheaper/safer to create a new vault at Index+1 than to return a broken one.
                  
                  let retries = 5;
                  let verified = false;
                  while (retries > 0) {
                      const check = await connection.getAccountInfo(multisigPda, "confirmed");
                      if (check && check.owner.toBase58() === SQUADS_PROGRAM_ID.toBase58()) {
                          verified = true;
                          break;
                      }
                      await new Promise(r => setTimeout(r, 1000));
                      retries--;
                  }

                  if (verified) {
                      console.log(`[Squads] Index ${i} VERIFIED as valid Multisig. Recovering.`);
                      return { signature: "RECOVERED_6014", multisigPda, vaultPda };
                  } else {
                      console.warn(`[Squads] Index ${i} could not be verified as a Squads Vault. (Likely a Zombie/System Account). SKIPPING.`);
                      continue; // SKIP to next index
                  }
              }

              // If it's NOT 6014, we try the next index
              continue;
          }
      }
  }

  // If we get here, all attempts failed.
  throw lastError || new Error("Failed to find a valid Vault slot after multiple attempts.");
};

export const createTransferProposal = async (
    connection: Connection,
    creator: Keypair,
    multisigPda: PublicKey,
    vaultPda: PublicKey,
    recipient: PublicKey,
    amountLamports: number,
    transactionIndex: bigint
) => {
    // 0. SAFETY CHECK: Wait for RPC to index the Multisig
    console.log("[Squads] Ensuring Multisig is visible to RPC...");
    let retries = 15;
    while (retries > 0) {
        const info = await connection.getAccountInfo(multisigPda, "confirmed");
        if (info) {
            console.log("[Squads] Multisig found on RPC.");
            break;
        }
        console.log(`[Squads] Multisig not found yet. Retrying (${retries})...`);
        await new Promise(r => setTimeout(r, 2000));
        retries--;
    }
    
    // Check vault balance
    const vaultBalance = await connection.getBalance(vaultPda);
    console.log(`[Squads] Vault balance: ${vaultBalance / 1e9} SOL`);
    if (vaultBalance < amountLamports) {
        throw new Error(`Insufficient vault balance. Has ${vaultBalance / 1e9} SOL, need ${amountLamports / 1e9} SOL`);
    }

    // Create transfer instruction
    const transferIx = SystemProgram.transfer({
        fromPubkey: vaultPda,
        toPubkey: recipient,
        lamports: amountLamports
    });

    const transactionMessage = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [transferIx]
    });

    console.log(`[Squads] Creating vault transaction and proposal with index: ${transactionIndex}`);
    console.log(`[Squads] Parameters:`);
    console.log(`  - multisigPda: ${multisigPda.toBase58()}`);
    console.log(`  - vaultPda: ${vaultPda.toBase58()}`);
    console.log(`  - creator: ${creator.publicKey.toBase58()}`);
    console.log(`  - transactionIndex: ${transactionIndex}`);
    console.log(`  - programId: ${SQUADS_PROGRAM_ID.toBase58()}`);
    console.log(`  - transactionIndex type: ${typeof transactionIndex}, value: ${transactionIndex}`);
    
    // Manually derive the expected transaction PDA
    const [expectedTxPda] = multisig.getTransactionPda({
        multisigPda,
        index: transactionIndex,
        programId: SQUADS_PROGRAM_ID
    });
    console.log(`  - Expected Transaction PDA: ${expectedTxPda.toBase58()}`);
    
    try {
        // Use transactions module to build unsigned transactions, then sign and send
        const blockhash = (await connection.getLatestBlockhash()).blockhash;
        
        console.log(`[Squads] Step 1: Building vault transaction instruction...`);
        const vaultTx = multisig.transactions.vaultTransactionCreate({
            blockhash,
            feePayer: creator.publicKey,
            multisigPda,
            transactionIndex,
            creator: creator.publicKey,
            vaultIndex: 0,
            ephemeralSigners: 0,
            transactionMessage,
            programId: SQUADS_PROGRAM_ID
        });
        
        // DEBUG: Log the actual instruction accounts
        const msg = vaultTx.message;
        const ix = msg.compiledInstructions[0];
        console.log(`[Squads] Instruction account indices:`, ix.accountKeyIndexes);
        console.log(`[Squads] Actual accounts:`, ix.accountKeyIndexes.map(idx => msg.staticAccountKeys[idx].toBase58()));
        
        vaultTx.sign([creator]);
        const vaultTxSig = await connection.sendRawTransaction(vaultTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        console.log(`[Squads] Vault transaction sent: ${vaultTxSig}`);
        await connection.confirmTransaction(vaultTxSig, 'confirmed');
        
        console.log(`[Squads] Step 2: Building proposal instruction...`);
        const proposalTx = multisig.transactions.proposalCreate({
            blockhash: (await connection.getLatestBlockhash()).blockhash,
            feePayer: creator.publicKey,
            multisigPda,
            transactionIndex,
            creator: creator.publicKey,
            programId: SQUADS_PROGRAM_ID
        });
        
        proposalTx.sign([creator]);
        const proposalTxSig = await connection.sendRawTransaction(proposalTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        console.log(`[Squads] Proposal sent: ${proposalTxSig}`);
        await connection.confirmTransaction(proposalTxSig, 'confirmed');
        
        console.log(`[Squads] Transaction and proposal created successfully`);
        return proposalTxSig;
    } catch (e: any) {
        console.error(`[Squads] Creation failed:`, e);
        console.error(`[Squads] Error logs:`, e.logs);
        throw e;
    }
};

/**
 * Convert a Jupiter swap instruction to a Solana TransactionInstruction
 */
function convertSwapInstruction(ix: SwapInstructionData): TransactionInstruction {
    return new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map(acc => ({
            pubkey: new PublicKey(acc.pubkey),
            isSigner: acc.isSigner,
            isWritable: acc.isWritable
        })),
        data: Buffer.from(ix.data, "base64")
    });
}

/**
 * Create a swap proposal for vault token swaps via Jupiter
 * 
 * @param connection - Solana connection
 * @param creator - Keypair that pays for transaction fees and creates the proposal
 * @param multisigPda - The multisig PDA
 * @param vaultPda - The vault PDA that holds the tokens
 * @param swapInstructions - Jupiter swap instructions from getSwapInstructions()
 * @param transactionIndex - The transaction index (from getNextTransactionIndex)
 */
export const createSwapProposal = async (
    connection: Connection,
    creator: Keypair,
    multisigPda: PublicKey,
    vaultPda: PublicKey,
    swapInstructions: SwapInstructionsResponse,
    transactionIndex: bigint
): Promise<string> => {
    // 0. SAFETY CHECK: Wait for RPC to index the Multisig
    console.log("[Squads] Ensuring Multisig is visible to RPC...");
    let retries = 15;
    while (retries > 0) {
        const info = await connection.getAccountInfo(multisigPda, "confirmed");
        if (info) {
            console.log("[Squads] Multisig found on RPC.");
            break;
        }
        console.log(`[Squads] Multisig not found yet. Retrying (${retries})...`);
        await new Promise(r => setTimeout(r, 2000));
        retries--;
    }

    // Build all swap instructions
    const allInstructions: TransactionInstruction[] = [];

    // 1. Add compute budget instructions (priority fees, compute units)
    if (swapInstructions.computeBudgetInstructions?.length) {
        console.log(`[Squads] Adding ${swapInstructions.computeBudgetInstructions.length} compute budget instructions`);
        for (const ix of swapInstructions.computeBudgetInstructions) {
            allInstructions.push(convertSwapInstruction(ix));
        }
    }

    // 2. Add setup instructions (create token accounts, etc)
    if (swapInstructions.setupInstructions?.length) {
        console.log(`[Squads] Adding ${swapInstructions.setupInstructions.length} setup instructions`);
        for (const ix of swapInstructions.setupInstructions) {
            allInstructions.push(convertSwapInstruction(ix));
        }
    }

    // 3. Add the main swap instruction
    console.log(`[Squads] Adding swap instruction`);
    allInstructions.push(convertSwapInstruction(swapInstructions.swapInstruction));

    // 4. Add cleanup instruction if present (close WSOL accounts, etc)
    if (swapInstructions.cleanupInstruction) {
        console.log(`[Squads] Adding cleanup instruction`);
        allInstructions.push(convertSwapInstruction(swapInstructions.cleanupInstruction));
    }

    // 5. Add other instructions if present
    if (swapInstructions.otherInstructions?.length) {
        console.log(`[Squads] Adding ${swapInstructions.otherInstructions.length} other instructions`);
        for (const ix of swapInstructions.otherInstructions) {
            allInstructions.push(convertSwapInstruction(ix));
        }
    }

    console.log(`[Squads] Total instructions for swap: ${allInstructions.length}`);

    // Count ephemeral signers needed (accounts marked as signers but aren't the vault or creator)
    // These are typically WSOL accounts that Jupiter creates/closes during swaps
    // NOTE: We exclude the creator (master wallet) since it's not part of the vault transaction
    let ephemeralSignersNeeded = 0;
    const seenSigners = new Set<string>();
    for (const ix of allInstructions) {
        for (const key of ix.keys) {
            const pubkeyStr = key.pubkey.toBase58();
            // Skip if: not a signer, is the vault, is the creator, or already seen
            if (!key.isSigner) continue;
            if (key.pubkey.equals(vaultPda)) continue;
            if (key.pubkey.equals(creator.publicKey)) continue;
            if (seenSigners.has(pubkeyStr)) continue;
            
            seenSigners.add(pubkeyStr);
            ephemeralSignersNeeded++;
            console.log(`[Squads] Found ephemeral signer: ${pubkeyStr}`);
        }
    }
    console.log(`[Squads] Ephemeral signers needed: ${ephemeralSignersNeeded}`);

    // Create the transaction message with vault as payer (the vault executes the swap)
    const transactionMessage = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: allInstructions
    });

    console.log(`[Squads] Creating vault swap transaction and proposal with index: ${transactionIndex}`);
    console.log(`[Squads] Parameters:`);
    console.log(`  - multisigPda: ${multisigPda.toBase58()}`);
    console.log(`  - vaultPda: ${vaultPda.toBase58()}`);
    console.log(`  - creator: ${creator.publicKey.toBase58()}`);
    console.log(`  - transactionIndex: ${transactionIndex}`);
    console.log(`  - ephemeralSigners: ${ephemeralSignersNeeded}`);

    // Manually derive the expected transaction PDA
    const [expectedTxPda] = multisig.getTransactionPda({
        multisigPda,
        index: transactionIndex,
        programId: SQUADS_PROGRAM_ID
    });
    console.log(`  - Expected Transaction PDA: ${expectedTxPda.toBase58()}`);

    try {
        const blockhash = (await connection.getLatestBlockhash()).blockhash;

        console.log(`[Squads] Step 1: Building vault swap transaction instruction...`);
        const vaultTx = multisig.transactions.vaultTransactionCreate({
            blockhash,
            feePayer: creator.publicKey,
            multisigPda,
            transactionIndex,
            creator: creator.publicKey,
            vaultIndex: 0,
            ephemeralSigners: ephemeralSignersNeeded,
            transactionMessage,
            programId: SQUADS_PROGRAM_ID
        });

        vaultTx.sign([creator]);
        const vaultTxSig = await connection.sendRawTransaction(vaultTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        console.log(`[Squads] Vault swap transaction sent: ${vaultTxSig}`);
        await connection.confirmTransaction(vaultTxSig, 'confirmed');

        console.log(`[Squads] Step 2: Building proposal instruction...`);
        const proposalTx = multisig.transactions.proposalCreate({
            blockhash: (await connection.getLatestBlockhash()).blockhash,
            feePayer: creator.publicKey,
            multisigPda,
            transactionIndex,
            creator: creator.publicKey,
            programId: SQUADS_PROGRAM_ID
        });

        proposalTx.sign([creator]);
        const proposalTxSig = await connection.sendRawTransaction(proposalTx.serialize(), {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        });
        console.log(`[Squads] Swap proposal sent: ${proposalTxSig}`);
        await connection.confirmTransaction(proposalTxSig, 'confirmed');

        console.log(`[Squads] Swap transaction and proposal created successfully`);
        return proposalTxSig;
    } catch (e: any) {
        console.error(`[Squads] Swap proposal creation failed:`, e);
        console.error(`[Squads] Error logs:`, e.logs);
        throw e;
    }
};

export const approveProposal = async (
    connection: Connection,
    member: Keypair,
    multisigPda: PublicKey,
    transactionIndex: bigint
) => {
    await proposalApprove({
        connection,
        feePayer: member,
        member,
        multisigPda,
        transactionIndex,
        memo: "Approve",
        programId: SQUADS_PROGRAM_ID
    });
};

export const executeProposal = async (
    connection: Connection,
    member: Keypair,
    multisigPda: PublicKey,
    transactionIndex: bigint
): Promise<string | null> => {
    console.log('[executeProposal] Starting execution...');
    const result = await vaultTransactionExecute({
        connection,
        feePayer: member,
        multisigPda,
        transactionIndex,
        member: member.publicKey,
        signers: [member],
        programId: SQUADS_PROGRAM_ID
    });
    console.log('[executeProposal] Result:', result);
    // Return the signature if available
    const signature = result?.signature || null;
    console.log('[executeProposal] Returning signature:', signature);
    return signature;
};

/**
 * Execute a swap proposal with address lookup tables
 * 
 * @param connection - Solana connection
 * @param member - Keypair that executes the proposal
 * @param multisigPda - The multisig PDA
 * @param transactionIndex - The transaction index
 * @param addressLookupTableAddresses - Array of ALT addresses from Jupiter swap instructions
 */
export const executeSwapProposal = async (
    connection: Connection,
    member: Keypair,
    multisigPda: PublicKey,
    transactionIndex: bigint,
    addressLookupTableAddresses: string[] = []
): Promise<string | null> => {
    console.log(`[Squads] Executing swap proposal with ${addressLookupTableAddresses.length} ALTs`);
    
    // Resolve address lookup tables if provided
    let addressLookupTableAccounts: AddressLookupTableAccount[] = [];
    
    if (addressLookupTableAddresses.length > 0) {
        console.log(`[Squads] Fetching address lookup tables...`);
        const altPromises = addressLookupTableAddresses.map(async (address) => {
            try {
                const pubkey = new PublicKey(address);
                const result = await connection.getAddressLookupTable(pubkey);
                return result.value;
            } catch (e) {
                console.warn(`[Squads] Failed to fetch ALT ${address}:`, e);
                return null;
            }
        });
        
        const results = await Promise.all(altPromises);
        addressLookupTableAccounts = results.filter((alt): alt is AddressLookupTableAccount => alt !== null);
        console.log(`[Squads] Resolved ${addressLookupTableAccounts.length} ALTs`);
    }
    
    try {
        const result = await vaultTransactionExecute({
            connection,
            feePayer: member,
            multisigPda,
            transactionIndex,
            member: member.publicKey,
            signers: [member],
            programId: SQUADS_PROGRAM_ID,
            sendOptions: {
                skipPreflight: false,
            }
        });
        
        console.log(`[Squads] Swap proposal executed:`, result?.signature);
        return result?.signature || null;
    } catch (e: any) {
        console.error(`[Squads] Swap execution failed:`, e);
        console.error(`[Squads] Error logs:`, e.logs);
        throw e;
    }
};
