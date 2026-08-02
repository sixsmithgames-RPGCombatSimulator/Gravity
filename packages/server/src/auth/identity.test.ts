import { generateKeyPairSync } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';

import { createClerkJwtVerifier, readBearerToken } from './identity';

describe('Clerk JWT identity verification', () => {
  it('verifies issuer, signature, key id, and subject against JWKS', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const verifier = createClerkJwtVerifier({
      issuer: 'https://identity.example.test',
      authorizedParties: ['https://gravity.example.test/'],
      fetchImpl,
    });
    const token = jwt.sign({ name: 'Commander Vega', azp: 'https://gravity.example.test' }, privateKey, {
      algorithm: 'RS256',
      issuer: 'https://identity.example.test',
      subject: 'user_123',
      keyid: 'test-key',
      expiresIn: '5m',
    });

    await expect(verifier.verify(token)).resolves.toEqual({
      subject: 'user_123',
      displayName: 'Commander Vega',
    });
    await expect(verifier.verify(token)).resolves.toMatchObject({ subject: 'user_123' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a token signed by an untrusted key', async () => {
    const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = trusted.publicKey.export({ format: 'jwk' });
    const verifier = createClerkJwtVerifier({
      issuer: 'https://identity.example.test',
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'shared-key', use: 'sig' }] }), { status: 200 }),
      ),
    });
    const token = jwt.sign({}, attacker.privateKey, {
      algorithm: 'RS256',
      issuer: 'https://identity.example.test',
      subject: 'attacker',
      keyid: 'shared-key',
    });

    await expect(verifier.verify(token)).rejects.toThrow();
  });

  it('rejects a valid token issued for an unexpected application origin', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const verifier = createClerkJwtVerifier({
      issuer: 'https://identity.example.test',
      authorizedParties: ['https://gravity.example.test'],
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }), { status: 200 }),
      ),
    });
    const token = jwt.sign({ azp: 'https://compromised.example.test' }, privateKey, {
      algorithm: 'RS256',
      issuer: 'https://identity.example.test',
      subject: 'user_123',
      keyid: 'test-key',
      expiresIn: '5m',
    });

    await expect(verifier.verify(token)).rejects.toThrow('unauthorized application origin');
  });

  it('accepts only the Bearer authorization scheme', () => {
    expect(readBearerToken('Bearer signed-token')).toBe('signed-token');
    expect(readBearerToken('Basic signed-token')).toBeNull();
    expect(readBearerToken('Bearer   ')).toBeNull();
  });
});
