import { afterEach, describe, expect, it, vi } from "vitest";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { OFFICIAL_USDC_MINT, verifyUsdcTransfer } from "./solana";

const signature = "5".repeat(64);
const receivingWallet = "MerchantWalletPublicAddress";
const reference = "InvoiceReferencePublicKey";
const merchantTokenAccount = "MerchantAssociatedTokenAccount";
const merchantTokenAccountIndex = 2;

function rpcFetch(options: { confirmationStatus?: string; statusError?: unknown; transactionError?: unknown; referencePresent?: boolean; transferPresent?: boolean; transferProgramId?: string; transferMint?: string; transferAmount?: string; postOwner?: string; postMint?: string; preAmount?: string; postAmount?: string } = {}) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string };
    if (body.method === "getSignatureStatuses") {
      return new Response(JSON.stringify({ result: { value: [{ err: options.statusError ?? null, confirmationStatus: options.confirmationStatus ?? "finalized" }] } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ result: {
      blockTime: 1_800_000_000,
      transaction: { message: {
        accountKeys: options.referencePresent === false ? ["some-other-key", "payer", merchantTokenAccount] : [reference, "payer", merchantTokenAccount],
        instructions: options.transferPresent === false ? [] : [{
          programId: options.transferProgramId ?? TOKEN_PROGRAM_ID.toBase58(),
          parsed: { type: "transferChecked", info: { source: "payer-token-account", destination: merchantTokenAccount, mint: options.transferMint ?? OFFICIAL_USDC_MINT.devnet, tokenAmount: { amount: options.transferAmount ?? "1250000", decimals: 6 } } },
        }],
      } },
      meta: { err: options.transactionError ?? null,
        preTokenBalances: [{ accountIndex: merchantTokenAccountIndex, mint: OFFICIAL_USDC_MINT.devnet, owner: receivingWallet, uiTokenAmount: { amount: options.preAmount ?? "0", decimals: 6 } }],
        postTokenBalances: [{ accountIndex: merchantTokenAccountIndex, mint: options.postMint ?? OFFICIAL_USDC_MINT.devnet, owner: options.postOwner ?? receivingWallet, uiTokenAmount: { amount: options.postAmount ?? "1250000", decimals: 6 } }],
      },
    } }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("server-side Solana USDC verification", () => {
  const base = { signature, network: "devnet" as const, expectedMint: OFFICIAL_USDC_MINT.devnet, receivingWallet, paymentReference: reference };

  it("accepts a finalized parsed SPL transfer matching merchant USDC delta and invoice reference", async () => {
    vi.stubGlobal("fetch", rpcFetch({ preAmount: "100", postAmount: "1250100" }));
    const result = await verifyUsdcTransfer(base);
    expect(result).toMatchObject({ outcome: "verified", detected: true, receivedBaseUnits: "1250000", mint: OFFICIAL_USDC_MINT.devnet, receivingWallet });
  });

  it("reports a visible but unfinalized signature as detected and pending, never paid", async () => {
    vi.stubGlobal("fetch", rpcFetch({ confirmationStatus: "confirmed" }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "pending", detected: true });
  });

  it("rejects a wrong invoice reference, wrong destination owner, and wrong mint", async () => {
    vi.stubGlobal("fetch", rpcFetch({ referencePresent: false }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "failed", detected: true });
    vi.stubGlobal("fetch", rpcFetch({ postOwner: "DifferentWallet" }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "failed", detected: true });
    const wrongMint = await verifyUsdcTransfer({ ...base, expectedMint: "NotTheOfficialMint" });
    expect(wrongMint).toMatchObject({ outcome: "failed", detected: false });
  });

  it("rejects a balance delta without a matching official SPL Token transfer instruction", async () => {
    vi.stubGlobal("fetch", rpcFetch({ transferPresent: false }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "failed", detected: true });
    vi.stubGlobal("fetch", rpcFetch({ transferAmount: "1" }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "failed", detected: true });
    vi.stubGlobal("fetch", rpcFetch({ transferProgramId: "FakeTokenProgram" }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "failed", detected: true });
  });

  it("does not interpret RPC uncertainty as a detected or confirmed payment", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("provider unavailable"); }));
    expect(await verifyUsdcTransfer(base)).toMatchObject({ outcome: "pending", detected: false });
  });
});
