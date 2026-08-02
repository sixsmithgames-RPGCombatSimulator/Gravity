export type IdentityAccess = {
  displayName: string;
  getToken: () => Promise<string>;
};

const E2E_TOKEN_KEY = 'gravity:e2e-auth-token';
const E2E_DISPLAY_NAME_KEY = 'gravity:e2e-display-name';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/** Build an identity accessor for the dedicated local browser-test harness only. */
export function createE2eIdentityAccess(): IdentityAccess {
  if (import.meta.env.VITE_E2E_AUTH_ENABLED !== 'true' || !LOCAL_HOSTNAMES.has(window.location.hostname)) {
    throw new Error('The test identity provider is disabled outside the local E2E harness.');
  }

  return {
    displayName: sessionStorage.getItem(E2E_DISPLAY_NAME_KEY)?.trim() || '',
    async getToken(): Promise<string> {
      const token = sessionStorage.getItem(E2E_TOKEN_KEY)?.trim();
      if (!token) {
        throw new Error('The browser test identity is missing. Restart the E2E journey.');
      }
      return token;
    },
  };
}
