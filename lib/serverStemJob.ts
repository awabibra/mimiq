import { createHmac, timingSafeEqual } from "node:crypto";

export interface StemJobClaims {
  jobId: string;
  projectId: string;
  sourceAssetId: string;
}

function signingSecret() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Stem job signing is not configured.");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingSecret())
    .update(payload)
    .digest("base64url");
}

export function issueStemJobToken(claims: StemJobClaims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyStemJobToken(
  token: string,
  expected: StemJobClaims
) {
  const claims = readStemJobToken(token);
  return Boolean(
    claims &&
      claims.jobId === expected.jobId &&
      claims.projectId === expected.projectId &&
      claims.sourceAssetId === expected.sourceAssetId
  );
}

export function readStemJobToken(token: string): StemJobClaims | null {
  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;

  const expectedSignature = signature(payload);
  const supplied = Buffer.from(suppliedSignature);
  const calculated = Buffer.from(expectedSignature);
  if (
    supplied.length !== calculated.length ||
    !timingSafeEqual(supplied, calculated)
  ) {
    return null;
  }

  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as StemJobClaims;
  } catch {
    return null;
  }
}
