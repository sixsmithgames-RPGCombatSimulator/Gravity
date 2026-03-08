---
# Unlock Plan for Gravity App (Clerk-gated, purchases on main site)
---

## Purpose
Defines single source of truth for which game elements are free-core versus paid unlocks while the app redirects purchase flows to the main site. This document avoids in-app Stripe handling and supplies SKU/URL placeholders for future wiring.

## Current constraint
- The web app is a static Vite shell; there are no API routes, entitlement storage, or Stripe keys locally.
- Purchase CTAs should link to main-site checkout URLs (one per SKU) instead of creating Checkout Sessions in-app.

## Core vs Unlock delineation
### Captains
- Core: **Explorer** (supports free-core launch rule).
- Unlock: Merchant, Imperialist, Space Pirate, Technologist, Emissary (other captains listed in captain report).

### Ship designs
- Core: **Current default ship layout** (from `createInitialShip`).
- Unlock: Future alternate ship designs (not yet defined).

### Advanced crew (officers)
- Core: First Officer, Chief Engineer, Doctor, Senior Scientist.
- Unlock: Any additional advanced/officer roles beyond the four above.

### Basic crew
- Core: Pilot, Engineer, Medic, Scientist, Tactician (existing basic roles from mock data).
- Unlock: Future basic crew roles not in the list above.

### Upgrades
- Core: **All upgrades** listed in `upgrade-report-2026-01-23.md` are currently treated as core (no paid gating for upgrades at this stage).
- Unlock: None yet; future upgrade SKUs can be added if you later decide to gate specific cards.

## SKU/URL placeholders (redirect-only for now)
| Domain item | SKU (placeholder) | Main-site checkout URL (to be provided) | Notes |
| --- | --- | --- | --- |
| Captain bundle (all non-core captains) | `sku_captains_all` | `<main-site-url>/checkout/captains` | Grants Merchant, Imperialist, Space Pirate, Technologist, Emissary. |
| Upgrade bundle (all non-core upgrades) | `sku_upgrades_all` | `<main-site-url>/checkout/upgrades` | **Placeholder** only; currently unused because all upgrades are core. |
| Officer bundle (non-core officers, future) | `sku_officers_extra` | `<main-site-url>/checkout/officers` | For new officer roles beyond the four core roles. |
| Ship design bundle (future alt layouts) | `sku_ships_alt` | `<main-site-url>/checkout/ships` | Unlocks future ship layouts. |

## Integration guidance (future work)
1. **Client gating:** On load, fetch entitlements from main site (or Clerk metadata) and gate unlock buttons per SKU. Until then, render "Unlock" buttons that link to the main-site URLs above.
2. **Purchase flow:** Replace redirect-only URLs with a Clerk-authenticated checkout creation endpoint once server/API exists. Map SKUs above to Stripe Price IDs.
3. **Entitlement storage:** When server exists, store entitlements in a single source (DB or Clerk metadata) keyed by user ID; avoid duplicating state.
4. **Telemetry:** Log unlock clicks (SKU, user) to measure demand even before in-app checkout is live.

## Action items
- Provide actual main-site checkout URLs for each SKU placeholder.
- Decide if any upgrades should be included in core; update the core list accordingly.
- When server infrastructure arrives, replace redirects with an auth-verified checkout creation endpoint and entitlement fetch on load.
