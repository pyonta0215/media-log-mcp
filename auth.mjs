import { createRemoteJWKSet, jwtVerify } from "jose";

const configured = Boolean(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_REGION);
const issuer = configured
  ? `https://cognito-idp.${process.env.COGNITO_REGION}.amazonaws.com/${process.env.COGNITO_USER_POOL_ID}`
  : null;
const jwks = configured ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;

export async function verifyToken(token) {
  if (!configured) {
    if (process.env.AUTH_REQUIRED === "true") {
      throw new Error("Cognito configuration is required when AUTH_REQUIRED=true");
    }
    return { sub: "local" };
  }
  if (!process.env.COGNITO_CLIENT_ID) {
    throw new Error("COGNITO_CLIENT_ID is required for audience validation");
  }
  const { payload } = await jwtVerify(token, jwks, { issuer });
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (payload.aud !== clientId && payload.client_id !== clientId) {
    throw new Error("Token audience does not match this client");
  }
  if (payload.token_use && !["access", "id"].includes(payload.token_use)) {
    throw new Error("Unsupported Cognito token");
  }
  return payload;
}

export function requireAuth() {
  return async (req, res, next) => {
    if (!configured && process.env.AUTH_REQUIRED !== "true") return next();
    const header = req.get("authorization") || "";
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Authorization bearer token required" });
    }
    try {
      req.user = await verifyToken(header.slice(7));
      next();
    } catch (error) {
      console.error("JWT verification failed:", error.code || error.message);
      res.status(401).json({ error: "Invalid token" });
    }
  };
}
