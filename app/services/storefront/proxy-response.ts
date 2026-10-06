// Responses of the app proxy routes (no Shopify imports, so query helpers can use them too).

export function json(
  body: unknown,
  status = 200,
  maxAge = 0,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Per shopper only; short, so imports and edits show up quickly.
      "Cache-Control": maxAge ? `private, max-age=${maxAge}` : "no-store",
      ...headers,
    },
  });
}

/** A Liquid page Shopify renders inside the shop's theme layout. */
export function liquidPage(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/liquid",
      "Cache-Control": "no-store",
    },
  });
}
