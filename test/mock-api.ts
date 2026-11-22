export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export type Reply = ((req: RecordedRequest) => unknown) | object;

/**
 * A fake Ladoo API. Routes are "METHOD /path/{param}" templates; a reply is a JSON body,
 * a function returning one, or a full Response.
 */
export function mockApi(routes: Record<string, Reply>) {
  const requests: RecordedRequest[] = [];
  const matchers = Object.entries(routes).map(([key, reply]) => {
    const [method, template] = key.split(" ") as [string, string];
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return { method, pattern, reply };
  });

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const req: RecordedRequest = {
      method: init?.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    requests.push(req);
    const route = matchers.find((m) => m.method === req.method && m.pattern.test(req.path));
    if (!route)
      return jsonResponse(404, { error: { code: "not_found", message: `No mock for ${req.method} ${req.path}` } });
    const value = typeof route.reply === "function" ? route.reply(req) : route.reply;
    return value instanceof Response ? value : jsonResponse(200, value);
  };

  return { fetch, requests };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
