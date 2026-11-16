/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID: string
  readonly VITE_FIREBASE_VAPID_KEY: string
  readonly VITE_USE_FIREBASE_EMULATORS: string
  /** Public support address shown on the privacy and account-deletion pages. */
  readonly VITE_SUPPORT_EMAIL?: string
  /** "true" shows the Razorpay online checkout button (needs deployed Functions). */
  readonly VITE_ONLINE_PAYMENTS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
