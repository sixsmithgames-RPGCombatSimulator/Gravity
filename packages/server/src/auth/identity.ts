import { createPublicKey, type JsonWebKey } from 'node:crypto';

import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';

export type AuthenticatedIdentity = {
  subject: string;
  displayName: string | null;
};

export interface IdentityVerifier {
  verify(token: string): Promise<AuthenticatedIdentity>;
}

type ClerkJwk = JsonWebKey & { kid?: string; use?: string };

type ClerkJwks = {
  keys: ClerkJwk[];
};

export type ClerkJwtVerifierOptions = {
  issuer: string;
  audience?: string;
  authorizedParties?: string[];
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
};

function requireHttpsIssuer(rawIssuer: string): string {
  const issuer = rawIssuer.trim().replace(/\/$/, '');
  const parsed = new URL(issuer);

  if (parsed.protocol !== 'https:') {
    throw new Error(
      'Cannot configure Clerk authentication because CLERK_ISSUER is not HTTPS. ' +
        `Root cause: issuer protocol is "${parsed.protocol}". ` +
        'Fix: Set CLERK_ISSUER to the HTTPS issuer shown in the Clerk dashboard.',
    );
  }

  return issuer;
}

function requireJwtSubject(
  payload: string | JwtPayload,
  authorizedParties: ReadonlySet<string>,
): AuthenticatedIdentity {
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
    throw new Error('The verified identity token does not contain a non-empty subject claim.');
  }

  if (authorizedParties.size > 0) {
    const authorizedParty = typeof payload.azp === 'string' ? payload.azp.trim().replace(/\/$/, '') : '';
    if (!authorizedParties.has(authorizedParty)) {
      throw new Error('The verified identity token was issued for an unauthorized application origin.');
    }
  }

  const displayNameClaims = [payload.name, payload.preferred_username, payload.given_name];
  const displayName = displayNameClaims.find(
    (claim): claim is string => typeof claim === 'string' && claim.trim() !== '',
  );

  return {
    subject: payload.sub.trim(),
    displayName: displayName?.trim() ?? null,
  };
}

/** Verify Clerk session tokens against the issuer JWKS with a bounded in-process key cache. */
export function createClerkJwtVerifier(options: ClerkJwtVerifierOptions): IdentityVerifier {
  const issuer = requireHttpsIssuer(options.issuer);
  const authorizedParties = new Set(
    (options.authorizedParties ?? []).map((party) => {
      const parsed = new URL(party.trim());
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Clerk authorized parties must use the HTTP or HTTPS protocol.');
      }
      return parsed.origin;
    }),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60_000;
  let cachedKeys: { expiresAt: number; keys: ClerkJwk[] } | null = null;

  async function getKeys(): Promise<ClerkJwk[]> {
    if (cachedKeys && cachedKeys.expiresAt > Date.now()) {
      return cachedKeys.keys;
    }

    const response = await fetchImpl(`${issuer}/.well-known/jwks.json`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Clerk JWKS request failed with HTTP ${response.status}.`);
    }

    const body = (await response.json()) as Partial<ClerkJwks>;
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error('Clerk JWKS response did not contain signing keys.');
    }

    cachedKeys = { expiresAt: Date.now() + cacheTtlMs, keys: body.keys };
    return body.keys;
  }

  return {
    async verify(token: string): Promise<AuthenticatedIdentity> {
      const decoded = jwt.decode(token, { complete: true });
      const header = decoded?.header as JwtHeader | undefined;
      if (!header?.kid) {
        throw new Error('Identity token header does not contain a signing-key id.');
      }

      const keys = await getKeys();
      const jwk = keys.find((candidate) => candidate.kid === header.kid);
      if (!jwk) {
        cachedKeys = null;
        const refreshedKeys = await getKeys();
        const refreshedJwk = refreshedKeys.find((candidate) => candidate.kid === header.kid);
        if (!refreshedJwk) {
          throw new Error('Identity token references an unknown Clerk signing key.');
        }
        const publicKey = createPublicKey({ key: refreshedJwk, format: 'jwk' });
        const payload = jwt.verify(token, publicKey, {
          algorithms: ['RS256'],
          issuer,
          audience: options.audience,
        });
        return requireJwtSubject(payload, authorizedParties);
      }

      const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
      const payload = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer,
        audience: options.audience,
      });
      return requireJwtSubject(payload, authorizedParties);
    },
  };
}

export function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token === '' ? null : token;
}
