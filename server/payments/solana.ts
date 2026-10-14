import type { SolanaNetwork } from "@shared/lexi";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const OFFICIAL_USDC_MINT: Record<SolanaNetwork, string> = {
  mainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export type TransferVerification =
  | { outcome: "pending"; detected: boolean; reason: string }
  | { outcome: "failed"; detected: boolean; reason: string }
  | { outcome: "verified"; detected: true; receivedBaseUnits: string; confirmedAt: Date; mint: string; receivingWallet: string };

type RpcEnvelope<T> = { jsonrpc: string; id: number; result?: T; error?: { code: number; message: string } };

function rpcUrl(network: SolanaNetwork): string {
  return network === "mainnet"
    ? process.env.SOLANA_RPC_URL_MAINNET || "https://api.mainnet-beta.solana.com"
    : process.env.SOLANA_RPC_URL_DEVNET || "https://api.devnet.solana.com";
}

async function rpc<T>(network: SolanaNetwork, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpcUrl(network), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}`);
  const payload = await response.json() as RpcEnvelope<T>;
  if (payload.error) throw new Error(`Solana RPC error ${payload.error.code}`);
  if (payload.result === undefined) throw new Error("Solana RPC returned no result");
  return payload.result;
}

type StatusResult = { value: Array<{ err: unknown; confirmationStatus: string | null } | null> };
type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } };
type ParsedInstruction = { programId?: string; parsed?: { type?: string; info?: { destination?: string; mint?: string; amount?: string; tokenAmount?: { amount?: string; decimals?: number } } } };
type TransactionResult = {
  blockTime: number | null;
  transaction?: { message?: { accountKeys?: Array<string | { pubkey: string }>; instructions?: ParsedInstruction[] } };
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[]; innerInstructions?: Array<{ instructions?: ParsedInstruction[] }> } | null;
};

export async function verifyUsdcTransfer(input: {
  signature: string;
  network: SolanaNetwork;
  expectedMint: string;
  receivingWallet: string;
  paymentReference: string;
}): Promise<TransferVerification> {
  if (input.expectedMint !== OFFICIAL_USDC_MINT[input.network]) {
    return { outcome: "failed", detected: false, reason: "Invoice mint does not match the official USDC mint configured for this network." };
  }
  let status: StatusResult;
  try {
    status = await rpc<StatusResult>(input.network, "getSignatureStatuses", [[input.signature], { searchTransactionHistory: true }]);
  } catch {
    return { outcome: "pending", detected: false, reason: "The RPC provider could not establish signature status. No payment was confirmed." };
  }
  const signatureStatus = status.value[0];
  if (!signatureStatus) return { outcome: "pending", detected: false, reason: "Transaction is not yet visible on the selected Solana network." };
  if (signatureStatus.err) return { outcome: "failed", detected: true, reason: "The Solana transaction failed on-chain." };
  if (signatureStatus.confirmationStatus !== "finalized") return { outcome: "pending", detected: true, reason: "Waiting for finalized Solana commitment." };

  let transaction: TransactionResult | null;
  try {
    transaction = await rpc<TransactionResult | null>(input.network, "getTransaction", [input.signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  } catch {
    return { outcome: "pending", detected: true, reason: "Finalized transaction details are temporarily unavailable from RPC." };
  }
  if (!transaction?.meta) return { outcome: "pending", detected: true, reason: "Finalized transaction details are not available yet." };
  if (transaction.meta.err) return { outcome: "failed", detected: true, reason: "The Solana transaction failed on-chain." };
  const accountKeys = transaction.transaction?.message?.accountKeys ?? [];
  const hasReference = accountKeys.some(key => (typeof key === "string" ? key : key.pubkey) === input.paymentReference);
  if (!hasReference) return { outcome: "failed", detected: true, reason: "The finalized transaction does not contain this invoice's unique Solana Pay reference." };

  const pre = new Map((transaction.meta.preTokenBalances ?? []).map(balance => [`${balance.accountIndex}:${balance.mint}:${balance.owner ?? ""}`, BigInt(balance.uiTokenAmount.amount)]));
  const instructions = [...(transaction.transaction?.message?.instructions ?? []), ...(transaction.meta.innerInstructions ?? []).flatMap(group => group.instructions ?? [])];
  const incomingByAccount = new Map<string, bigint>();
  for (const instruction of instructions) {
    const parsed = instruction.parsed;
    if (instruction.programId !== TOKEN_PROGRAM_ID.toBase58() || !parsed?.type || !["transfer", "transferChecked"].includes(parsed.type)) continue;
    const info = parsed.info;
    if (!info?.destination || (info.mint && info.mint !== input.expectedMint)) continue;
    if (parsed.type === "transferChecked" && info.tokenAmount?.decimals !== 6) continue;
    const rawAmount = parsed.type === "transferChecked" ? info.tokenAmount?.amount : info.amount ?? info.tokenAmount?.amount;
    if (!rawAmount || !/^\d+$/.test(rawAmount)) continue;
    incomingByAccount.set(info.destination, (incomingByAccount.get(info.destination) ?? 0n) + BigInt(rawAmount));
  }
  let received = 0n;
  for (const balance of transaction.meta.postTokenBalances ?? []) {
    if (balance.mint !== input.expectedMint || balance.owner !== input.receivingWallet || balance.uiTokenAmount.decimals !== 6) continue;
    const key = `${balance.accountIndex}:${balance.mint}:${balance.owner}`;
    const delta = BigInt(balance.uiTokenAmount.amount) - (pre.get(key) ?? 0n);
    if (delta <= 0n) continue;
    const accountKey = accountKeys[balance.accountIndex];
    const destination = typeof accountKey === "string" ? accountKey : accountKey?.pubkey;
    const instructionAmount = destination ? incomingByAccount.get(destination) ?? 0n : 0n;
    if (instructionAmount !== delta) return { outcome: "failed", detected: true, reason: "A positive merchant USDC balance delta did not match a parsed SPL Token transfer instruction." };
    received += instructionAmount;
  }
  if (received <= 0n) return { outcome: "failed", detected: true, reason: "No matching finalized SPL Token USDC transfer to a merchant-owned token account was found." };
  return {
    outcome: "verified",
    detected: true,
    receivedBaseUnits: received.toString(),
    confirmedAt: new Date((transaction.blockTime ?? Math.floor(Date.now() / 1000)) * 1000),
    mint: input.expectedMint,
    receivingWallet: input.receivingWallet,
  };
}
