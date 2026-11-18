import { handleOrderRequest, methodNotAllowed } from './_lib/payments.js'
import { productionOrderDeps } from './_lib/runtime.js'

/**
 * POST /api/razorpay-order — create a Razorpay order for the caller's own
 * pending registration. The browser sends `Authorization: Bearer <ID token>`
 * and `{ registrationId }`; the amount is decided on the server.
 */
export async function POST(request: Request): Promise<Response> {
  return withAppCors(request, await handleOrderRequest(request, productionOrderDeps()))
}

/**
 * The Android app (Capacitor) serves its pages from `https://localhost`, so its
 * calls here are cross-origin. Only that origin is let in; the caller is still
 * identified by the Bearer token, never by cookies.
 */
const APP_ORIGIN = 'https://localhost'

function withAppCors(request: Request, response: Response): Response {
  if (request.headers.get('Origin') !== APP_ORIGIN) return response
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', APP_ORIGIN)
  headers.append('Vary', 'Origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function OPTIONS(request: Request): Response {
  if (request.headers.get('Origin') !== APP_ORIGIN) return methodNotAllowed()
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': APP_ORIGIN,
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    },
  })
}

// Every other method is refused explicitly.
export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
