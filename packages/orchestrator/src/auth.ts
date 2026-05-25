import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const COOKIE_NAME = 'sentinel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

interface SessionPayload {
  iat: number;
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encode(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function decode(token: string, secret: string): SessionPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = sign(body, secret);
  const actualBuf = Buffer.from(signature, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function registerAuth(
  app: FastifyInstance,
  config: { sessionSecret: string; demoPassword: string },
): void {
  app.post<{ Body: { password: string } }>('/api/auth/login', async (request, reply) => {
    const { password } = request.body ?? {};
    if (typeof password !== 'string' || password.length === 0) {
      return reply.code(400).send({ error: 'password required' });
    }
    const expectedBuf = Buffer.from(config.demoPassword);
    const providedBuf = Buffer.from(password);
    const equalLength = expectedBuf.length === providedBuf.length;
    const passwordMatches = equalLength && timingSafeEqual(expectedBuf, providedBuf);
    if (!passwordMatches) {
      return reply.code(401).send({ error: 'invalid password' });
    }
    const now = Date.now();
    const token = encode({ iat: now, exp: now + SESSION_TTL_MS }, config.sessionSecret);
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // flip to true behind HTTPS in prod
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}

export function requireSession(secret: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies?.[COOKIE_NAME];
    if (!token) {
      return reply.code(401).send({ error: 'authentication required' });
    }
    const payload = decode(token, secret);
    if (!payload) {
      return reply.code(401).send({ error: 'invalid or expired session' });
    }
  };
}
