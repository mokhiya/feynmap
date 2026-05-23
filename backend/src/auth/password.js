// bcrypt wrapper. Single point of truth for cost factor and the
// hash/verify pair so callers never reach for `bcrypt` directly.
//
// Cost 12 is the 2025 default — ~250ms on an M-series Mac, still
// snappy enough for interactive login while making offline brute force
// expensive. Bump to 13 if hardware gets a generation ahead of attackers.

import bcrypt from 'bcrypt';

const COST = 12;

export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('password must be a string of length >= 8');
  }
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
