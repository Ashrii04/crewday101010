export interface UpiLinkInput {
  upiId: string
  payeeName: string
  /** Rupees. Always the registration's stored price, never user input. */
  amount: number
  /** Doubles as the transaction reference so the organiser can match the payment. */
  registrationCode: string
  eventTitle?: string
}

/** UPI apps truncate or reject notes much beyond this. */
const NOTE_MAX = 80

/**
 * Standard UPI deep link: `upi://pay?pa=&pn=&am=&cu=INR&tn=&tr=`.
 *
 * Pure so it can be unit tested. Every value is URL-encoded, the amount always
 * has two decimals (some apps reject `199`), and the registration code is kept
 * intact in the note even when a long event title has to be shortened.
 */
export function buildUpiLink({
  upiId,
  payeeName,
  amount,
  registrationCode,
  eventTitle = '',
}: UpiLinkInput): string {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new RangeError('A UPI payment needs an amount greater than zero.')

  const room = NOTE_MAX - registrationCode.length - 3
  const title = eventTitle.trim().slice(0, Math.max(0, room)).trim()
  const note = title ? `${title} - ${registrationCode}` : registrationCode

  const params: [string, string][] = [
    ['pa', upiId.trim()],
    ['pn', payeeName.trim()],
    ['am', amount.toFixed(2)],
    ['cu', 'INR'],
    ['tn', note],
    ['tr', registrationCode],
  ]
  return `upi://pay?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`
}
