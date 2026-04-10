/**
 * PIN authentication with bcrypt hashing and retry lockout.
 */

import * as crypto from "node:crypto";
import bcrypt from "bcryptjs";

// ---------------------------------------------------------------------------
// PIN hashing
// ---------------------------------------------------------------------------

const BCRYPT_ROUNDS = 10;

export async function hashPin(pin: string): Promise<string> {
	return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
	return bcrypt.compare(pin, hash);
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

interface SessionToken {
	token: string;
	expiresAt: number;
}

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

const activeTokens = new Map<string, SessionToken>();

export function createSessionToken(): string {
	const token = crypto.randomBytes(32).toString("hex");
	activeTokens.set(token, {
		token,
		expiresAt: Date.now() + TOKEN_LIFETIME_MS,
	});
	return token;
}

export function validateSessionToken(token: string): boolean {
	const session = activeTokens.get(token);
	if (!session) return false;
	if (Date.now() > session.expiresAt) {
		activeTokens.delete(token);
		return false;
	}
	return true;
}

export function revokeAllTokens(): void {
	activeTokens.clear();
}

// ---------------------------------------------------------------------------
// Retry lockout (in-memory, resets on server restart)
// ---------------------------------------------------------------------------

interface LockoutState {
	failures: number;
	lockedUntil: number;
}

const lockout: LockoutState = {
	failures: 0,
	lockedUntil: 0,
};

const LOCKOUT_TIERS = [
	{ threshold: 5, durationMs: 30 * 1000 }, // 5 failures → 30s
	{ threshold: 10, durationMs: 5 * 60 * 1000 }, // 10 failures → 5min
	{ threshold: 15, durationMs: 30 * 60 * 1000 }, // 15 failures → 30min
];

/**
 * Check if the server is currently locked out.
 * Returns the number of seconds remaining, or 0 if not locked.
 */
export function getLockoutRemaining(): number {
	if (lockout.lockedUntil <= Date.now()) return 0;
	return Math.ceil((lockout.lockedUntil - Date.now()) / 1000);
}

/**
 * Record a failed authentication attempt.
 * Returns the lockout duration in seconds if a lockout was triggered, or 0.
 */
export function recordFailure(): number {
	lockout.failures++;

	// Find the applicable lockout tier (highest threshold met)
	let lockoutDuration = 0;
	for (const tier of LOCKOUT_TIERS) {
		if (lockout.failures >= tier.threshold) {
			lockoutDuration = tier.durationMs;
		}
	}

	if (lockoutDuration > 0) {
		lockout.lockedUntil = Date.now() + lockoutDuration;
		return Math.ceil(lockoutDuration / 1000);
	}

	return 0;
}

/**
 * Reset failure counter (e.g. on successful auth).
 */
export function resetFailures(): void {
	lockout.failures = 0;
	lockout.lockedUntil = 0;
}
