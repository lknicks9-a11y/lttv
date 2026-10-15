// Reads the Fire TV app's deferred /api/fetch responses (no browser globals, so it can be tested).

/**
 * The Fire TV app answers /api/fetch at once and connects in the background (so a slow server
 * can't freeze the app); the real status comes first in the body: "LTTV-STATUS <code> <length>\n".
 */
export async function undefer(body: ReadableStream<Uint8Array>): Promise<Response> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  let nl = -1;
  while (nl < 0) {
    const { value, done } = await reader.read();
    if (done) break;
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
    nl = buf.indexOf(10);
    if (buf.length > 256 && nl < 0) break;
  }
  const head = new TextDecoder().decode(buf.subarray(0, Math.max(0, nl)));
  const m = /^LTTV-STATUS (\d+) ?(\d*)/.exec(head);
  const status = m ? Number(m[1]) : 502;
  const rest = nl >= 0 ? buf.subarray(nl + 1) : new Uint8Array(0);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      if (rest.length) c.enqueue(rest);
    },
    async pull(c) {
      const { value, done } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const headers: Record<string, string> = {};
  if (m?.[2]) headers['x-upstream-length'] = m[2];
  if (status >= 400) headers['content-type'] = 'application/json';
  return new Response(stream, { status: status >= 200 && status <= 599 ? status : 502, headers });
}

