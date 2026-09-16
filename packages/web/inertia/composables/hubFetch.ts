/** Hub POST helper — bypasses Inertia so parallel ops don't cancel each other. */

function xsrfToken(): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

export async function hubPostJson<T>(
  url: string,
  body: Record<string, unknown> = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-XSRF-TOKEN': xsrfToken(),
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: JSON.stringify(body),
  })
  let data: T
  try {
    data = (await res.json()) as T
  } catch {
    data = {} as T
  }
  return { ok: res.ok, status: res.status, data }
}
