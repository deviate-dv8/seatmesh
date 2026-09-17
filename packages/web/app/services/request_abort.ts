/**
 * AbortSignal tied to the HTTP request lifetime.
 * When the client navigates away, Inertia aborts the XHR and Node closes the
 * connection — we abort in-flight daemon probes so they don't pile up.
 */
import type { HttpContext } from '@adonisjs/core/http'

export function requestAbortSignal(ctx: HttpContext): AbortSignal {
  const ac = new AbortController()
  const req = ctx.request.request
  const onClose = () => {
    if (!ac.signal.aborted) ac.abort()
  }
  req.on('close', onClose)
  req.on('aborted', onClose)
  // If already closed (race), abort immediately
  if (req.aborted || req.destroyed) ac.abort()
  return ac.signal
}
