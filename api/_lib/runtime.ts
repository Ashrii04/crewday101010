/**
 * Real-world wiring for the payment routes: environment variables, a lazily
 * initialised firebase-admin and the production dependency sets.
 *
 * Nothing here runs at import time. A deployment with no keys must still load,
 * so every missing value surfaces later as a 503 ("not set up yet"), never as a
 * crash. Env names are server-only: none of them carries the `VITE_` prefix, so
 * Vite never inlines them into the browser bundle.
 */

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import {
  NotConfiguredError,
  type OrderRouteDeps,
  type WebhookRouteDeps,
} from './payments.js'

type Env = Record<string, string | undefined>

const APP_NAME = 'crewday-payments'
const DEFAULT_PROJECT_ID = 'crewday-2657d'

export function projectIdFrom(env: Env): string {
  return (
    env.FIREBASE_PROJECT_ID?.trim() || env.VITE_FIREBASE_PROJECT_ID?.trim() || DEFAULT_PROJECT_ID
  )
}

/** The Razorpay API keys, or null unless both are set. */
export function razorpayKeysFrom(env: Env): { keyId: string; keySecret: string } | null {
  const keyId = env.RAZORPAY_KEY_ID?.trim()
  const keySecret = env.RAZORPAY_KEY_SECRET?.trim()
  return keyId && keySecret ? { keyId, keySecret } : null
}

export function webhookSecretFrom(env: Env): string | null {
  return env.RAZORPAY_WEBHOOK_SECRET?.trim() || null
}

/**
 * Parse `FIREBASE_SERVICE_ACCOUNT_JSON`: the key file's JSON as-is, or that same
 * JSON base64-encoded (handy where a multi-line value is awkward to paste).
 * Returns null when it is absent or unusable. The error from a bad parse is
 * deliberately dropped: it can quote part of the secret.
 */
export function parseServiceAccount(raw: string | undefined): Record<string, unknown> | null {
  const text = raw?.trim()
  if (!text) return null
  try {
    const decoded = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(decoded)
    if (typeof parsed !== 'object' || parsed === null) return null
    const account = parsed as Record<string, unknown>
    return typeof account.client_email === 'string' && typeof account.private_key === 'string'
      ? account
      : null
  } catch {
    return null
  }
}

/**
 * Build (once) the admin app. Credentials come from the service account env var;
 * with none, `FIRESTORE_EMULATOR_HOST` (tests only) allows a credential-less app
 * pointed at the emulator. Otherwise payments are simply not set up.
 */
export function getAdminApp(env: Env = process.env): App {
  const existing = getApps().find((app) => app.name === APP_NAME)
  if (existing) return existing

  const projectId = projectIdFrom(env)
  const account = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT_JSON)
  if (account) {
    return initializeApp(
      // `cert` takes the key file's own snake_case fields.
      { credential: cert(account as Parameters<typeof cert>[0]), projectId },
      APP_NAME,
    )
  }
  if (env.FIRESTORE_EMULATOR_HOST) return initializeApp({ projectId }, APP_NAME)
  throw new NotConfiguredError()
}

export function getAdminDb(env: Env = process.env): Firestore {
  return getFirestore(getAdminApp(env))
}

export function productionOrderDeps(env: Env = process.env): OrderRouteDeps {
  return {
    razorpay: () => razorpayKeysFrom(env),
    verifyIdToken: (idToken) => getAuth(getAdminApp(env)).verifyIdToken(idToken),
    getDb: () => getAdminDb(env),
  }
}

export function productionWebhookDeps(env: Env = process.env): WebhookRouteDeps {
  return {
    webhookSecret: () => webhookSecretFrom(env),
    getDb: () => getAdminDb(env),
  }
}
