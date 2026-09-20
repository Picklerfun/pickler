export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Toda respuesta de error es `{ error: code }` (D20). */
export function fail(status: number, code: string): Response {
  return json({ error: code }, status);
}

export function methodIs(req: Request, method: string): boolean {
  return req.method.toUpperCase() === method;
}

/** Prefijo corto para logs: nunca la dirección completa (D20). */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
