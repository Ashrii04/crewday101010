import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { COLLECTIONS, db } from '@/firebase/config'
import type { PaymentSettings } from '@/types'
import { sanitiseText } from '@/utils/validation'

/** Where the organiser's UPI details live. Public read, admin write (see the rules). */
const PAYMENTS_DOC = 'payments'

/** A UPI id looks like `name@bank`: a handle, an `@`, then a short alphanumeric PSP code. */
const UPI_ID_RE = /^[a-zA-Z0-9._-]{2,50}@[a-zA-Z][a-zA-Z0-9]{1,29}$/

export const PAYEE_NAME_MAX = 60

export function isUpiId(value: string): boolean {
  return UPI_ID_RE.test(value.trim())
}

export type PaymentSettingsErrors = Partial<Record<keyof PaymentSettings, string>>

/** Field-level problems with a draft; an empty object means it is safe to save. */
export function validatePaymentSettings(input: PaymentSettings): PaymentSettingsErrors {
  const errors: PaymentSettingsErrors = {}
  const upiId = input.upiId.trim()
  const payeeName = sanitiseText(input.payeeName, PAYEE_NAME_MAX + 1)

  if (!upiId) errors.upiId = 'Enter the UPI ID attendees should pay.'
  else if (!isUpiId(upiId)) errors.upiId = 'A UPI ID looks like name@bank, for example crewday@okaxis.'

  if (!payeeName) errors.payeeName = 'Enter the name attendees will see when they pay.'
  else if (payeeName.length > PAYEE_NAME_MAX)
    errors.payeeName = `Keep the name to ${PAYEE_NAME_MAX} characters or fewer.`

  return errors
}

/**
 * The organiser's payment details, or `null` when they have not been set up
 * (or the stored values are not usable). Readable by anyone, because an
 * attendee needs them to pay; a missing document is the normal first-run state.
 */
export async function getPaymentSettings(): Promise<PaymentSettings | null> {
  const snapshot = await getDoc(doc(db, COLLECTIONS.settings, PAYMENTS_DOC))
  if (!snapshot.exists()) return null
  const data = snapshot.data()
  const upiId = typeof data.upiId === 'string' ? data.upiId.trim() : ''
  const payeeName = typeof data.payeeName === 'string' ? data.payeeName.trim() : ''
  // A hand-edited, half-filled document must not produce a broken pay button.
  if (!isUpiId(upiId) || !payeeName) return null
  return { upiId, payeeName }
}

/** Validate and store the organiser's UPI details. Admin only, enforced by the rules. */
export async function savePaymentSettings(
  input: PaymentSettings,
  adminUid: string,
): Promise<PaymentSettings> {
  const errors = validatePaymentSettings(input)
  const firstError = errors.upiId ?? errors.payeeName
  if (firstError) throw new Error(firstError)

  const settings: PaymentSettings = {
    upiId: input.upiId.trim(),
    payeeName: sanitiseText(input.payeeName, PAYEE_NAME_MAX),
  }
  await setDoc(doc(db, COLLECTIONS.settings, PAYMENTS_DOC), {
    ...settings,
    updatedBy: adminUid,
    updatedAt: serverTimestamp(),
  })
  return settings
}
