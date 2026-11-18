import { handleWebhookRequest, methodNotAllowed } from './_lib/payments.js'
import { productionWebhookDeps } from './_lib/runtime.js'

/**
 * POST /api/razorpay-webhook — Razorpay's signed payment notifications. The raw
 * body is read as text and its signature verified before anything is parsed.
 */
export async function POST(request: Request): Promise<Response> {
  return handleWebhookRequest(request, productionWebhookDeps())
}

// Every other method is refused explicitly.
export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const OPTIONS = methodNotAllowed
