import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const encoded = process.env.LEXI_ENCRYPTION_KEY;
  if (!encoded) throw new Error("LEXI_ENCRYPTION_KEY is required before storing integration secrets.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("LEXI_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptSecret(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(encoded: string): string {
  const [version, ivPart, tagPart, encryptedPart] = encoded.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) throw new Error("Unsupported encrypted secret format.");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
}
