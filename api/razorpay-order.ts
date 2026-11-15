import { handleOrderRequest, methodNotAllowed } from './_lib/payments.js'
import { productionOrderDeps } from './_lib/runtime.js'

/**
 * POST /api/razorpay-order — create a Razorpay order for the caller's own
 * pending registration. The browser sends `Authorization: Bearer <ID token>`
 * and `{ registrationId }`; the amount is decided on the server.
 */
export async function POST(request: Request): Promise<Response> {
  return handleOrderRequest(request, productionOrderDeps())
}

// Every other method is refused explicitly.
export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
export const OPTIONS = methodNotAllowed
