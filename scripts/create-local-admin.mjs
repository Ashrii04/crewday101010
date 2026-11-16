#!/usr/bin/env node
/**
 * Create a dummy admin account in the LOCAL Firebase emulators.
 *
 *   npm run emulators          (in one terminal, leave it running)
 *   node scripts/create-local-admin.mjs
 *
 * Writes only to the Auth emulator (127.0.0.1:9099) and the Firestore emulator
 * (127.0.0.1:8080), in a demo project. It refuses to run against anything else,
 * so it cannot touch production data.
 */

const AUTH_HOST = 'http://127.0.0.1:9099'
const FIRESTORE_HOST = 'http://127.0.0.1:8080'
const PROJECT_ID = process.env.VITE_FIREBASE_PROJECT_ID || 'demo-crewday'
const API_KEY = process.env.VITE_FIREBASE_API_KEY || 'demo-api-key'

const EMAIL = 'admin@crewday.local'
const PASSWORD = 'Admin12345!'
const NAME = 'Local Admin'

// Hard guard: only a demo project, only local emulator hosts.
if (!PROJECT_ID.startsWith('demo-')) {
  console.error(`Refusing to run: project "${PROJECT_ID}" is not a demo- project.`)
  process.exit(1)
}
for (const host of [AUTH_HOST, FIRESTORE_HOST]) {
  if (!/^http:\/\/127\.0\.0\.1:/.test(host)) {
    console.error(`Refusing to run: ${host} is not a local emulator host.`)
    process.exit(1)
  }
}

async function call(url, options = {}) {
  let response
  try {
    response = await fetch(url, options)
  } catch {
    console.error('Could not reach the emulators. Start them first: npm run emulators')
    process.exit(1)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body.error ?? body)}`)
  }
  return body
}

// 1. Auth user (create, or sign in if it already exists).
let localId
try {
  const created = await call(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    },
  )
  localId = created.localId
} catch (error) {
  if (!String(error.message).includes('EMAIL_EXISTS')) throw error
  const signedIn = await call(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    },
  )
  localId = signedIn.localId
}

// 2. Profile document with role "admin" (the emulator accepts the owner token and skips rules).
const now = new Date().toISOString()
const str = (value) => ({ stringValue: value })
const bool = (value) => ({ booleanValue: value })
const ts = (value) => ({ timestampValue: value })
const fields = {
  uid: str(localId),
  name: str(NAME),
  email: str(EMAIL),
  phone: str(''),
  photoURL: str(''),
  city: str('Bengaluru'),
  area: str('Indiranagar'),
  interests: { arrayValue: { values: [str('Music'), str('Hiking')] } },
  participationType: str('audience'),
  role: str('admin'),
  status: str('active'),
  isGuest: bool(false),
  onboardingCompleted: bool(true),
  notificationPrefs: {
    mapValue: {
      fields: {
        newEvents: bool(true),
        reminders: bool(true),
        registrationUpdates: bool(true),
        push: bool(false),
      },
    },
  },
  privacyPrefs: {
    mapValue: { fields: { showProfileInCrew: bool(true), showInterests: bool(true) } },
  },
  fcmTokens: { arrayValue: { values: [] } },
  eventsRegistered: { integerValue: '0' },
  eventsAttended: { integerValue: '0' },
  createdAt: ts(now),
  updatedAt: ts(now),
  lastActiveAt: ts(now),
}

await call(
  `${FIRESTORE_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${localId}`,
  {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  },
)

console.log('Local admin ready (emulator only):')
console.log(`  Email:    ${EMAIL}`)
console.log(`  Password: ${PASSWORD}`)
console.log('  Sign in at http://localhost:5173/admin/login')
