import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("HFnduspXpAhRsNUrYNSohCsXwcuHZfYKwPtXsq7MEcqH");

// Cast to any to avoid strict type checking on IDL structure for now
const IDL: any = {
    "version": "0.1.0",
    "name": "geo_guard",
    "instructions": [
        {
            "name": "initializeUser",
            "accounts": [
                { "name": "userConfig", "isMut": true, "isSigner": false },
                { "name": "owner", "isMut": true, "isSigner": true },
                { "name": "systemProgram", "isMut": false, "isSigner": false }
            ],
            "args": [
                { "name": "homeZoneHash", "type": { "array": ["u8", 32] } }
            ]
        },
        {
            "name": "approveTransfer",
            "accounts": [
                { "name": "userConfig", "isMut": false, "isSigner": false },
                { "name": "multisig", "isMut": true, "isSigner": false },
                { "name": "transaction", "isMut": true, "isSigner": false },
                { "name": "squadsProgram", "isMut": false, "isSigner": false }
            ],
            "args": [
                { "name": "proof", "type": "bytes" }
            ]
        }
    ]
};

export const getUserConfigPda = (owner: PublicKey) => {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("user_config"), owner.toBuffer()],
        PROGRAM_ID
    )[0];
};

export const initializeUser = async (
    connection: Connection,
    wallet: anchor.Wallet,
    homeZoneHash: number[]
) => {
    const provider = new anchor.AnchorProvider(connection, wallet, {});
    IDL.address = PROGRAM_ID.toBase58();
    const program = new anchor.Program(IDL, provider);

    const userConfigPda = getUserConfigPda(wallet.publicKey);

    await program.methods.initializeUser(homeZoneHash)
        .accounts({
            userConfig: userConfigPda,
            owner: wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId
        })
        .rpc();
    
    return userConfigPda;
};

export const approveTransfer = async (
    connection: Connection,
    wallet: anchor.Wallet,
    multisigPda: PublicKey,
    transactionPda: PublicKey,
    proof: Buffer
) => {
    const provider = new anchor.AnchorProvider(connection, wallet, {});
    IDL.address = PROGRAM_ID.toBase58();
    const program = new anchor.Program(IDL, provider);

    const userConfigPda = getUserConfigPda(wallet.publicKey);
    const squadsProgramId = new PublicKey("SQDS4ep65T869zXXM1msaT9bv58q1sYndLPw426rDk8"); // Squads V4 Program ID

    await program.methods.approveTransfer(proof)
        .accounts({
            userConfig: userConfigPda,
            multisig: multisigPda,
            transaction: transactionPda,
            squadsProgram: squadsProgramId
        })
        .rpc();
};
