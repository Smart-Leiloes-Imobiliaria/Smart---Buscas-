import type { AuthenticatedUser, UserRole } from "@/lib/auth/types";

const encoder = new TextEncoder();

type SessionPayload = AuthenticatedUser & { expiresAt: number };

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function sessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (secret) return secret;
  return process.env.NODE_ENV === "production" ? null : "morada-local-auth-secret-change-me";
}

function isUserRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "USER";
}

export async function createSessionToken(user: AuthenticatedUser) {
  const secret = sessionSecret();
  if (!secret) throw new Error("AUTH_SESSION_SECRET não configurado");
  const payload: SessionPayload = {
    ...user,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
  };
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret),
    encoder.encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  const secret = sessionSecret();
  if (!token || !secret) return null;
  const [encodedPayload, encodedSignature, ...extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra.length) return null;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      decodeBase64Url(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as Partial<SessionPayload>;
    if (
      typeof payload.id !== "string" ||
      typeof payload.email !== "string" ||
      !isUserRole(payload.role) ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now()
    ) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}
