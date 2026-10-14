const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);

export function parseUsdcAmount(value: string): string {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,20})(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Enter a positive USDC amount with up to 6 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const units = BigInt(whole) * UNIT + BigInt((fraction + "000000").slice(0, 6));
  if (units <= 0n) throw new Error("Amount must be greater than zero.");
  return units.toString();
}

export function formatUsdcAmount(baseUnits: string | bigint): string {
  const units = BigInt(baseUnits);
  const whole = units / UNIT;
  const fraction = (units % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function classifyAmount(actual: bigint, expected: bigint, policy: "reject" | "accept") {
  if (actual < expected) return { status: "UNDERPAID" as const, fulfill: false };
  if (actual > expected) return { status: "OVERPAID" as const, fulfill: policy === "accept" };
  return { status: "CONFIRMED" as const, fulfill: true };
}
