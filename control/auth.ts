import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { equalSecret } from './security.js';

export class Auth {
  private sessions = new Map<string, { csrf: string; expires: number }>();
  private attempts = new Map<string, { count: number; since: number }>();
  constructor(private password: string) {
    if (password.length < 16)
      throw new Error('AEGIS_OPERATOR_PASSWORD must contain at least 16 characters');
  }
  login(password: unknown, peer: string) {
    const now = Date.now();
    const attempt = this.attempts.get(peer);
    if (attempt && now - attempt.since < 60000 && attempt.count >= 5)
      throw new Error('Login rate limit exceeded; wait one minute');
    this.attempts.set(peer, {
      count: attempt && now - attempt.since < 60000 ? attempt.count + 1 : 1,
      since: attempt && now - attempt.since < 60000 ? attempt.since : now,
    });
    if (!equalSecret(password, this.password)) throw new Error('Invalid operator credentials');
    for (const [id, session] of this.sessions) if (session.expires < now) this.sessions.delete(id);
    if (this.sessions.size >= 8) this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    this.sessions.set(id, { csrf, expires: now + 3600000 });
    return { id, csrf };
  }
  session(request: IncomingMessage, mutate = false) {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('aegis_session='))
      ?.slice('aegis_session='.length);
    const session = cookie ? this.sessions.get(cookie) : undefined;
    if (!session || session.expires < Date.now()) throw new Error('Operator sign-in required');
    if (mutate && !equalSecret(request.headers['x-csrf-token'], session.csrf))
      throw new Error('Invalid operator CSRF token');
    return session;
  }
  logout(request: IncomingMessage) {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('aegis_session='))
      ?.slice('aegis_session='.length);
    if (cookie) this.sessions.delete(cookie);
  }
}
