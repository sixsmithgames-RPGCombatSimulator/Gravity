import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App';
import { AuthBoundary } from './components/auth/AuthBoundary';
import { createE2eIdentityAccess } from './session/auth';
import './index.css';

/**
 * Application entry point
 * Purpose: Mount React application to DOM
 */
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error(
    'Failed to mount application because root element not found. ' +
    'Root cause: No element with id="root" exists in index.html. ' +
    'Fix: Ensure index.html contains <div id="root"></div>.'
  );
}

const isE2eHarness = import.meta.env.VITE_E2E_AUTH_ENABLED === 'true';
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();

if (!isE2eHarness && !publishableKey) {
  throw new Error(
    'VITE_CLERK_PUBLISHABLE_KEY is required. Copy packages/web/.env.example to .env.local and add the Clerk publishable key.',
  );
}

const application = isE2eHarness ? (
  <App identity={createE2eIdentityAccess()} />
) : (
  <ClerkProvider publishableKey={publishableKey!} afterSignOutUrl="/">
    <AuthBoundary />
  </ClerkProvider>
);

ReactDOM.createRoot(rootElement).render(<React.StrictMode>{application}</React.StrictMode>);
