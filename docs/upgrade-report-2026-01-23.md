# Gravity Upgrade Status Report — 2026-01-23

This report catalogs every core upgrade card, including thematic description, intended mechanical effect, implementation status, and source references.

## Legend
- **Effect (rules text)**: copy from `CardConfig`.
- **Mechanical implementation**: brief summary of how/where the effect is realized in code (or if still missing).
- **Status**: ✅ implemented, ⚠️ partial / needs work, ❌ not implemented.
- **Refs**: key files/sections to inspect.

---

### Med Lab Upgrades
| Upgrade | Card Description | Mechanical Effect(s) | Implementation Notes | Status | Key Refs |
| --- | --- | --- | --- | --- | --- |
| **Droid Station** | "Repurposing part of the Med Lab for droid repairs..." | Med-Lab can double repairs on all sections once per turn. | Engine `resolveRepairActions` tracks `useDroidStation`, enforces power + single-use, doubles multiplier when powered. UI shows toggle + effect summary. | ✅ | `CardConfig` lines 340-350; `engine/index.ts` lines 2390-2640; `ShipDashboard` lines 2340-2375, 5114-5135 |
| **Bio-Filters** | "Efficient devices... keep life support functioning." | +3 life support each upkeep when powered. | Auto-generation step adds +3 when upgrade powered; UI summary displays +3 when powered. | ✅ | `CardConfig` 352-360; `engine/index.ts` 8449-8456; `ShipDashboard` 3150-3225 & LS summary |
| **Cybernetics** | "Black market tech..." | Allows one crew to take an extra action per turn (+1 action). | Engine enforces second-action limits via `validateAndTrackCyberneticsActionLimits`; UI uses summary and ActionBar to highlight eligible crew. | ✅ | `CardConfig` 362-371; `engine/index.ts` 1703-1824; `ShipDashboard` 1669-1674, 2349-2355 |
| **Nano-Bots** | "Alien tech for tissue repair." | Doubles Med-Lab revive tokens (2× revive). | `resolveReviveActions` multiplies revive bonus when upgrade powered (see `getReviveBonus`). UI shows "x2 Revive" pill. | ✅ | `CardConfig` 495-504; `engine/index.ts` (revive logic) ~2160-2310; `ShipDashboard` 1669-1674 |
| **Bio-Engine** | "Hybrid engine aids life support." | +1 life support per turn. | Auto-generation adds +1 when powered; UI summary shows +1. | ✅ | `CardConfig` 528-536; `engine/index.ts` 8452-8456; `ShipDashboard` 3158-3234 |
| **Cybernetics / Temporal Shift (see Sci-Lab)** | share same implementation for +1 action. | | | | |

### Bridge Upgrades
| Upgrade | Description | Mechanical Effect(s) | Notes | Status | Refs |
| --- | --- | --- | --- | --- | --- |
| **Tactical Bridge** | "Bridge can Attack like Defense." | Allows Attack actions from Bridge (including while charging). | Engine `resolveAttackActions` allows attacks from Bridge when Tactical Bridge is powered; web UI range gating + preview now matches (Bridge attack section bonus when applicable). | ✅ | `CardConfig` 374-383; `engine/index.ts` attack resolver; `ShipDashboard` attack preview; `GameBoard` range gating |
| **Inertia Control** | "+1 Acceleration on Maneuver." | Adds +1 acceleration during Maneuver when powered. | Engine adds +1 in both preview and execution. | ✅ | `CardConfig` 385-393; `engine/index.ts` 4928-4934, 5206-5211 |
| **Neutron Calibrator** | "+1 Range" from Bridge. | +1 scan/acquire range when acting from Bridge; +1 attack roll. | Implemented in scan/attack preview + engine. | ✅ | `CardConfig` 396-404; `engine/index.ts` 5336-5651, 5436-5442; `ShipDashboard` 1678-1680, 5268-5685 |

### Sci-Lab Upgrades
| Upgrade | Description | Effect | Notes | Status | Refs |
| --- | --- | --- | --- | --- | --- |
| **Cloaking Device** | "Enemies must scan to attack you." | Intended: require attackers to scan first; scanning yields nothing. | Engine hostile resolution forces a “scan” turn per hostile+player before any adjacent attack/torpedo can deal damage (tracked in `hostilesScannedPlayerByObjectId`). | ✅ | `CardConfig` 406-415; `engine/index.ts` hostile resolution (`updateOrbitsAndObjects`) |
| **Tachyon Beam** | "Remove 1 adjacent hazard." | Sci-Lab action to clear hazard. | Engine `resolveScanActions` removes an adjacent hazard when scanning from Sci-Lab and Tachyon Beam is powered (spends 1 Sci-Lab power). UI range targeting reflects adjacency requirement for hazards. | ✅ | `CardConfig` 417-426; `engine/index.ts` scan resolver; `GameBoard` range gating |
| **Temporal Shift** | "+1 Action for one crew." | Shares Cybernetics logic (see Med Lab). | Implemented via extra action validation. | ✅ | `CardConfig` 440-448; `engine/index.ts` 1703-1824 |
| **Teleporter** | "Acquire costs 0 power." | Acquire action ignores power cost when upgrade powered. | Engine `resolveAcquireActions` checks teleporter, UI label shows "Acquire 0". | ✅ | `CardConfig` 561-569; `engine/index.ts` scan/acquire functions; `ShipDashboard` 1675-1677 |

### Engineering Upgrades
| Upgrade | Description | Effect | Notes | Status | Refs |
| --- | --- | --- | --- | --- | --- |
| **Repair Droids** | "Droids make fast repairs." | Engineering repairs doubled (x2). | Engine multiplier doubled when acting from Engineering & upgrade powered. | ✅ | `CardConfig` 451-459; `engine/index.ts` 2596-2603 |
| **Power Coils** | "1 conduit overload per turn." | Intended: ignore first conduit overload when routing power. | Engine ignores the first overload per turn when powered (tracked via `powerCoilsLastUsedTurn`) for both route actions and restore edge-load overload checks. | ✅ | `CardConfig` 473-481; `engine/index.ts` route/restore overload mitigation |
| **Coolant** | "+1 Power on Generate." | Generate action adds +1 power when upgrade powered. | Implemented in generate resolver (power restoration). | ✅ | `CardConfig` 484-492; `engine/index.ts` restore/generate sections |
| **Living Metal** | "Add 2 Hull per turn anywhere." | Auto-hull growth each upkeep. | Engine applies via `applyLivingMetalHullGrowth`. | ✅ | `CardConfig` 539-547; `engine/index.ts` 8421-8425 |

### Defense Upgrades
| Upgrade | Description | Effect | Notes | Status | Refs |
| --- | --- | --- | --- | --- | --- |
| **Decoys** | "Evade 1 torpedo per turn." | Should cancel one incoming torpedo. | Engine hostile resolution consumes a hostile torpedo without dealing damage once per turn when powered (tracked via `decoysLastUsedTurn`). | ✅ | `CardConfig` 462-470; `engine/index.ts` hostile resolution (`updateOrbitsAndObjects`) |
| **Shield Modulator** | "Half shield damage." | Intended: reduce shield loss from attacks. | Engine halves shield loss (ceil(shieldAbsorb/2)) from hostile attacks/torpedoes when powered. | ✅ | `CardConfig` 572-580; `engine/index.ts` `applyIncomingWeaponDamageToPlayer` |
| **A.I. Defense** | "Free Scan of attack target." | Attacks mark hostile as scanned for +2 next attack. | Engine attack resolver, UI short effect implemented; when powered, target becomes scanned. | ✅ | `CardConfig` 583-592; `engine/index.ts` attack logic (around 6000+); `ShipDashboard` 1690-1693 |

### Drives Upgrades
| Upgrade | Description | Effect | Notes | Status | Refs |
| --- | --- | --- | --- | --- | --- |
| **Plasma Engine** | "Gain 1 Power on Maneuver." | After Maneuver, +1 power to Drives. | Implemented in Maneuver resolution. | ✅ | `CardConfig` 517-525; `engine/index.ts` 4895-4934 |
| **Bio-Engine** | Already covered (life support). | | | ✅ | See Med Lab table |
| **Ion Engine** | "+1 Acceleration on Maneuver." | Adds +1 acceleration when powered. | Implemented along with Inertia Control. | ✅ | `CardConfig` 550-558; `engine/index.ts` 4928-4934, 5209-5212 |

### Any-Section Upgrades
| Upgrade | Description | Effect | Notes | Status | Refs |
| --- | --- | --- | --- | --- | --- |
| **High Density Plates** | "Half hull damage from environment." | Should reduce environment hull damage taken. | Engine halves environment hull damage while powered (applies before section damage distribution). | ✅ | `CardConfig` 429-437; `engine/index.ts` environment damage |
| **Energy Hull** | "Add 1 Hull per turn (this section)." | Section with upgrade gains +1 hull each upkeep. | Engine `applyAutoGenerate` heals +1 hull per turn on the installed section while powered. | ✅ | `CardConfig` 506-514; `engine/index.ts` `applyAutoGenerate` |

### Summary
- Implemented upgrades: Droid Station, Bio-Filters, Cybernetics, Nano-Bots, Bio-Engine, Tactical Bridge, Inertia Control, Neutron Calibrator, Cloaking Device, Tachyon Beam, Temporal Shift, Teleporter, Repair Droids, Power Coils, Coolant, Living Metal, Decoys, Shield Modulator, A.I. Defense, Plasma Engine, Ion Engine, High Density Plates, Energy Hull.
- Missing/partial implementations: None listed in this report.

Please review missing upgrades for prioritization. Implementation typically requires:
1. Engine logic (action validation/action resolution or upkeep adjustments).
2. UI affordances (tooltips, toggles, planner hints) in `ShipDashboard`/`GameBoard`.
3. Tests covering new behavior (e.g., `engine/*.test.ts`).

Generated by Cascade on 2026-01-23.
