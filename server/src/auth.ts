// Authentication: email + password accounts (bcrypt hashes) kept server-side in
// config/users.json or the USERS_JSON env var, and a signed httpOnly session cookie.
// Roles are re-read on every request, so removing a user or changing a role is
// effective immediately.
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { Role, ROLES } from '../../shared/schema';
import type { AppConfig } from './config';

export interface UserRecord {
  email: string;
  name: string;
  role: Role;
  passwordHash: string;
  disabled?: boolean;
}

export interface SessionUser {
  email: string;
  name: string;
  role: Role;
  dev?: boolean;
  /** Anonymous visitor in open-access mode (client view, no session). */
  public?: boolean;
}

/** The identity given to anyone who has not signed in when open access is on. */
export const PUBLIC_VISITOR: SessionUser = { email: 'public', name: 'Visitor', role: 'client', public: true };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const COOKIE = 'sunpm_session';
// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export class UserDirectory {
  private cache: { mtime: number; users: UserRecord[] } | null = null;
  constructor(private cfg: Pick<AppConfig, 'usersFile' | 'usersJson'>) {}

  list(): UserRecord[] {
    if (this.cfg.usersJson) return this.validate(JSON.parse(cleanPastedJson(this.cfg.usersJson)));
    if (!fs.existsSync(this.cfg.usersFile)) return [];
    const mtime = fs.statSync(this.cfg.usersFile).mtimeMs;
    if (!this.cache || this.cache.mtime !== mtime) {
      this.cache = { mtime, users: this.validate(JSON.parse(fs.readFileSync(this.cfg.usersFile, 'utf8'))) };
    }
    return this.cache.users;
  }

  private validate(raw: unknown): UserRecord[] {
    if (!Array.isArray(raw)) throw new Error('Users config must be a JSON array');
    return raw
      .filter((u: any) => u && typeof u.email === 'string' && ROLES.includes(u.role) && typeof u.passwordHash === 'string')
      .map((u: any) => ({ ...u, email: u.email.toLowerCase().trim() }));
  }

  find(email: string): UserRecord | undefined {
    return this.list().find(u => u.email === email.toLowerCase().trim() && !u.disabled);
  }

  async verify(email: string, password: string): Promise<UserRecord | null> {
    const u = this.find(email);
    const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
    return u && ok ? u : null;
  }
}

/**
 * USERS_JSON is usually copied from a terminal into a hosting dashboard. That can add
 * line breaks where the terminal wrapped the line, surrounding quotes, or a leading
 * "USERS_JSON=". None of these can occur in valid account data (emails, names and
 * bcrypt hashes contain no line breaks), so they are removed before parsing.
 */
export function cleanPastedJson(raw: string): string {
  let s = raw.replace(/[\r\n]+/g, '').trim();
  s = s.replace(/^USERS_JSON\s*=\s*/i, '').trim();
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"') && !s.startsWith('"[')))
    s = s.slice(1, -1).trim();
  if (s.startsWith('"[')) s = JSON.parse(s); // JSON-encoded string containing the array
  return s;
}

/** Non-sensitive description of why USERS_JSON failed to parse (shape only, never content). */
export function describeUsersJson(raw: string | undefined | null): string {
  if (!raw) return 'not set';
  const s = raw.trim();
  return `length ${s.length}, first character "${s[0] ?? ''}", last character "${s[s.length - 1] ?? ''}", ${(raw.match(/\n/g) ?? []).length} line break(s)`;
}

export function issueSession(res: Response, user: SessionUser, cfg: AppConfig) {
  const token = jwt.sign({ sub: user.email, name: user.name, role: user.role, dev: user.dev || undefined }, cfg.jwtSecret, {
    expiresIn: `${cfg.sessionHours}h`,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.cookieSecure,
    maxAge: cfg.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response, cfg: AppConfig) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/' });
}

export function authenticate(cfg: AppConfig, users: UserDirectory) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[COOKIE];
    if (token) {
      try {
        const p = jwt.verify(token, cfg.jwtSecret) as jwt.JwtPayload;
        if (p.dev) {
          if (cfg.allowDevLogin && ROLES.includes(p.role)) req.user = { email: String(p.sub), name: String(p.name), role: p.role, dev: true };
        } else {
          const u = users.find(String(p.sub));
          if (u) req.user = { email: u.email, name: u.name, role: u.role }; // role from directory, not token
        }
      } catch {
        /* invalid or expired token → anonymous */
      }
    }
    // Open access: anyone not signed in is a read-only visitor with the client view.
    if (!req.user && cfg.publicAccess) req.user = PUBLIC_VISITOR;
    next();
  };
}

export function requireRole(min: Role) {
  const rank: Record<Role, number> = { client: 0, editor: 1, admin: 2 };
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' });
    if (rank[req.user.role] < rank[min]) return res.status(403).json({ error: 'You do not have permission for this action' });
    next();
  };
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
