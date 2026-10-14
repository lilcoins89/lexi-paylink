import { eq } from "drizzle-orm";
import { merchants, merchantSettings } from "../drizzle/schema";
import { getDb } from "./db";

export async function getOrCreateMerchant(ownerOpenId: string, preferredName?: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database is not available.");
  let [merchant] = await db.select().from(merchants).where(eq(merchants.ownerOpenId, ownerOpenId)).limit(1);
  if (!merchant) {
    const displayName = (preferredName?.trim() || "Your business").slice(0, 120);
    try {
      await db.insert(merchants).values({ ownerOpenId, displayName });
    } catch {
      // A concurrent first request may have created the unique owner row.
    }
    [merchant] = await db.select().from(merchants).where(eq(merchants.ownerOpenId, ownerOpenId)).limit(1);
  }
  if (!merchant) throw new Error("Merchant profile could not be initialized.");
  const [settings] = await db.select().from(merchantSettings).where(eq(merchantSettings.merchantId, merchant.id)).limit(1);
  if (!settings) {
    try { await db.insert(merchantSettings).values({ merchantId: merchant.id }); } catch { /* another request may have inserted it */ }
  }
  const [resolvedSettings] = await db.select().from(merchantSettings).where(eq(merchantSettings.merchantId, merchant.id)).limit(1);
  if (!resolvedSettings) throw new Error("Merchant settings could not be initialized.");
  return { db, merchant, settings: resolvedSettings };
}
