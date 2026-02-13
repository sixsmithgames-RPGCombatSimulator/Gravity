import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
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

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
