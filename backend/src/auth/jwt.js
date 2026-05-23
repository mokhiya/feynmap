// JWT sign/verify. Stateless sessions — server keeps no session table.
//
// Token claims (compact, intentionally minimal):
//   sub  — user.id (uuid)
//   org  — user.orgId (uuid)            ← saves an extra DB hop on each request
//   iat  — issued at (auto)
//   exp  — expiry (auto, from JWT_TTL)
//
// Roles + permissions are NOT in the token. They're loaded fresh on
// every request from the DB so revoking a role takes effect immediately
// without waiting for token expiry.

import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
const TTL = process.env.JWT_TTL || '7d';

if (!SECRET || SECRET.length < 32) {
  // Don't throw at import time — keeps tests/imports cheap. The first
  // sign/verify call will surface this.
  console.warn('[auth/jwt] JWT_SECRET is missing or too short (<32 chars).');
}

export function signToken({ userId, orgId }) {
  if (!SECRET) throw new Error('JWT_SECRET is not set');
  return jwt.sign({ sub: userId, org: orgId }, SECRET, { expiresIn: TTL });
}

export function verifyToken(token) {
  if (!SECRET) throw new Error('JWT_SECRET is not set');
  // jwt.verify throws on invalid/expired — let caller decide how to react.
  return jwt.verify(token, SECRET);
}
