// A tiny stand-in for the Supabase endpoints LTTV uses (auth + the lttv_profiles table), for tests.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

export function startMockSupabase(port = 0) {
  const users = new Map(); // email -> { id, email, password }
  const refresh = new Map(); // refresh token -> user id
  const access = new Map(); // access token -> user id
  const profiles = new Map(); // user id -> { data, updated_at }
  const byId = (id) => [...users.values()].find((u) => u.id === id);
  const session = (u) => {
    const a = 'at-' + randomUUID();
    const r = 'rt-' + randomUUID();
    access.set(a, u.id);
    refresh.set(r, u.id);
    return { access_token: a, refresh_token: r, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: u.id, email: u.email } };
  };
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    const json = (code, o) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = body ? JSON.parse(body) : {};
      if (u.pathname === '/auth/v1/signup') {
        if (users.has(b.email)) return json(422, { msg: 'User already registered' });
        if ((b.password ?? '').length < 6) return json(422, { msg: 'Password should be at least 6 characters' });
        const usr = { id: randomUUID(), email: b.email, password: b.password };
        users.set(b.email, usr);
        return json(200, session(usr));
      }
      if (u.pathname === '/auth/v1/token') {
        const g = u.searchParams.get('grant_type');
        if (g === 'password') {
          const usr = users.get(b.email);
          if (!usr || usr.password !== b.password) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
          return json(200, session(usr));
        }
        if (g === 'refresh_token') {
          const id = refresh.get(b.refresh_token);
          if (!id) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
          refresh.delete(b.refresh_token);
          return json(200, session(byId(id)));
        }
      }
      if (u.pathname === '/auth/v1/authorize') {
        // Pretend the user signed in with Google: come back with tokens in the fragment.
        const email = `${u.searchParams.get('provider')}-user@example.com`;
        let usr = users.get(email);
        if (!usr) { usr = { id: randomUUID(), email, password: randomUUID() }; users.set(email, usr); }
        const s = session(usr);
        res.writeHead(302, { Location: `${u.searchParams.get('redirect_to')}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer` });
        return res.end();
      }
      if (u.pathname === '/auth/v1/logout') return json(204, {});
      if (u.pathname === '/rest/v1/lttv_profiles') {
        const uid = access.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        if (!uid) return json(401, { message: 'JWT expired' });
        if (req.method === 'GET') {
          const want = (u.searchParams.get('user_id') ?? '').replace(/^eq\./, '');
          const p = want === uid ? profiles.get(uid) : undefined; // row level security
          return json(200, p ? [{ data: p.data, updated_at: p.updated_at }] : []);
        }
        if (req.method === 'POST') {
          if (b.user_id !== uid) return json(403, { message: 'new row violates row-level security policy' });
          profiles.set(uid, { data: b.data, updated_at: b.updated_at });
          res.writeHead(201, cors); return res.end();
        }
      }
      json(404, { message: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, users, profiles })));
}
