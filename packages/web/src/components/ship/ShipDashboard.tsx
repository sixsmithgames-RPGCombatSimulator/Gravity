import {
  useGameStore,
  computeLifeSupportCapacity,
  countLifeSupportConsumersWithRevives,
} from '../../store/gameStore';
import type { PlayerDiff, SectionDiff } from '../../store/gameStore';
import {
  applyPlayerActions,
  BoardUtils,
  SHIP_SECTIONS,
  ShipUtils,
  POWER_CONFIG,
  LIFE_SUPPORT_CONFIG,
  SHIP_CONNECTION_LAYOUT,
  DEFAULT_POWER_ROUTING_HUB_SECTION,
  CREW_CONFIG,
  CrewUtils,
  computeEnvironmentDamageForPosition,
  computeHazardDamageForPosition,
  previewManeuver,
  SECTION_CONFIG as CORE_SECTION_CONFIG,
  HAZARD_CONFIG,
} from '@gravity/core';
import type {
  Board,
  ShipSection,
  ShipSectionState,
  AnyCrew,
  Captain,
  Ship,
  PlayerActionTarget,
  UpgradeCard,
  PlayerAction,
  PlayerResources,
  ResourceType,
} from '@gravity/core';
import { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

/**
 * ShipDashboard component
 * Purpose: Display complete ship status including sections, crew, and resources
 *
 * Layout based on reference image 2:
 * - Crew slots at top with life support indicators
 * - 6 ship sections in grid layout
 * - Resources below sections
 * - Shield tracker on right
 */

/** Section display config */
const SECTION_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  [SHIP_SECTIONS.MED_LAB]: { label: 'MEDICAL LAB', color: 'section-med-lab', bgColor: 'bg-yellow-900/30' },
  [SHIP_SECTIONS.BRIDGE]: { label: 'BRIDGE', color: 'section-bridge', bgColor: 'bg-blue-900/30' },
  [SHIP_SECTIONS.SCI_LAB]: { label: 'SCIENCE LAB', color: 'section-sci-lab', bgColor: 'bg-green-900/30' },
  [SHIP_SECTIONS.DRIVES]: { label: 'DRIVE', color: 'section-drive', bgColor: 'bg-blue-900/20' },
  [SHIP_SECTIONS.ENGINEERING]: { label: 'ENGINEERING', color: 'section-engineering', bgColor: 'bg-orange-900/30' },
  [SHIP_SECTIONS.DEFENSE]: { label: 'DEFENSE', color: 'section-defense', bgColor: 'bg-red-900/30' },
};

const CREW_ROLE_COLORS: Record<string, string> = {
  ace_pilot: 'bg-crew-pilot',
  chief_engineer: 'bg-crew-engineer',
  doctor: 'bg-crew-medic',
  senior_scientist: 'bg-crew-scientist',
  master_tactician: 'bg-crew-tactician',
  first_officer: 'bg-crew-officer',

  pilot: 'bg-crew-pilot',
  engineer: 'bg-crew-engineer',
  medic: 'bg-crew-medic',
  scientist: 'bg-crew-scientist',
  tactician: 'bg-crew-tactician',

  captain: 'bg-crew-captain',
  merchant: 'bg-crew-captain',
  imperialist: 'bg-crew-captain',
  space_pirate: 'bg-crew-captain',
  technologist: 'bg-crew-captain',
  emissary: 'bg-crew-captain',
  explorer: 'bg-crew-captain',
};

const UPGRADE_MECHANICS_SUMMARY: Record<string, string> = {
  repair_droids: 'Repairs from Engineering are doubled.',
  droid_station: 'Repairs from Med-Lab are doubled.',
  coolant: 'Restore from Engineering generates +1 power.',
  nano_bots: 'Revive points are doubled.',
  teleporter: 'Acquire from Sci-Lab costs 0 power.',
  neutron_calibrator: 'Scan/Acquire from Bridge gain +1 range.',
  inertia_control: 'Maneuver acceleration +1.',
  ion_engine: 'Maneuver acceleration +1.',
  plasma_engine: 'After Maneuver, gain +1 power in Drives.',
  bio_engine: 'Gain +1 life support each turn.',
  bio_filters: 'Gain +3 life support each turn.',
  high_density_plates: 'Environment hull damage is halved.',
  ai_defense: 'Attacks mark hostiles as scanned (+2 on next attack).',
};

function getUpgradeMechanicsSummary(upgradeId: string): string | null {
  return UPGRADE_MECHANICS_SUMMARY[upgradeId] ?? null;
}

const VALID_SECTIONS_SET = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);

type HazardContributor = { id: string; ring: number; space: number; distance: number };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getUpgradePowerStatus(upgrade: UpgradeCard, ship: Ship): {
  section: ShipSection | null;
  upgradePowerRequired: number;
  storedPower: number;
  basePowerRequired: number;
  totalPowerRequired: number;
  totalPowerInSection: number;
  isPowered: boolean;
} {
  const powerRequiredRaw = (upgrade as { powerRequired?: unknown }).powerRequired;
  const upgradePowerRequired =
    typeof powerRequiredRaw === 'number' && Number.isFinite(powerRequiredRaw) && powerRequiredRaw > 0
      ? powerRequiredRaw
      : 0;

  const storedPowerRaw = (upgrade as { storedPower?: unknown }).storedPower;
  const storedPower =
    typeof storedPowerRaw === 'number' && Number.isFinite(storedPowerRaw) && storedPowerRaw > 0
      ? storedPowerRaw
      : 0;

  const sectionRaw = (upgrade as { section?: unknown }).section;
  const section = typeof sectionRaw === 'string' && VALID_SECTIONS_SET.has(sectionRaw as ShipSection)
    ? (sectionRaw as ShipSection)
    : null;

  if (!section) {
    return {
      section: null,
      upgradePowerRequired,
      storedPower,
      basePowerRequired: 0,
      totalPowerRequired: upgradePowerRequired,
      totalPowerInSection: 0,
      isPowered: upgradePowerRequired <= 0,
    };
  }

  const sectionState = ship.sections[section];
  const totalPowerInSection = sectionState ? sectionState.powerDice.reduce((sum, die) => sum + die, 0) : 0;

  const baseRequiredRaw = (CORE_SECTION_CONFIG[section] as any)?.powerRequired as unknown;
  const basePowerRequired =
    typeof baseRequiredRaw === 'number' && Number.isFinite(baseRequiredRaw) && baseRequiredRaw > 0
      ? baseRequiredRaw
      : 0;

  const totalPowerRequired = basePowerRequired;

  const hasConduitConnection = sectionState
    ? Object.values(sectionState.conduitConnections ?? {}).some((count) => (count ?? 0) > 0)
    : false;

  const isPowered =
    upgradePowerRequired <= 0 ||
    (!!sectionState &&
      sectionState.hull > 0 &&
      hasConduitConnection &&
      totalPowerInSection >= basePowerRequired &&
      storedPower >= upgradePowerRequired);

  return {
    section,
    upgradePowerRequired,
    storedPower,
    basePowerRequired,
    totalPowerRequired,
    totalPowerInSection,
    isPowered,
  };
}

function ShipStatusMeters({
  shields,
  maxShields,
  speed,
  maxSpeed,
  speedRequirement,
}: {
  shields: number;
  maxShields: number;
  speed: number;
  maxSpeed: number;
  speedRequirement: number | null;
}) {
  const clamp = (value: number, max: number) => {
    if (!(typeof value === 'number' && Number.isFinite(value))) {
      return 0;
    }
    if (value < 0) {
      return 0;
    }
    return value > max ? max : value;
  };

  const safeShields = clamp(shields, maxShields);
  const safeSpeed = clamp(speed, maxSpeed);

  const toPercent = (value: number, max: number) => {
    if (!(typeof max === 'number' && Number.isFinite(max)) || max <= 0) {
      return 0;
    }
    const pct = (value / max) * 100;
    if (pct < 0) {
      return 0;
    }
    if (pct > 100) {
      return 100;
    }
    return pct;
  };

  const Meter = ({
    label,
    value,
    max,
    marker,
    fillClass,
    markerClass,
    statusLabel,
    statusClass,
  }: {
    label: string;
    value: number;
    max: number;
    marker?: number | null;
    fillClass: string;
    markerClass?: string;
    statusLabel?: string | null;
    statusClass?: string;
  }) => (
    <div className="w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[11px] font-bold tracking-wide text-gravity-muted shrink-0">
            {label}
          </div>
          {statusLabel && (
            <span
              className={`px-2 py-0.5 rounded border text-[11px] font-semibold shrink-0 ${
                statusClass ?? 'border-slate-600/60 bg-slate-950/25 text-slate-200'
              }`}
              title={statusLabel}
            >
              {statusLabel}
            </span>
          )}
        </div>
        <div className="text-right text-[11px] font-semibold tabular-nums text-slate-100 shrink-0">
          {value}/{max}
          {typeof marker === 'number' && Number.isFinite(marker) && marker > 0 ? ` • REQ ${marker}` : ''}
        </div>
      </div>

      <div className="mt-1 relative">
        <div className="relative h-4 rounded-md border border-slate-700/70 bg-slate-950/25 overflow-hidden">
          <div
            className="absolute inset-0 z-0"
            style={{
              background:
                'repeating-linear-gradient(90deg, rgba(148,163,184,0.10) 0px, rgba(148,163,184,0.10) 1px, rgba(0,0,0,0) 6px, rgba(0,0,0,0) 10px)',
            }}
          />
          <div
            className={`absolute left-0 top-0 z-10 h-full ${fillClass}`}
            style={{ width: `${toPercent(value, max)}%` }}
          />
          {typeof marker === 'number' && Number.isFinite(marker) && marker > 0 && (
            <div
              className={`absolute top-0 z-20 h-full w-[2px] ${markerClass ?? 'bg-amber-300/80'}`}
              style={{ left: `calc(${toPercent(marker, max)}% - 1px)` }}
              title={`Requirement: ${marker}/${max}`}
            />
          )}
        </div>
      </div>
    </div>
  );

  const speedOk =
    typeof speedRequirement === 'number' && Number.isFinite(speedRequirement)
      ? safeSpeed >= speedRequirement
      : null;

  const speedStatus = speedOk === null ? null : speedOk ? 'OK' : 'LOW';

  const speedStatusClass =
    speedOk === null
      ? 'border-slate-600/60 bg-slate-950/25 text-slate-200'
      : speedOk
        ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200'
        : 'border-amber-400/50 bg-amber-950/30 text-amber-200';

  return (
    <div className="w-full flex flex-col gap-3">
      <Meter
        label="SHIELDS"
        value={safeShields}
        max={maxShields}
        fillClass="bg-gradient-to-r from-sky-500/30 via-sky-400/35 to-sky-300/40 shadow-[0_0_10px_rgba(56,189,248,0.18)]"
      />
      <Meter
        label="SPEED"
        value={safeSpeed}
        max={maxSpeed}
        marker={speedRequirement}
        markerClass="bg-amber-300/90"
        fillClass="bg-gradient-to-r from-emerald-500/20 via-emerald-400/25 to-emerald-300/30 shadow-[0_0_10px_rgba(52,211,153,0.14)]"
        statusLabel={speedStatus}
        statusClass={speedStatusClass}
      />
    </div>
  );
}

function getCrewRole(crew: AnyCrew | Captain): string {
  if ('captainType' in crew) {
    return crew.captainType;
  }
  if ('role' in crew) {
    return crew.role;
  }
  return 'officer';
}

function getCrewAbbrev(role: string): string {
  switch (role) {
    case 'captain':
      return 'CAP';
    case 'first_officer':
      return '1OFF';
    case 'pilot':
      return 'PIL';
    case 'engineer':
      return 'ENG';
    case 'medic':
      return 'MED';
    case 'scientist':
      return 'SCI';
    case 'tactician':
      return 'TAC';
    case 'ace_pilot':
      return 'ACE';
    case 'chief_engineer':
      return 'CHE';
    case 'doctor':
      return 'DOC';
    case 'senior_scientist':
      return 'SNR';
    case 'master_tactician':
      return 'MTA';
    case 'android':
      return 'AND';
    case 'mission_specialist':
      return 'MSP';
    default:
      return role.substring(0, 4).toUpperCase();
  }
}

function getFixedRollRoleForPreview(crew: AnyCrew | Captain): string {
  const role = (crew as { role?: unknown }).role;
  return typeof role === 'string' ? role : 'unknown';
}

function getFixedReviveRollValueForPreview(crew: AnyCrew | Captain): number {
  if ('captainType' in crew) {
    return 6;
  }
  const role = getFixedRollRoleForPreview(crew);
  if (role === 'medic' || role === 'doctor' || role === 'first_officer') {
    return 6;
  }
  return 3;
}

function getFixedAssembleRollValueForPreview(crew: AnyCrew | Captain, itemType: string): number {
  if ('captainType' in crew) {
    if (itemType === 'medical_kit' || itemType === 'probe') {
      return 6;
    }
    return 3;
  }
  const role = getFixedRollRoleForPreview(crew);
  if (itemType === 'medical_kit') {
    return role === 'medic' || role === 'doctor' ? 6 : 3;
  }
  if (itemType === 'probe') {
    return role === 'scientist' || role === 'senior_scientist' ? 6 : 3;
  }
  if (itemType === 'spare_parts') {
    return role === 'engineer' || role === 'chief_engineer' ? 6 : 3;
  }
  if (itemType === 'torpedo') {
    return role === 'tactician' || role === 'master_tactician' ? 6 : 3;
  }
  return 3;
}

function getFixedDiscoveryRollValueForPreview(crew: AnyCrew | Captain): number {
  const role = getFixedRollRoleForPreview(crew);
  if (role === 'senior_scientist') {
    return 6;
  }
  if (role === 'scientist') {
    return 4;
  }
  return 3;
}

function getFixedAttackRollValuesForPreview(): [number, number] {
  return [3, 3];
}

// Crew_Bonus: UI preview mirror of engine getScanRangeBonus; keep section/location checks identical.
function getScanRangeBonusForPreview(crew: AnyCrew | Captain): number {
  if (crew.type === 'basic' && crew.role === 'scientist' && crew.location === SHIP_SECTIONS.SCI_LAB) {
    return 1;
  }

  if (
    crew.type === 'officer' &&
    crew.role === 'senior_scientist' &&
    (crew.location === SHIP_SECTIONS.BRIDGE || crew.location === SHIP_SECTIONS.SCI_LAB)
  ) {
    return 2;
  }

  if ('captainType' in crew && crew.location === SHIP_SECTIONS.SCI_LAB) {
    return 1;
  }

  return 0;
}

// Crew_Bonus: UI preview mirror of engine getReviveBonus; relies on CrewUtils bonuses.
function getCrewReviveBonusForPreview(crew: AnyCrew | Captain): number {
  const bonuses = CrewUtils.getBonuses(crew);
  const reviveBonus = bonuses.reviveBonus;
  if (typeof reviveBonus !== 'number' || !Number.isFinite(reviveBonus)) {
    return 0;
  }

  return reviveBonus;
}

// Crew_Bonus: UI preview mirror of engine getRestorePowerBonus; keep role bonuses identical to engine source.
// Restore_Power: UI preview mirror of engine getRestorePowerBonus; keep role bonuses identical to engine source.
function getCrewRestorePowerBonusForPreview(crew: AnyCrew | Captain): number {
  const bonuses = CrewUtils.getBonuses(crew);
  const value = bonuses.powerGeneration;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

// Crew_Bonus: UI preview for Defense shield bonus (tactician roles) mirroring engine getRestoreShieldBonus.
// Restore_Power: UI preview for Defense shield bonus (tactician roles) mirroring engine getRestoreShieldBonus.
function getCrewRestoreShieldBonusForPreview(crew: AnyCrew | Captain): number {
  const bonuses = CrewUtils.getBonuses(crew);
  const value = bonuses.shieldGeneration;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

// Crew_Bonus: UI preview mirror of engine getAttackDamageBonus; ensures tactical bonuses match combat resolution.
function getCrewAttackDamageBonusForPreview(crew: AnyCrew | Captain): number {
  const bonuses = CrewUtils.getBonuses(crew);
  const value = bonuses.damageBonus;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return value;
}

// Crew_Bonus: UI preview mirror of engine getRepairMultiplier; matches Engineer/Captain behavior.
function getCrewRepairMultiplierForPreview(crew: AnyCrew | Captain): number {
  const bonuses = CrewUtils.getBonuses(crew);
  const value = bonuses.repairMultiplier;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return value;
}

// Crew_Bonus: UI preview mirror of engine getAssembleBonus; maintains per-item role modifiers.
function getCrewAssembleBonusForPreview(crew: AnyCrew | Captain, itemType: string): number {
  const bonuses = CrewUtils.getBonuses(crew);
  const value = bonuses.assembleBonus;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  if (crew.type === 'basic' && crew.role === 'medic' && itemType === 'medical_kit') {
    return value;
  }
  if (crew.type === 'basic' && crew.role === 'scientist' && itemType === 'probe') {
    return value;
  }
  if (crew.type === 'officer' && crew.role === 'doctor' && itemType === 'medical_kit') {
    return value;
  }
  if (crew.type === 'officer' && crew.role === 'senior_scientist' && itemType === 'probe') {
    return value;
  }

  return 0;
}

function getMedLabReviveBonusForPreview(ship: Ship, powerSpentBeforeThisAction: number): number {
  const medLabState = ship.sections[SHIP_SECTIONS.MED_LAB];
  if (!medLabState) {
    return 0;
  }

  const hasConduitConnection = Object.values(medLabState.conduitConnections ?? {}).some(
    (count) => (count ?? 0) > 0,
  );

  if (medLabState.hull <= 0 || !hasConduitConnection) {
    return 0;
  }

  const requiredPower = CORE_SECTION_CONFIG[SHIP_SECTIONS.MED_LAB]?.powerRequired ?? 0;
  if (typeof requiredPower !== 'number' || !Number.isFinite(requiredPower) || requiredPower <= 0) {
    return 0;
  }

  const totalPower = medLabState.powerDice.reduce((sum, die) => sum + die, 0);
  const totalBeforeThisActionCost = totalPower - powerSpentBeforeThisAction;

  return totalBeforeThisActionCost >= requiredPower ? 2 : 0;
}

function formatSignedNumberForTooltip(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return '0';
  }
  return value > 0 ? `+${value}` : `${value}`;
}

function buildCrewTokenTooltipTitle({
  crew,
  role,
  showAssembleProgress,
  displayAssembleItemType,
  displayAssembleProgress,
}: {
  crew: AnyCrew | Captain;
  role: string;
  showAssembleProgress: boolean;
  displayAssembleItemType: string | null;
  displayAssembleProgress: number;
}): string {
  const locationRaw = (crew as { location?: unknown }).location;
  const locationLabel = typeof locationRaw === 'string' ? locationRaw : '—';

  const statusRaw = (crew as { status?: unknown }).status;
  const statusLabel = typeof statusRaw === 'string' ? statusRaw : '—';

  const lines: string[] = [];

  lines.push(`${crew.name} (${crew.type}:${role})`);
  lines.push(`Location: ${locationLabel}`);
  lines.push(`Status: ${statusLabel}`);

  if (showAssembleProgress && displayAssembleItemType) {
    lines.push(
      `Assemble: ${displayAssembleItemType} (${displayAssembleProgress}/${CREW_CONFIG.ASSEMBLE_THRESHOLD})`,
    );
  }

  lines.push('');
  lines.push('Bonuses');

  if ('captainType' in crew) {
    lines.push(`Captain ability: ${crew.captainType}`);
  }

  const reviveRoll = getFixedReviveRollValueForPreview(crew);
  const reviveBonus = getCrewReviveBonusForPreview(crew);
  lines.push(
    `Revive: Auto ${reviveRoll}` +
      (reviveBonus !== 0 ? ` (bonus ${formatSignedNumberForTooltip(reviveBonus)})` : ''),
  );

  const discoveryRoll = getFixedDiscoveryRollValueForPreview(crew);
  lines.push(`Discovery (scan/acquire): Auto ${discoveryRoll}`);

  const scanRangeBonus = getScanRangeBonusForPreview(crew);
  const scanRangeNote = (() => {
    if ('captainType' in crew) {
      return '';
    }

    if (crew.type === 'basic' && crew.role === 'scientist') {
      return ' (requires Science Lab)';
    }

    if (crew.type === 'officer' && crew.role === 'senior_scientist') {
      return ' (requires Bridge or Science Lab)';
    }

    return '';
  })();
  lines.push(`Scan range: +${scanRangeBonus}${scanRangeNote}`);

  const [attackDie0, attackDie1] = getFixedAttackRollValuesForPreview();
  const attackBonus = getCrewAttackDamageBonusForPreview(crew);
  lines.push(
    `Attack: Auto ${attackDie0}+${attackDie1}` +
      (attackBonus !== 0 ? ` (damage ${formatSignedNumberForTooltip(attackBonus)})` : ''),
  );

  const restorePowerBonus = getCrewRestorePowerBonusForPreview(crew);
  const restoreShieldBonus = getCrewRestoreShieldBonusForPreview(crew);
  lines.push(
    `Restore: Power ${formatSignedNumberForTooltip(restorePowerBonus)}, Shields ${formatSignedNumberForTooltip(
      restoreShieldBonus,
    )}`,
  );

  const repairMultiplier = getCrewRepairMultiplierForPreview(crew);
  lines.push(`Repair: x${repairMultiplier}`);

  const assembleItemConfig: { itemType: string; label: string }[] = [
    { itemType: 'medical_kit', label: 'Med-Kit' },
    { itemType: 'probe', label: 'Probe' },
    { itemType: 'spare_parts', label: 'Spare Parts' },
    { itemType: 'torpedo', label: 'Torpedo' },
  ];

  const assembleLines = assembleItemConfig
    .map(({ itemType, label }) => {
      const roll = getFixedAssembleRollValueForPreview(crew, itemType);
      const bonus = getCrewAssembleBonusForPreview(crew, itemType);
      const hasSpecial = roll !== 3 || bonus !== 0;
      if (!hasSpecial) {
        return null;
      }
      return `${label} assemble: Auto ${roll}` + (bonus !== 0 ? ` (bonus ${formatSignedNumberForTooltip(bonus)})` : '');
    })
    .filter((line): line is string => typeof line === 'string');

  if (assembleLines.length) {
    lines.push('Assemble:');
    for (const line of assembleLines) {
      lines.push(`- ${line}`);
    }
  }

  return lines.join('\n');
}

/** Section layout order matching reference image */
const SECTION_LAYOUT = [
  [SHIP_SECTIONS.MED_LAB, SHIP_SECTIONS.BRIDGE, SHIP_SECTIONS.SCI_LAB],
  [SHIP_SECTIONS.DRIVES, SHIP_SECTIONS.ENGINEERING, SHIP_SECTIONS.DEFENSE],
];

/**
 * Connection pairs for corridors (crew movement) and conduits (power routing)
 * Purpose: Define which section pairs have physical connections
 * Matches playmat layout:
 *   MED_LAB === BRIDGE === SCI_LAB
 *      ‖          ===         ===
 *   DRIVES  -- ENGINEERING === DEFENSE
 *
 * === means corridor + conduit, ‖ means conduit only, -- means conduit only
 *
 * Corridors: MED↔BRI, BRI↔SCI, BRI↔ENG, DEF↔SCI, DEF↔ENG
 * Conduits: 2 minimum on every connection; +1 extra conduit on ENG↔DRIVES and ENG↔DEFENSE
 */
const CONNECTION_PAIRS: { sections: [ShipSection, ShipSection]; conduitCount: number; hasCorridor: boolean }[] = (() => {
  const layout = SHIP_CONNECTION_LAYOUT as unknown as Record<
    ShipSection,
    {
      corridors?: Partial<Record<ShipSection, number>>;
      conduitConnections?: Partial<Record<ShipSection, number>>;
    }
  >;

  const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
  const pairsByKey = new Map<
    string,
    { sections: [ShipSection, ShipSection]; conduitCount: number; hasCorridor: boolean }
  >();

  for (const a of sectionKeys) {
    for (const b of sectionKeys) {
      if (a === b) {
        continue;
      }

      const aLayout = layout[a];
      const bLayout = layout[b];

      const maxConduits = Math.max(
        aLayout?.conduitConnections?.[b] ?? 0,
        bLayout?.conduitConnections?.[a] ?? 0,
      );
      const hasCorridor =
        (aLayout?.corridors?.[b] ?? 0) === 1 || (bLayout?.corridors?.[a] ?? 0) === 1;

      if (maxConduits <= 0 && !hasCorridor) {
        continue;
      }

      const sections = (a < b ? [a, b] : [b, a]) as [ShipSection, ShipSection];
      const key = `${sections[0]}-${sections[1]}`;

      const existing = pairsByKey.get(key);
      if (!existing) {
        pairsByKey.set(key, { sections, conduitCount: maxConduits, hasCorridor });
        continue;
      }

      pairsByKey.set(key, {
        sections: existing.sections,
        conduitCount: Math.max(existing.conduitCount, maxConduits),
        hasCorridor: existing.hasCorridor || hasCorridor,
      });
    }
  }

  return Array.from(pairsByKey.values()).sort((p, q) => {
    const left = p.sections[0].localeCompare(q.sections[0]);
    if (left !== 0) {
      return left;
    }
    return p.sections[1].localeCompare(q.sections[1]);
  });
})();

/**
 * ShipStructureOverlay component
 * Purpose: Draw visual corridor lines between ship sections as an SVG overlay
 * Parameters:
 *   - ship: Current ship state with section corridor data
 *   - gridWidth: Width of the section grid container in pixels
 *   - gridHeight: Height of the section grid container in pixels
 */
function ShipStructureOverlay({
  ship,
  gridWidth,
  gridHeight,
  sectionRects,
  predictedOverloadedConduitEdges,
}: {
  ship: Ship;
  gridWidth: number;
  gridHeight: number;
  sectionRects: Record<string, { x: number; y: number; width: number; height: number }>;
  predictedOverloadedConduitEdges?: Set<string> | null;
}) {
  const clipToRectEdge = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    rect: { x: number; y: number; width: number; height: number },
    outset: number,
  ): { x: number; y: number } => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (dx === 0 && dy === 0) {
      return { x: from.x, y: from.y };
    }

    const xMin = rect.x;
    const xMax = rect.x + rect.width;
    const yMin = rect.y;
    const yMax = rect.y + rect.height;

    const candidates: { t: number; x: number; y: number }[] = [];

    if (dx !== 0) {
      const edgeX = dx > 0 ? xMax : xMin;
      const t = (edgeX - from.x) / dx;
      if (t > 0) {
        const y = from.y + dy * t;
        if (y >= yMin && y <= yMax) {
          candidates.push({ t, x: edgeX, y });
        }
      }
    }

    if (dy !== 0) {
      const edgeY = dy > 0 ? yMax : yMin;
      const t = (edgeY - from.y) / dy;
      if (t > 0) {
        const x = from.x + dx * t;
        if (x >= xMin && x <= xMax) {
          candidates.push({ t, x, y: edgeY });
        }
      }
    }

    if (candidates.length === 0) {
      return { x: from.x, y: from.y };
    }

    candidates.sort((a, b) => a.t - b.t);
    const hit = candidates[0];

    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len;
    const uy = dy / len;

    return {
      x: hit.x + ux * outset,
      y: hit.y + uy * outset,
    };
  };

  const connections = useMemo(() => {
    if (gridWidth === 0 || gridHeight === 0) return [];

    const result: {
      key: string;
      sectionA: ShipSection;
      sectionB: ShipSection;
      rectA: { x: number; y: number; width: number; height: number };
      rectB: { x: number; y: number; width: number; height: number };
      centerA: { x: number; y: number };
      centerB: { x: number; y: number };
      hasCorridor: boolean; // Whether this connection has a corridor (from config)
      corridorIntact: boolean;
      conduitCount: number; // Number of conduits on this connection (from config)
      activeConduits: number; // Current intact conduits (from ship state)
    }[] = [];

    for (const { sections: [sectionA, sectionB], conduitCount, hasCorridor } of CONNECTION_PAIRS) {
      const rectA = sectionRects[sectionA];
      const rectB = sectionRects[sectionB];
      if (!rectA || !rectB) continue;

      const centerA = { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 };
      const centerB = { x: rectB.x + rectB.width / 2, y: rectB.y + rectB.height / 2 };

      const stateA = ship.sections[sectionA];
      const stateB = ship.sections[sectionB];

      // Check corridor status (0 = damaged, 1 = intact) - only if this connection has a corridor
      const corridorAtoB = stateA?.corridors?.[sectionB] ?? 0;
      const corridorBtoA = stateB?.corridors?.[sectionA] ?? 0;
      const corridorIntact =
        hasCorridor &&
        corridorAtoB === 1 &&
        corridorBtoA === 1;

      // Check conduit status - get current count from ship state
      const conduitAtoB = stateA?.conduitConnections?.[sectionB] ?? 0;
      const conduitBtoA = stateB?.conduitConnections?.[sectionA] ?? 0;
      const activeConduits = Math.min(conduitAtoB, conduitBtoA);

      result.push({
        key: `${sectionA}-${sectionB}`,
        sectionA,
        sectionB,
        rectA,
        rectB,
        centerA,
        centerB,
        hasCorridor,
        corridorIntact,
        conduitCount,
        activeConduits,
      });
    }

    return result;
  }, [ship, gridWidth, gridHeight, sectionRects]);

  if (gridWidth === 0 || gridHeight === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={gridWidth}
      height={gridHeight}
      style={{ zIndex: 20 }}
    >
      <defs>
        <pattern id="gravity-hud-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#22d3ee" strokeWidth="1" opacity="0.10" />
          <path d="M 12 0 L 12 24" fill="none" stroke="#22d3ee" strokeWidth="1" opacity="0.05" />
          <path d="M 0 12 L 24 12" fill="none" stroke="#22d3ee" strokeWidth="1" opacity="0.05" />
        </pattern>

        <linearGradient id="gravity-corridor-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>

        <linearGradient id="gravity-conduit-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="50%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>

        <filter id="gravity-corridor-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="gravity-conduit-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <filter id="gravity-spark-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <style>{`
          @keyframes gravity-dash-44 {
            0% { stroke-dashoffset: 0; }
            55% { stroke-dashoffset: -44; }
            100% { stroke-dashoffset: -44; }
          }

          @keyframes gravity-dash-36 {
            0% { stroke-dashoffset: 0; }
            55% { stroke-dashoffset: -36; }
            100% { stroke-dashoffset: -36; }
          }

          @keyframes gravity-conduit-pulse {
            0% { opacity: 0.85; }
            40% { opacity: 1; }
            70% { opacity: 0.9; }
            100% { opacity: 0.85; }
          }

          @keyframes gravity-conduit-breathe {
            0% { opacity: 0.55; }
            50% { opacity: 1; }
            100% { opacity: 0.55; }
          }

          .gravity-conduit-breathe {
            animation: gravity-conduit-breathe 2.8s ease-in-out infinite;
          }

          .gravity-dash-44 {
            animation:
              gravity-dash-44 3.8s linear infinite,
              gravity-conduit-pulse 7.5s ease-in-out infinite;
          }

          .gravity-dash-36 {
            animation:
              gravity-dash-36 3.2s linear infinite,
              gravity-conduit-pulse 6.8s ease-in-out infinite;
          }

          @keyframes gravity-endcap-burst {
            0%, 58%, 100% { opacity: 0; }
            61% { opacity: 0.95; }
            64% { opacity: 0.15; }
            68% { opacity: 0.8; }
            72% { opacity: 0; }
          }

          @keyframes gravity-endcap-color {
            0% { fill: #facc15; }
            33% { fill: #fb923c; }
            66% { fill: #f97316; }
            85% { fill: #fb7185; }
            100% { fill: #facc15; }
          }

          .gravity-endcap-spark {
            animation:
              gravity-endcap-burst 6.6s ease-in-out infinite,
              gravity-endcap-color 9.4s linear infinite;
          }
        `}</style>
      </defs>

      <rect x={0} y={0} width={gridWidth} height={gridHeight} fill="url(#gravity-hud-grid)" opacity={0.22}>
        <animate attributeName="opacity" values="0.14;0.26;0.14" dur="6s" repeatCount="indefinite" />
      </rect>

      {connections.map((conn) => {
        // Calculate perpendicular offset for parallel corridor/conduit lines
        const dx = conn.centerB.x - conn.centerA.x;
        const dy = conn.centerB.y - conn.centerA.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const perpX = len > 0 ? -dy / len : 0;
        const perpY = len > 0 ? dx / len : 0;

        const endCapGap = Math.min(16, Math.max(0, Math.min(20, len / 2 - 2)));

        const minRectSize = Math.min(
          conn.rectA.width,
          conn.rectA.height,
          conn.rectB.width,
          conn.rectB.height,
        );

        // Spacing between corridor and conduits
        const corridorOffset = conn.hasCorridor
          ? Math.min(30, Math.max(18, minRectSize * 0.22))
          : 0;
        const conduitSpacing = Math.min(12, Math.max(8, minRectSize * 0.10));

        return (
          <g key={conn.key}>
            {/* Corridor line (crew movement) - yellow/amber solid - only if hasCorridor */}
            {conn.hasCorridor && (
              <>
                {(() => {
                  const from = {
                    x: conn.centerA.x + perpX * corridorOffset,
                    y: conn.centerA.y + perpY * corridorOffset,
                  };
                  const to = {
                    x: conn.centerB.x + perpX * corridorOffset,
                    y: conn.centerB.y + perpY * corridorOffset,
                  };

                  const rawStart = clipToRectEdge(from, to, conn.rectA, 0);
                  const rawEnd = clipToRectEdge(to, from, conn.rectB, 0);
                  const lineDx = rawEnd.x - rawStart.x;
                  const lineDy = rawEnd.y - rawStart.y;
                  const lineLen = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
                  const dirX = lineLen > 0 ? lineDx / lineLen : 0;
                  const dirY = lineLen > 0 ? lineDy / lineLen : 0;

                  const rawX1 = rawStart.x;
                  const rawY1 = rawStart.y;
                  const rawX2 = rawEnd.x;
                  const rawY2 = rawEnd.y;

                  const x1 = rawX1 + dirX * endCapGap;
                  const y1 = rawY1 + dirY * endCapGap;
                  const x2 = rawX2 - dirX * endCapGap;
                  const y2 = rawY2 - dirY * endCapGap;
                  const baseDelay = (conn.key.length % 7) * 0.35;

                  return (
                    <>
                      {!conn.corridorIntact && (
                        <g>
                          <circle
                            cx={rawX1}
                            cy={rawY1}
                            r={2.0}
                            className="gravity-endcap-spark"
                            filter="url(#gravity-spark-glow)"
                            style={{ animationDelay: `${baseDelay}s, ${baseDelay}s` }}
                          />
                          <circle
                            cx={rawX1 + perpX * 4}
                            cy={rawY1 + perpY * 4}
                            r={1.3}
                            className="gravity-endcap-spark"
                            filter="url(#gravity-spark-glow)"
                            style={{ animationDelay: `${baseDelay + 1.4}s, ${baseDelay + 0.6}s` }}
                          />
                          <circle
                            cx={rawX2}
                            cy={rawY2}
                            r={2.0}
                            className="gravity-endcap-spark"
                            filter="url(#gravity-spark-glow)"
                            style={{ animationDelay: `${baseDelay + 0.9}s, ${baseDelay + 0.2}s` }}
                          />
                          <circle
                            cx={rawX2 - perpX * 4}
                            cy={rawY2 - perpY * 4}
                            r={1.3}
                            className="gravity-endcap-spark"
                            filter="url(#gravity-spark-glow)"
                            style={{ animationDelay: `${baseDelay + 2.2}s, ${baseDelay + 1.1}s` }}
                          />
                        </g>
                      )}

                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={conn.corridorIntact ? '#60a5fa' : '#fb7185'}
                        strokeWidth={19.2}
                        strokeOpacity={conn.corridorIntact ? 0.9 : 0.75}
                        strokeLinecap="butt"
                      />
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={conn.corridorIntact ? 'url(#gravity-corridor-gradient)' : '#fb7185'}
                        strokeWidth={96}
                        strokeOpacity={conn.corridorIntact ? 0.11 : 0.10}
                        strokeLinecap="butt"
                        filter="url(#gravity-corridor-glow)"
                      />
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={conn.corridorIntact ? '#93c5fd' : '#fb7185'}
                        strokeWidth={51}
                        strokeOpacity={conn.corridorIntact ? 0.82 : 0.55}
                        strokeDasharray={conn.corridorIntact ? undefined : '6 10'}
                        strokeLinecap="butt"
                        filter={conn.corridorIntact ? 'url(#gravity-corridor-glow)' : 'url(#gravity-corridor-glow)'}
                      />

                      {!conn.corridorIntact && (
                        <circle
                          cx={(rawX1 + rawX2) / 2}
                          cy={(rawY1 + rawY2) / 2}
                          r={2.4}
                          fill="#fb7185"
                          opacity={0.7}
                          filter="url(#gravity-spark-glow)"
                        >
                          <animate
                            attributeName="opacity"
                            values="0;0;0.85;0;0"
                            keyTimes="0;0.60;0.66;0.74;1"
                            dur="4.4s"
                            repeatCount="indefinite"
                          />
                          <animate
                            attributeName="r"
                            values="1.6;1.6;3.2;1.6;1.6"
                            keyTimes="0;0.60;0.66;0.74;1"
                            dur="4.4s"
                            repeatCount="indefinite"
                          />
                        </circle>
                      )}
                    </>
                  );
                })()}
              </>
            )}
            {/* Conduit lines (power routing) - cyan/blue electrical */}
            {Array.from({ length: conn.conduitCount }).map((_, i) => {
              // Position each conduit line: centered around the connection line.
              // If a corridor exists, shift the whole conduit bundle away from the corridor.
              const baseOffset = conn.hasCorridor ? -corridorOffset : 0;
              const bundleCenter = (conn.conduitCount - 1) / 2;
              const conduitOffset = baseOffset + (i - bundleCenter) * conduitSpacing;
              const isActive = i < conn.activeConduits;
              const edgeKey = `${conn.sectionA}|${conn.sectionB}`;
              const isOverloadedEdge =
                !!predictedOverloadedConduitEdges && predictedOverloadedConduitEdges.has(edgeKey);
              const activeStroke = isOverloadedEdge ? '#fb7185' : '#22c55e';
              const activeStrokeBright = isOverloadedEdge ? '#fecaca' : '#bbf7d0';

              const from = {
                x: conn.centerA.x + perpX * conduitOffset,
                y: conn.centerA.y + perpY * conduitOffset,
              };
              const to = {
                x: conn.centerB.x + perpX * conduitOffset,
                y: conn.centerB.y + perpY * conduitOffset,
              };

              const rawStart = clipToRectEdge(from, to, conn.rectA, 0);
              const rawEnd = clipToRectEdge(to, from, conn.rectB, 0);
              const lineDx = rawEnd.x - rawStart.x;
              const lineDy = rawEnd.y - rawStart.y;
              const lineLen = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
              const dirX = lineLen > 0 ? lineDx / lineLen : 0;
              const dirY = lineLen > 0 ? lineDy / lineLen : 0;

              const rawX1 = rawStart.x;
              const rawY1 = rawStart.y;
              const rawX2 = rawEnd.x;
              const rawY2 = rawEnd.y;

              const tx1 = rawX1 + dirX * endCapGap;
              const ty1 = rawY1 + dirY * endCapGap;
              const tx2 = rawX2 - dirX * endCapGap;
              const ty2 = rawY2 - dirY * endCapGap;
              const mx = (rawX1 + rawX2) / 2;
              const my = (rawY1 + rawY2) / 2;
              const sparkSeed = ((conn.key.length + i * 3) % 9) * 0.28;

              return (
                <g key={`conduit-${i}`}>
                  <line
                    x1={tx1}
                    y1={ty1}
                    x2={tx2}
                    y2={ty2}
                    stroke={isActive ? activeStroke : '#94a3b8'}
                    strokeWidth={3.0}
                    strokeOpacity={isActive ? 0.8 : 0.82}
                    strokeLinecap="round"
                  />
                  <line
                    x1={tx1}
                    y1={ty1}
                    x2={tx2}
                    y2={ty2}
                    stroke={isActive ? (isOverloadedEdge ? '#fb7185' : 'url(#gravity-conduit-gradient)') : '#94a3b8'}
                    strokeWidth={10}
                    strokeOpacity={isActive ? 0.16 : 0.22}
                    strokeDasharray={isActive ? undefined : '4 14'}
                    strokeLinecap="round"
                    filter={isActive ? 'url(#gravity-conduit-glow)' : 'url(#gravity-spark-glow)'}
                    className={isActive ? 'gravity-conduit-breathe' : undefined}
                  />
                  <line
                    x1={tx1}
                    y1={ty1}
                    x2={tx2}
                    y2={ty2}
                    stroke={isActive ? activeStrokeBright : '#475569'}
                    strokeWidth={4}
                    strokeOpacity={isActive ? 0.85 : 0.78}
                    strokeDasharray={isActive ? undefined : '3 12'}
                    strokeLinecap="round"
                    filter={isActive ? 'url(#gravity-conduit-glow)' : undefined}
                    className={isActive ? 'gravity-conduit-breathe' : undefined}
                  />

                  {!isActive && (
                    <g>
                      <circle
                        cx={rawX1}
                        cy={rawY1}
                        r={1.8}
                        className="gravity-endcap-spark"
                        filter="url(#gravity-spark-glow)"
                        style={{ animationDelay: `${sparkSeed + 0.2}s, ${sparkSeed + 0.1}s` }}
                      />
                      <circle
                        cx={rawX2}
                        cy={rawY2}
                        r={1.8}
                        className="gravity-endcap-spark"
                        filter="url(#gravity-spark-glow)"
                        style={{ animationDelay: `${sparkSeed + 1.4}s, ${sparkSeed + 0.7}s` }}
                      />
                      <circle
                        cx={rawX1 + perpX * 3}
                        cy={rawY1 + perpY * 3}
                        r={1.1}
                        className="gravity-endcap-spark"
                        filter="url(#gravity-spark-glow)"
                        style={{ animationDelay: `${sparkSeed + 2.0}s, ${sparkSeed + 1.2}s` }}
                      />
                      <circle
                        cx={rawX2 - perpX * 3}
                        cy={rawY2 - perpY * 3}
                        r={1.1}
                        className="gravity-endcap-spark"
                        filter="url(#gravity-spark-glow)"
                        style={{ animationDelay: `${sparkSeed + 2.7}s, ${sparkSeed + 1.6}s` }}
                      />
                    </g>
                  )}

                  {!isActive && (
                    <g>
                      <circle cx={mx} cy={my} r={2.2} fill="#fb7185" opacity={0.75} filter="url(#gravity-spark-glow)">
                        <animate
                          attributeName="opacity"
                          values="0;0;0.9;0;0"
                          keyTimes="0;0.62;0.70;0.78;1"
                          dur="3.8s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="r"
                          values="1.2;1.2;3.4;1.2;1.2"
                          keyTimes="0;0.62;0.70;0.78;1"
                          dur="3.8s"
                          repeatCount="indefinite"
                        />
                      </circle>
                      <circle
                        cx={mx + perpX * 6}
                        cy={my + perpY * 6}
                        r={1.6}
                        fill="#f97316"
                        opacity={0.65}
                        filter="url(#gravity-spark-glow)"
                      >
                        <animate
                          attributeName="opacity"
                          values="0;0;0.9;0;0"
                          keyTimes="0;0.70;0.76;0.84;1"
                          dur="5.2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Render a single ship section card
 */
function SectionCard({
  sectionKey,
  section,
  ship,
  installedUpgrades,
  crew,
  sectionDiff,
  canSelectAsMoveTarget,
  onSelectAsMoveTarget,
  isRoutingMode,
  isRoutingTarget,
  isMoveTarget,
  isRepairTarget,
  allocatedPower,
  safeCapacity,
  willOverload,
  explorerRepairKit,
  onOpenUpgradeDetails,
  onChargeUpgrade,
  selectedUpgradeId,
  onCloseUpgradeDetails,
  applyingUpgradeIds,
}: {
  sectionKey: ShipSection;
  section: ShipSectionState | undefined;
  ship: Ship;
  installedUpgrades: UpgradeCard[];
  crew: (AnyCrew | Captain)[];
  sectionDiff?: SectionDiff | null;
  canSelectAsMoveTarget?: boolean;
  onSelectAsMoveTarget?: () => void;
  isRoutingMode?: boolean;
  isRoutingTarget?: boolean;
  isMoveTarget?: boolean;
  isRepairTarget?: boolean;
  allocatedPower?: number;
  safeCapacity?: number;
  willOverload?: boolean;
  explorerRepairKit?: { section: ShipSection | null; used: boolean } | null;
  onOpenUpgradeDetails?: (upgradeId: string) => void;
  onChargeUpgrade?: (upgradeId: string, fromSection: ShipSection) => void;
  selectedUpgradeId?: string | null;
  onCloseUpgradeDetails?: () => void;
  applyingUpgradeIds?: Set<string> | null;
}) {
  const config = SECTION_CONFIG[sectionKey];

  if (!section || !config) {
    return null;
  }

  const totalConduits = Object.values(section.conduitConnections ?? {}).reduce(
    (sum, value) => sum + (value ?? 0),
    0,
  );

  const maxHull = CORE_SECTION_CONFIG[sectionKey]?.maxHull ?? section.hull;
  const crewInSection = crew.filter((c) => c.location === sectionKey);

  const isFullyPowered = ShipUtils.isFullyPowered(ship, sectionKey);
  const hullRatio = maxHull > 0 ? section.hull / maxHull : 0;
  const isDestroyed = section.hull <= 0;
  const isDamaged = !isDestroyed && section.hull < maxHull;
  const isCritical = isDamaged && hullRatio <= 1 / 3;

  const totalPower = section.powerDice.reduce((sum, die) => sum + die, 0);
  const requiredPower = (CORE_SECTION_CONFIG[sectionKey] as any)?.powerRequired as number | undefined;
  const storagePower = (CORE_SECTION_CONFIG[sectionKey] as any)?.powerStorage as number | undefined;

  const hullPercent = Math.max(0, Math.min(100, hullRatio * 100));

  const hullStatus = isDestroyed ? 'DESTROYED' : isCritical ? 'CRITICAL' : isDamaged ? 'DAMAGED' : 'OK';
  const hullStatusClass = isDestroyed
    ? 'border-red-500/50 bg-red-950/40 text-red-200'
    : isCritical
      ? 'border-red-400/50 bg-red-950/30 text-red-200'
      : isDamaged
        ? 'border-amber-400/50 bg-amber-950/30 text-amber-200'
        : 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200';

  const hullFillClass = isDestroyed
    ? 'bg-gradient-to-r from-red-500/20 via-red-400/20 to-red-300/25'
    : isCritical
      ? 'bg-gradient-to-r from-red-500/20 via-red-400/20 to-red-300/25'
    : isDamaged
      ? 'bg-gradient-to-r from-amber-500/18 via-amber-400/18 to-amber-300/22'
      : 'bg-gradient-to-r from-emerald-500/16 via-emerald-400/18 to-emerald-300/22';

  const safeRequiredPower =
    typeof requiredPower === 'number' && Number.isFinite(requiredPower) && requiredPower > 0
      ? requiredPower
      : null;

  const safeStoragePower =
    typeof storagePower === 'number' && Number.isFinite(storagePower) && storagePower > 0
      ? storagePower
      : 0;

  const powerMax = (() => {
    const base = safeRequiredPower ?? 0;
    const capacity = base + safeStoragePower;
    return Math.max(1, capacity);
  })();

  const powerOk = safeRequiredPower !== null ? totalPower >= safeRequiredPower : null;
  const powerStatus = powerOk === null ? null : powerOk ? 'FULL' : 'LOW';
  const powerStatusClass =
    powerOk === null
      ? 'border-slate-600/60 bg-slate-950/25 text-slate-200'
      : powerOk
        ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200'
        : 'border-amber-400/50 bg-amber-950/30 text-amber-200';

  const lifeSupportContributions = ShipUtils.getLifeSupportContributions(ship);
  const lifeSupportProvided = lifeSupportContributions[sectionKey] ?? 0;
  const lifeSupportMax = ((CORE_SECTION_CONFIG[sectionKey] as any)?.fullyPoweredBenefits?.lifeSupport as number | undefined) ?? 0;

  const installedUpgradesInSection = installedUpgrades.filter((upgrade) => {
    const sectionRaw = (upgrade as { section?: unknown }).section;
    return typeof sectionRaw === 'string' && sectionRaw === sectionKey;
  });

  const upgradesNeedingPowerInSection = installedUpgradesInSection
    .map((upgrade) => {
      const status = getUpgradePowerStatus(upgrade, ship);
      return { upgrade, status };
    })
    .filter(({ status }) => status.upgradePowerRequired > 0);

  const fullyPoweredBenefitsLabel = (() => {
    const benefits = (CORE_SECTION_CONFIG[sectionKey] as any)?.fullyPoweredBenefits as
      | Record<string, unknown>
      | undefined;
    if (!benefits || typeof benefits !== 'object') {
      return '—';
    }

    const entries = Object.entries(benefits)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value !== 0)
      .map(([key, value]) => {
        const label =
          key === 'lifeSupport'
            ? 'Life Support'
            : key === 'acceleration'
              ? 'Acceleration'
              : key === 'scanRange'
                ? 'Scan Range'
                : key === 'reviveBonus'
                  ? 'Revive Bonus'
                  : key === 'shieldGeneration'
                    ? 'Shield Generation'
                    : key === 'powerGeneration'
                      ? 'Power Generation'
                      : key;
        return `${label}: ${String(value)}`;
      });

    return entries.length > 0 ? entries.join(', ') : '—';
  })();

  const damageLabel = isDestroyed ? 'Destroyed (hull 0)' : isCritical ? 'Critical' : isDamaged ? 'Damaged' : 'Healthy';
  const poweredLabel = requiredPower && requiredPower > 0
    ? `${totalPower}/${powerMax} (full at ${requiredPower}; ${isFullyPowered ? 'fully powered' : 'not fully powered'})`
    : `${totalPower}/${powerMax} (no full-power threshold)`;

  const sectionTooltipTitle = [
    `${config.label}`,
    `Hull Strength: ${section.hull}/${maxHull} (${damageLabel})`,
    `Power: ${poweredLabel}`,
    `Life Support: ${lifeSupportProvided}${lifeSupportMax > 0 ? ` (max ${lifeSupportMax})` : ''}`,
    `Fully Powered Benefits: ${fullyPoweredBenefitsLabel}`,
    `Upgrades: ${
      installedUpgradesInSection.length > 0
        ? installedUpgradesInSection.map((u) => u.name).join(', ')
        : '—'
    }`,
  ].join('\n');

  const hullDamageClass = isDestroyed
    ? 'outline outline-4 outline-red-500 outline-offset-0 opacity-60 grayscale'
    : isCritical
      ? 'outline outline-2 outline-red-400 outline-offset-0'
      : isDamaged
        ? 'outline outline-2 outline-amber-400 outline-offset-0'
        : '';

  const isFullyPoweredAndHealthy = isFullyPowered && !isDamaged && !isDestroyed;
  const borderClass = isFullyPoweredAndHealthy ? 'border-yellow-400/80' : `border-${config.color}`;
  const fullyPoweredClass = isFullyPoweredAndHealthy ? 'brightness-110' : '';

  const hasExplorerRepairKit =
    !!explorerRepairKit && explorerRepairKit.section === sectionKey;

  const isClickable = !!canSelectAsMoveTarget && !!onSelectAsMoveTarget;

  // Show routing visual for any reachable section in routing mode
  // Red ring = will overload (exceeds conduit capacity or no conduits)
  // Sky ring = within safe capacity
  const routingClass =
    isRoutingMode && isRoutingTarget
    ? willOverload
      ? 'ring-2 ring-red-400 ring-offset-1 ring-offset-slate-900'
      : 'ring-2 ring-sky-400 ring-offset-1 ring-offset-slate-900'
    : '';

  const moveClass =
    !isRoutingMode && isMoveTarget
      ? 'ring-2 ring-emerald-400 ring-offset-1 ring-offset-slate-900'
      : '';

  const repairClass =
    !isRoutingMode && !isMoveTarget && isRepairTarget
      ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900'
      : '';

  const hasAnyDelta =
    !!sectionDiff &&
    (sectionDiff.hullDelta !== 0 ||
      sectionDiff.powerDelta !== 0 ||
      sectionDiff.conduitsDelta !== 0 ||
      sectionDiff.corridorsDelta !== 0);

  const formatDelta = (value: number) => (value > 0 ? `+${value}` : `${value}`);

  const deltaPillClass = (value: number) =>
    value > 0
      ? 'border-green-400/40 bg-green-950/30 text-green-200'
      : 'border-red-400/40 bg-red-950/30 text-red-200';

  return (
    <div
      className={`panel h-full flex flex-col p-2 border-2 ${borderClass} ${config.bgColor} ${fullyPoweredClass} ${hullDamageClass} ${routingClass} ${moveClass} ${repairClass} ${
        isClickable ? 'cursor-pointer hover:border-white/60' : ''
      }`}
      title={sectionTooltipTitle}
      onClick={isClickable ? onSelectAsMoveTarget : undefined}
    >
      {/* Section header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <div className="text-xs font-bold tracking-wide">{config.label}</div>
          {hasExplorerRepairKit && (
            <span
              className={`px-1 rounded border text-[9px] font-semibold ${
                explorerRepairKit?.used
                  ? 'border-slate-500/50 bg-slate-900/40 text-slate-300'
                  : 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200'
              }`}
              title={
                explorerRepairKit?.used
                  ? 'Explorer: Repair kit (used)'
                  : 'Explorer: Special repair kit (unused)'
              }
            >
              KIT
            </span>
          )}
        </div>
        {hasAnyDelta && (
          <div className="flex items-center gap-1">
            {sectionDiff && sectionDiff.hullDelta !== 0 && (
              <span
                className={`px-1 rounded border text-[9px] font-semibold ${deltaPillClass(sectionDiff.hullDelta)}`}
                title={`Hull ${formatDelta(sectionDiff.hullDelta)}`}
              >
                H{formatDelta(sectionDiff.hullDelta)}
              </span>
            )}
            {sectionDiff && sectionDiff.powerDelta !== 0 && (
              <span
                className={`px-1 rounded border text-[9px] font-semibold ${deltaPillClass(sectionDiff.powerDelta)}`}
                title={`Power ${formatDelta(sectionDiff.powerDelta)}`}
              >
                P{formatDelta(sectionDiff.powerDelta)}
              </span>
            )}
            {sectionDiff && sectionDiff.conduitsDelta !== 0 && (
              <span
                className={`px-1 rounded border text-[9px] font-semibold ${deltaPillClass(sectionDiff.conduitsDelta)}`}
                title={`Conduits ${formatDelta(sectionDiff.conduitsDelta)}`}
              >
                C{formatDelta(sectionDiff.conduitsDelta)}
              </span>
            )}
            {sectionDiff && sectionDiff.corridorsDelta !== 0 && (
              <span
                className={`px-1 rounded border text-[9px] font-semibold ${deltaPillClass(sectionDiff.corridorsDelta)}`}
                title={`Corridors ${formatDelta(sectionDiff.corridorsDelta)}`}
              >
                R{formatDelta(sectionDiff.corridorsDelta)}
              </span>
            )}
          </div>
        )}
      </div>

      {upgradesNeedingPowerInSection.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {upgradesNeedingPowerInSection.map(({ upgrade, status }) => {
            const isSelected = selectedUpgradeId === upgrade.id;
            const isApplying = status.isPowered && !!applyingUpgradeIds && applyingUpgradeIds.has(upgrade.id);
            const pillClass = isSelected
              ? status.isPowered
                ? isApplying
                  ? 'border-fuchsia-200/80 bg-fuchsia-950/40 text-fuchsia-100 ring-2 ring-fuchsia-300/70 shadow-[0_0_14px_rgba(217,70,239,0.20)]'
                  : 'border-emerald-200/70 bg-emerald-950/35 text-emerald-100 ring-1 ring-emerald-300/60'
                : 'border-amber-200/70 bg-amber-950/35 text-amber-100 ring-1 ring-amber-300/60'
              : status.isPowered
                ? isApplying
                  ? 'border-fuchsia-400/60 bg-fuchsia-950/25 text-fuchsia-100 ring-2 ring-fuchsia-400/55 shadow-[0_0_14px_rgba(217,70,239,0.18)]'
                  : 'border-emerald-400/50 bg-emerald-950/20 text-emerald-100'
                : 'border-amber-400/50 bg-amber-950/20 text-amber-100';

            const rulesTextRaw = (upgrade as { effects?: { rulesText?: unknown } }).effects?.rulesText;
            const rulesTextLabel = typeof rulesTextRaw === 'string' ? rulesTextRaw : null;
            const mechanicsSummary = getUpgradeMechanicsSummary(upgrade.id);
            const effectLabel = mechanicsSummary ?? rulesTextLabel;

            const shortEffect = (() => {
              if (!status.isPowered) {
                return null;
              }
              if (upgrade.id === 'droid_station' || upgrade.id === 'repair_droids') {
                return 'x2 Repair';
              }
              if (upgrade.id === 'coolant') {
                return '+1 Restore';
              }
              if (upgrade.id === 'nano_bots') {
                return 'x2 Revive';
              }
              if (upgrade.id === 'cybernetics' || upgrade.id === 'temporal_shift') {
                return '+1 Action';
              }
              if (upgrade.id === 'teleporter') {
                return 'Acquire 0';
              }
              if (upgrade.id === 'neutron_calibrator') {
                return '+1 Range';
              }
              if (upgrade.id === 'plasma_engine') {
                return '+1 Drives';
              }
              if (upgrade.id === 'bio_engine') {
                return '+1 Life';
              }
              if (upgrade.id === 'bio_filters') {
                return '+3 Life';
              }
              if (upgrade.id === 'ai_defense') {
                return 'Scan Mark';
              }
              return null;
            })();

            return (
              <button
                key={upgrade.id}
                type="button"
                className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${pillClass} hover:brightness-110`}
                title={`${upgrade.name} • ${status.isPowered ? 'ON' : 'OFF'}${isApplying ? ' (APPLYING)' : ''}${effectLabel ? `\n${effectLabel}` : ''}\nUpgrade power: ${status.storedPower}/${status.upgradePowerRequired}\nSection power: ${status.totalPowerInSection}/${status.basePowerRequired}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (status.isPowered) {
                    if (isSelected) {
                      onCloseUpgradeDetails?.();
                    } else {
                      onOpenUpgradeDetails?.(upgrade.id);
                    }
                    return;
                  }

                  if (onChargeUpgrade) {
                    onChargeUpgrade(upgrade.id, sectionKey);
                    return;
                  }

                  onOpenUpgradeDetails?.(upgrade.id);
                }}
              >
                {upgrade.name} {status.isPowered ? 'ON' : 'OFF'}{shortEffect ? ` (${shortEffect})` : ''}{isApplying ? ' • APPLYING' : ''}
              </button>
            );
          })}
        </div>
      )}

      <div className="mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-bold tracking-wide text-gravity-muted">HULL STRENGTH</div>
            <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${hullStatusClass}`}>{hullStatus}</span>
          </div>
          <div className="text-right text-[11px] font-semibold tabular-nums text-slate-100">
            {section.hull}/{maxHull}
          </div>
        </div>

        <div className="mt-1 relative">
          <div className="relative h-3 rounded-md border border-slate-700/70 bg-slate-950/25 overflow-hidden">
            <div
              className="absolute inset-0 z-0"
              style={{
                background:
                  'repeating-linear-gradient(90deg, rgba(148,163,184,0.10) 0px, rgba(148,163,184,0.10) 1px, rgba(0,0,0,0) 6px, rgba(0,0,0,0) 10px)',
              }}
            />
            <div
              className={`absolute left-0 top-0 z-10 h-full ${hullFillClass} shadow-[0_0_10px_rgba(52,211,153,0.10)]`}
              style={{ width: `${hullPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-[11px] font-bold tracking-wide text-gravity-muted">POWER</div>
            {powerStatus && (
              <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${powerStatusClass}`}>{powerStatus}</span>
            )}
          </div>
          <div className="text-right text-[11px] font-semibold tabular-nums text-slate-100">
            {totalPower}/{powerMax}
            {safeRequiredPower !== null ? ` • REQ ${safeRequiredPower}` : ''}
          </div>
        </div>

        <div className="mt-1 relative">
          <div className="relative h-3 rounded-md border border-slate-700/70 bg-slate-950/25 overflow-hidden">
            <div
              className="absolute inset-0 z-0"
              style={{
                background:
                  'repeating-linear-gradient(90deg, rgba(148,163,184,0.10) 0px, rgba(148,163,184,0.10) 1px, rgba(0,0,0,0) 6px, rgba(0,0,0,0) 10px)',
              }}
            />
            {(() => {
              const safeFillMax = typeof powerMax === 'number' && Number.isFinite(powerMax) && powerMax > 0 ? powerMax : 1;
              const percent = Math.max(0, Math.min(100, (totalPower / safeFillMax) * 100));
              return (
                <div
                  className="absolute left-0 top-0 z-10 h-full bg-gradient-to-r from-sky-500/42 via-sky-400/42 to-sky-300/48 shadow-[0_0_14px_rgba(56,189,248,0.22)]"
                  style={{ width: `${percent}%` }}
                />
              );
            })()}
            {safeRequiredPower !== null && safeRequiredPower > 0 && (
              <div
                className="absolute top-0 z-20 h-full w-[2px] bg-amber-300/90"
                style={{ left: `calc(${Math.max(0, Math.min(100, (safeRequiredPower / powerMax) * 100))}% - 1px)` }}
                title={`Requirement: ${safeRequiredPower}/${powerMax}`}
              />
            )}
          </div>
        </div>
      </div>

      {isRoutingMode && isRoutingTarget && (
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gravity-muted">Route</span>
          <span
            className={`text-[10px] font-semibold ${
              willOverload ? 'text-red-300' : 'text-sky-300'
            }`}
          >
            {safeCapacity !== undefined && safeCapacity > 0
              ? `${allocatedPower ?? 0} / ${safeCapacity}`
              : `${allocatedPower ?? 0} (no conduits!)`}
          </span>
        </div>
      )}

      <div
        className="conduit-track"
        title={`${totalConduits} intact conduit${totalConduits === 1 ? '' : 's'}`}
      >
        {totalConduits > 0 ? (
          Array.from({ length: totalConduits }).map((_, index) => (
            <div key={index} className="conduit-dot" />
          ))
        ) : (
          <span className="text-[10px] text-gravity-muted">No conduits</span>
        )}
      </div>

      {(() => {
        const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
        const connected = sectionKeys.filter(
          (key) => key !== sectionKey && section.corridors[key] === 1,
        );

        if (connected.length === 0) {
          return (
            <div className="corridor-track">
              <span className="text-[10px] text-gravity-muted">No corridors</span>
            </div>
          );
        }

        return (
          <div className="corridor-track">
            {connected.map((key) => {
              const cfg = SECTION_CONFIG[key];
              const label = cfg?.label ?? key;
              return (
                <div
                  key={key}
                  className="corridor-node"
                  title={`Corridor to ${label}`}
                />
              );
            })}
          </div>
        );
      })()}

      {/* Crew placement indicators for this section */}
      <div className="mt-1 flex items-center justify-between gap-1">
        <div className="flex flex-nowrap gap-0.5 max-w-[70%] overflow-hidden">
          {crewInSection.slice(0, 8).map((c) => {
            const role = getCrewRole(c);
            const abbrev = getCrewAbbrev(role);
            return (
              <span
                key={c.id}
                className="px-1 rounded-sm bg-slate-900/80 border border-slate-600 text-[9px] font-semibold text-slate-100 shrink-0"
                title={`${c.name} (${role})`}
              >
                {abbrev}
              </span>
            );
          })}

          {crewInSection.length > 8 && (
            <span
              className="px-1 rounded-sm bg-slate-900/80 border border-slate-600 text-[9px] font-semibold text-slate-100 shrink-0"
              title={crewInSection
                .slice(8)
                .map((c) => c.name)
                .join(', ')}
            >
              +{crewInSection.length - 8}
            </span>
          )}
        </div>
        <div className="text-[10px] text-gravity-muted text-right shrink-0">
          Crew: {crewInSection.length}
        </div>
      </div>
    </div>
  );
}

function getRestorePowerBonusForCrew(crew: AnyCrew | Captain): number {
  if ('type' in crew && crew.type === 'basic' && 'role' in crew) {
    if (crew.role === 'engineer') {
      return 2;
    }
  }

  if ('type' in crew && crew.type === 'officer' && 'role' in crew) {
    if (crew.role === 'chief_engineer' || crew.role === 'android') {
      return 3;
    }
    if (crew.role === 'first_officer') {
      return 2;
    }
  }

  return 0;
}

// Restore_Power: UI helper that must stay in sync with engine requireRestoreAllowedForCrew + resolveRestoreActions base math.
function getRestorePowerForCrew(crew: AnyCrew | Captain, ship: Ship): number {
  const actingSectionRaw = (crew as any)?.location as unknown;
  const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
  const actingSection =
    typeof actingSectionRaw === 'string' && validSections.has(actingSectionRaw as ShipSection)
      ? (actingSectionRaw as ShipSection)
      : null;

  if (!actingSection) {
    return 0;
  }

  if (actingSection !== SHIP_SECTIONS.ENGINEERING) {
    const engineeringFunctional = ShipUtils.isFunctional(ship, SHIP_SECTIONS.ENGINEERING);
    const engineeringFullyPowered = ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.ENGINEERING);

    const isBridgeOrSciLab = actingSection === SHIP_SECTIONS.BRIDGE || actingSection === SHIP_SECTIONS.SCI_LAB;
    const isDefense = actingSection === SHIP_SECTIONS.DEFENSE;

    const canGenerate = (() => {
      if ((crew as any)?.type === 'basic') {
        const role = (crew as any)?.role as unknown;
        if (role === 'scientist') {
          return isBridgeOrSciLab && engineeringFunctional && engineeringFullyPowered;
        }
        if (role === 'tactician') {
          return isDefense && engineeringFullyPowered;
        }
        return false;
      }

      if ((crew as any)?.type === 'officer') {
        const role = (crew as any)?.role as unknown;
        if (role === 'senior_scientist') {
          return isBridgeOrSciLab && engineeringFunctional;
        }
        if (role === 'master_tactician') {
          return isDefense && engineeringFunctional;
        }
        return false;
      }

      return (
        (isBridgeOrSciLab && engineeringFunctional && engineeringFullyPowered) ||
        (isDefense && engineeringFullyPowered)
      );
    })();

    if (!canGenerate) {
      return 0;
    }
  }

  let power = 1;

  const location = (crew as any)?.location as ShipSection | null | undefined;
  if (
    location === DEFAULT_POWER_ROUTING_HUB_SECTION &&
    ShipUtils.isFullyPowered(ship, DEFAULT_POWER_ROUTING_HUB_SECTION)
  ) {
    power += 2;
  }

  power += getRestorePowerBonusForCrew(crew);

  return power;
}

/**
 * Find a path for power routing using conduit connections (not corridors)
 * Purpose: Determine if power can be routed from one section to another
 * Parameters:
 *   - ship: Current ship state
 *   - from: Starting section (usually Engineering)
 *   - to: Target section for power routing
 * Returns: Array of sections in path, or null if no path exists
 * Side effects: None (pure function)
 *
 * Note: Uses conduitConnections (power paths) not corridors (crew movement)
 */
function findRoutingPath(ship: Ship, from: ShipSection, to: ShipSection): ShipSection[] | null {
  if (from === to) {
    return [from];
  }

  const visited = new Set<ShipSection>();
  const queue: { section: ShipSection; path: ShipSection[] }[] = [];

  visited.add(from);
  queue.push({ section: from, path: [from] });

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const sectionState = ship.sections[current.section];
    if (!sectionState) {
      continue;
    }

    // Use conduitConnections for power routing, not corridors
    const conduitConnections = sectionState.conduitConnections ?? {};
    const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];

    for (const neighbor of sectionKeys) {
      if (neighbor === current.section) {
        continue;
      }

      // Check conduit connection (not corridor)
      const forward = conduitConnections[neighbor] ?? 0;
      const backward = ship.sections[neighbor]?.conduitConnections?.[current.section] ?? 0;
      const intactConduits = Math.min(forward, backward);
      if (intactConduits <= 0) {
        continue;
      }

      if (visited.has(neighbor)) {
        continue;
      }

      const nextPath = [...current.path, neighbor];

      if (neighbor === to) {
        return nextPath;
      }

      visited.add(neighbor);
      queue.push({ section: neighbor, path: nextPath });
    }
  }

  return null;
}

/**
 * SectionGridWithOverlay component
 * Purpose: Render the 2x3 section grid with corridor overlay lines behind the cards
 * Parameters:
 *   - ship: Current ship state
 *   - routingContext: Active power routing context (if any)
 *   - isExecutionPhase: Whether we're in execution phase
 *   - hasPendingRevive: Whether there's a pending revive action
 *   - ui: UI state from store
 *   - allCrew: All crew members including captain
 *   - updatePlannedActionParameters: Function to update action parameters
 *   - moveCrew: Function to move crew between sections
 */
function SectionGridWithOverlay({
  ship,
  routingContext,
  sectionDiffs,
  interactionMode,
  actingCrew,
  setExecutionConfirmed,
  setLastError,
  isExecutionPhase,
  ui,
  allCrew,
  installedUpgrades,
  onOpenUpgradeDetails,
  onChargeUpgrade,
  selectedUpgradeId,
  onCloseUpgradeDetails,
  updatePlannedActionParameters,
  updatePlannedActionTarget,
  moveCrew,
  explorerRepairKit,
}: {
  ship: Ship;
  routingContext: {
    crewId: string;
    sourceSection: ShipSection;
    restoredPower: number;
    allocations: Map<ShipSection, number>;
    totalAllocated: number;
  } | null;
  sectionDiffs: PlayerDiff['sectionDiffs'] | null;
  interactionMode: 'none' | 'move' | 'route_power' | 'repair';
  actingCrew: AnyCrew | Captain | null;
  setExecutionConfirmed: (confirmed: boolean) => void;
  setLastError: (message: string | null) => void;
  isExecutionPhase: boolean;
  ui: {
    selectedCrewId: string | null;
    selectedTargetId: string | null;
    plannedActions: Array<{
      crewId: string;
      type: string;
      target?: PlayerActionTarget | null;
      parameters?: Record<string, unknown>;
    }>;
    selectedActionSlot: 'primary' | 'bonus';
  };
  allCrew: (AnyCrew | Captain)[];
  installedUpgrades: UpgradeCard[];
  onOpenUpgradeDetails?: (upgradeId: string) => void;
  onChargeUpgrade?: (upgradeId: string, fromSection: ShipSection) => void;
  selectedUpgradeId: string | null;
  onCloseUpgradeDetails?: () => void;
  updatePlannedActionParameters: (
    crewId: string,
    params: Record<string, unknown>,
    slot?: 'primary' | 'bonus',
  ) => void;
  updatePlannedActionTarget: (
    crewId: string,
    target: PlayerActionTarget | null,
    slot?: 'primary' | 'bonus',
  ) => void;
  moveCrew: (crewId: string, section: ShipSection) => boolean;
  explorerRepairKit?: { section: ShipSection | null; used: boolean } | null;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridDimensions, setGridDimensions] = useState({ width: 0, height: 0 });
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const measureRafRef = useRef<number | null>(null);
  const [sectionRects, setSectionRects] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const [sectionMeasureNonce, setSectionMeasureNonce] = useState(0);

  const scheduleMeasure = useCallback(() => {
    if (measureRafRef.current !== null) {
      return;
    }

    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null;
      setSectionMeasureNonce((prev) => prev + 1);
    });
  }, []);

  const getPlannedActionSlot = (action: { parameters?: Record<string, unknown> } | null | undefined): 'primary' | 'bonus' => {
    const slotRaw = action?.parameters?.uiSlot as unknown;
    return slotRaw === 'bonus' ? 'bonus' : 'primary';
  };

  const findPlannedAction = (
    crewId: string | null | undefined,
    slot: 'primary' | 'bonus',
    type?: string,
  ) => {
    if (!crewId) {
      return undefined;
    }
    return ui.plannedActions.find((a) => {
      if (a.crewId !== crewId) {
        return false;
      }
      if (type !== undefined && a.type !== type) {
        return false;
      }
      return getPlannedActionSlot(a) === slot;
    });
  };

  const registerSectionRef = useCallback(
    (sectionKey: string) => (el: HTMLDivElement | null) => {
      const previous = sectionRefs.current[sectionKey];
      if (previous && resizeObserverRef.current) {
        resizeObserverRef.current.unobserve(previous);
      }

      sectionRefs.current[sectionKey] = el;

      if (el && resizeObserverRef.current) {
        resizeObserverRef.current.observe(el);
        scheduleMeasure();
      }
    },
    [scheduleMeasure],
  );

  const isRoutingModeActive =
    interactionMode === 'route_power' &&
    isExecutionPhase &&
    ui.selectedCrewId !== null &&
    !!routingContext;

  const predictedRestoreEdgeLoad = useMemo(() => {
    const edgeLoad = new Map<string, number>();
    const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);

    const crewById = new Map<string, AnyCrew | Captain>();
    for (const crew of allCrew) {
      crewById.set(crew.id, crew);
    }

    const recordEdge = (a: ShipSection, b: ShipSection, amount: number) => {
      if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
        return;
      }

      const left = a < b ? a : b;
      const right = a < b ? b : a;
      const key = `${left}|${right}`;
      const existing = edgeLoad.get(key);
      if (typeof existing === 'number' && Number.isFinite(existing)) {
        edgeLoad.set(key, existing + amount);
      } else {
        edgeLoad.set(key, amount);
      }
    };

    const recordPath = (path: ShipSection[], amount: number) => {
      if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
        return;
      }

      for (let i = 0; i < path.length - 1; i++) {
        recordEdge(path[i], path[i + 1], amount);
      }
    };

    for (const action of ui.plannedActions) {
      if (action.type !== 'restore') {
        continue;
      }

      const performer = crewById.get(action.crewId);
      const actingSection = (performer as any)?.location as ShipSection | null | undefined;
      const sourceSection =
        actingSection && validSections.has(actingSection) ? actingSection : null;

      const rawAllocations = (action.parameters as any)?.routeAllocations as
        | Array<{ section?: string; amount?: number }>
        | undefined;

      if (sourceSection && Array.isArray(rawAllocations)) {
        for (const entry of rawAllocations) {
          const sectionKey = entry.section as string | undefined;
          const amount = entry.amount as number | undefined;

          if (!(typeof sectionKey === 'string' && validSections.has(sectionKey as ShipSection))) {
            continue;
          }
          if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
            continue;
          }

          const target = sectionKey as ShipSection;
          if (target === sourceSection) {
            continue;
          }

          const path = findRoutingPath(ship, sourceSection, target);
          if (!path || path.length < 2) {
            continue;
          }

          recordPath(path, amount);
        }
      }

      const rawTransfers = (action.parameters as any)?.transfers as
        | Array<{ fromSection?: string; toSection?: string; toUpgradeId?: string; amount?: number }>
        | undefined;

      if (Array.isArray(rawTransfers)) {
        for (const entry of rawTransfers) {
          const fromSection = entry.fromSection as string | undefined;
          const toSection = entry.toSection as string | undefined;
          const toUpgradeId = (entry as any)?.toUpgradeId as string | undefined;
          const amount = entry.amount as number | undefined;

          if (typeof toUpgradeId === 'string' && toUpgradeId.length > 0) {
            if (!(typeof fromSection === 'string' && validSections.has(fromSection as ShipSection))) {
              continue;
            }
            if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
              continue;
            }

            const upgrade = installedUpgrades.find((u) => u.id === toUpgradeId);
            const upgradeSectionRaw = (upgrade as any)?.section as unknown;
            if (!(typeof upgradeSectionRaw === 'string' && validSections.has(upgradeSectionRaw as ShipSection))) {
              continue;
            }

            const from = fromSection as ShipSection;
            const upgradeSection = upgradeSectionRaw as ShipSection;
            const path = findRoutingPath(ship, from, upgradeSection);
            if (!path || path.length < 2) {
              continue;
            }

            recordPath(path, amount);
            continue;
          }

          if (!(typeof fromSection === 'string' && validSections.has(fromSection as ShipSection))) {
            continue;
          }
          if (!(typeof toSection === 'string' && validSections.has(toSection as ShipSection))) {
            continue;
          }
          if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
            continue;
          }

          const from = fromSection as ShipSection;
          const to = toSection as ShipSection;
          if (from === to) {
            continue;
          }

          const path = findRoutingPath(ship, from, to);
          if (!path || path.length < 2) {
            continue;
          }

          recordPath(path, amount);
        }
      }
    }

    return edgeLoad;
  }, [allCrew, installedUpgrades, ship, ui.plannedActions]);

  const applyingUpgradeIds = useMemo(() => {
    const applying = new Set<string>();
    const installedUpgradeIds = new Set(installedUpgrades.map((u) => u.id));
    const crewById = new Map<string, AnyCrew | Captain>();
    for (const crew of allCrew) {
      crewById.set(crew.id, crew);
    }

    const countsByCrewId = new Map<string, number>();
    for (const action of ui.plannedActions) {
      countsByCrewId.set(action.crewId, (countsByCrewId.get(action.crewId) ?? 0) + 1);
    }

    for (const count of countsByCrewId.values()) {
      if (count > 1) {
        if (installedUpgradeIds.has('cybernetics')) {
          applying.add('cybernetics');
        } else if (installedUpgradeIds.has('temporal_shift')) {
          applying.add('temporal_shift');
        }
        break;
      }
    }

    for (const action of ui.plannedActions) {
      const performer = crewById.get(action.crewId);
      const actingSection = (performer as any)?.location as ShipSection | null | undefined;
      const fromSection = typeof actingSection === 'string' ? (actingSection as ShipSection) : null;

      if (action.type === 'repair') {
        if (fromSection === SHIP_SECTIONS.ENGINEERING) {
          applying.add('repair_droids');
        }
        if (fromSection === SHIP_SECTIONS.MED_LAB) {
          applying.add('droid_station');
        }
      }

      if (action.type === 'restore') {
        if (fromSection === SHIP_SECTIONS.ENGINEERING) {
          applying.add('coolant');
        }
      }

      if (action.type === 'revive') {
        applying.add('nano_bots');
      }
    }

    return applying;
  }, [allCrew, installedUpgrades, ui.plannedActions]);

  const predictedRestoreOverloadedEdges = useMemo(() => {
    const overloaded = new Set<string>();

    for (const [edgeKey, load] of predictedRestoreEdgeLoad.entries()) {
      if (!(typeof load === 'number' && Number.isFinite(load) && load > 0)) {
        continue;
      }

      const [leftRaw, rightRaw] = edgeKey.split('|');
      const left = leftRaw as ShipSection;
      const right = rightRaw as ShipSection;

      const forward = ship.sections[left]?.conduitConnections?.[right] ?? 0;
      const backward = ship.sections[right]?.conduitConnections?.[left] ?? 0;
      const conduitsOnEdge = Math.min(forward, backward);
      if (conduitsOnEdge <= 0) {
        continue;
      }

      const safeCapacity = conduitsOnEdge * POWER_CONFIG.MAX_POWER_PER_CONDUIT;
      if (load > safeCapacity) {
        overloaded.add(edgeKey);
      }
    }

    return overloaded;
  }, [predictedRestoreEdgeLoad, ship.sections]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) {
      return;
    }

    const updateDimensions = () => {
      setGridDimensions({
        width: el.offsetWidth,
        height: el.offsetHeight,
      });

      scheduleMeasure();
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });

    resizeObserverRef.current = resizeObserver;
    resizeObserver.observe(el);

    for (const sectionKey of SECTION_LAYOUT.flat()) {
      const sectionEl = sectionRefs.current[sectionKey];
      if (sectionEl) {
        resizeObserver.observe(sectionEl);
      }
    }

    window.addEventListener('resize', updateDimensions);

    return () => {
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      window.removeEventListener('resize', updateDimensions);
      if (measureRafRef.current !== null) {
        cancelAnimationFrame(measureRafRef.current);
        measureRafRef.current = null;
      }
    };
  }, [scheduleMeasure]);

  useLayoutEffect(() => {
    if (!gridRef.current) return;
    const gridRect = gridRef.current.getBoundingClientRect();
    const rects: Record<string, { x: number; y: number; width: number; height: number }> = {};

    SECTION_LAYOUT.flat().forEach((sectionKey) => {
      const el = sectionRefs.current[sectionKey];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      rects[sectionKey] = {
        x: rect.left - gridRect.left,
        y: rect.top - gridRect.top,
        width: rect.width,
        height: rect.height,
      };
    });

    setSectionRects(rects);
  }, [gridDimensions, sectionMeasureNonce]);

  return (
    <div className="flex-1 relative">
      <ShipStructureOverlay
        ship={ship}
        gridWidth={gridDimensions.width}
        gridHeight={gridDimensions.height}
        sectionRects={sectionRects}
        predictedOverloadedConduitEdges={isRoutingModeActive ? predictedRestoreOverloadedEdges : null}
      />
      <div
        ref={gridRef}
        className="relative z-10 h-full grid grid-cols-3 gap-4 p-2"
      >
        {SECTION_LAYOUT.flat().map((sectionKey) => {
          const sectionState = ship.sections[sectionKey];

          const isRouteMode =
            interactionMode === 'route_power' &&
            isExecutionPhase &&
            ui.selectedCrewId !== null &&
            !!routingContext;

          const isMoveMode =
            interactionMode === 'move' &&
            isExecutionPhase &&
            ui.selectedCrewId !== null;

          const isRepairMode =
            interactionMode === 'repair' &&
            isExecutionPhase &&
            ui.selectedCrewId !== null;

          const routingAllocated = routingContext
            ? routingContext.allocations.get(sectionKey as ShipSection) ?? 0
            : 0;

          const routingPath =
            !!routingContext && !!sectionState
              ? findRoutingPath(ship, routingContext.sourceSection, sectionKey as ShipSection)
              : null;

          let minConduitsOnPath = 0;
          if (routingPath && routingPath.length > 1) {
            let min = Infinity;
            for (let i = 0; i < routingPath.length - 1; i++) {
              const from = routingPath[i];
              const to = routingPath[i + 1];
              const forward = ship.sections[from]?.conduitConnections?.[to] ?? 0;
              const backward = ship.sections[to]?.conduitConnections?.[from] ?? 0;
              const intact = Math.min(forward, backward);
              min = Math.min(min, intact);
            }
            minConduitsOnPath = Number.isFinite(min) && min !== Infinity ? min : 0;
          }

          const safeCapacity =
            !!routingContext && !!sectionState
              ? (routingPath && routingPath.length > 1
                  ? minConduitsOnPath * POWER_CONFIG.MAX_POWER_PER_CONDUIT
                  : routingContext.restoredPower)
              : 0;

          // Reachability for routing: section must have hull, at least one conduit, and a corridor path from Engineering
          // Conduits are required for routing - the soft limit is about EXCEEDING conduit capacity
          const reachableForRouting =
            !!routingContext &&
            !!sectionState &&
            sectionState.hull > 0 &&
            (routingPath ? routingPath.length === 1 || minConduitsOnPath > 0 : false);

          const canAllocateMoreFromBudget =
            !!routingContext &&
            routingContext.totalAllocated < routingContext.restoredPower;

          // Allow routing as long as section is reachable and we have power budget
          // Conduit capacity is a soft limit - exceeding it will damage conduits but is allowed
          const canRouteToSection = reachableForRouting && canAllocateMoreFromBudget;

          // Check if routing more power would exceed conduit safe capacity (soft limit)
          // Safe capacity = conduits * 3 power per conduit per turn
          // If exceeded, the conduit will be damaged but routing is still allowed
          const willOverload =
            !!routingContext &&
            !!sectionState &&
            safeCapacity > 0 &&
            (() => {
              if (!routingPath || routingPath.length < 2) {
                return false;
              }

              for (let i = 0; i < routingPath.length - 1; i++) {
                const fromSection: ShipSection = routingPath[i];
                const toSection: ShipSection = routingPath[i + 1];
                const left: ShipSection = fromSection < toSection ? fromSection : toSection;
                const right: ShipSection = fromSection < toSection ? toSection : fromSection;
                const edgeKey = `${left}|${right}`;

                const currentLoad = predictedRestoreEdgeLoad.get(edgeKey);
                const currentLoadSafe =
                  typeof currentLoad === 'number' && Number.isFinite(currentLoad)
                    ? currentLoad
                    : 0;

                const forward = ship.sections[left]?.conduitConnections?.[right];
                const backward = ship.sections[right]?.conduitConnections?.[left];

                const forwardSafe =
                  typeof forward === 'number' && Number.isFinite(forward) ? forward : 0;
                const backwardSafe =
                  typeof backward === 'number' && Number.isFinite(backward) ? backward : 0;

                const conduitsOnEdge = Math.min(forwardSafe, backwardSafe);
                if (conduitsOnEdge <= 0) {
                  continue;
                }

                const edgeSafeCapacity = conduitsOnEdge * POWER_CONFIG.MAX_POWER_PER_CONDUIT;
                if (currentLoadSafe + 1 > edgeSafeCapacity) {
                  return true;
                }
              }

              return false;
            })();

          const canMoveToSection = (() => {
            if (!isMoveMode || !actingCrew) {
              return false;
            }

            const actingCrewId = ui.selectedCrewId;
            const didMove = ui.plannedActions
              .filter((a) => a.crewId === actingCrewId)
              .some((a) => (a.parameters as any)?.movedThisExecution === true);
            if (didMove) {
              return false;
            }

            const from = actingCrew.location as ShipSection | null;
            if (!from) {
              return false;
            }

            if (from === (sectionKey as ShipSection)) {
              return false;
            }

            const corridorState = ship.sections[from]?.corridors?.[sectionKey as ShipSection] ?? 0;
            if (corridorState !== 1) {
              return false;
            }

            if (!sectionState || sectionState.hull <= 0) {
              return false;
            }

            return true;
          })();

          const canRepairSection = (() => {
            if (!isRepairMode || !actingCrew || ui.selectedCrewId === null) {
              return false;
            }

            const repairAction = ui.selectedCrewId
              ? findPlannedAction(ui.selectedCrewId, ui.selectedActionSlot, 'repair')
              : undefined;

            if (!repairAction) {
              return false;
            }

            const from = actingCrew.location as ShipSection | null;
            if (!from) {
              return false;
            }

            if (!sectionState) {
              return false;
            }

            const target = sectionKey as ShipSection;
            if (from === target) {
              return true;
            }

            // Repair adjacency is based on layout (CONNECTION_PAIRS), not on current intactness.
            // This allows repairing fully-broken conduits/corridors (state = 0).
            const connectionConfig = CONNECTION_PAIRS.find(
              (p) =>
                (p.sections[0] === from && p.sections[1] === target) ||
                (p.sections[0] === target && p.sections[1] === from),
            );

            if (!connectionConfig) {
              return false;
            }

            return connectionConfig.hasCorridor || connectionConfig.conduitCount > 0;
          })();

          const handleSelectAsMoveTarget = () => {
            if (!isExecutionPhase || ui.selectedCrewId === null) {
              return;
            }

            const activeCrewId = ui.selectedCrewId;

            const restoreAction = findPlannedAction(activeCrewId, ui.selectedActionSlot, 'restore');

            if (isRouteMode && routingContext && restoreAction && activeCrewId === routingContext.crewId) {
              if (!canRouteToSection) {
                if (sectionState && sectionState.hull <= 0) {
                  setLastError(
                    `Cannot route power to ${String(sectionKey)} because it has 0 hull. Fix: Repair hull to at least 1 first.`,
                  );
                  return;
                }

                if (routingPath && routingPath.length > 1 && minConduitsOnPath <= 0) {
                  setLastError(
                    `Cannot route power to ${String(sectionKey)} from ${String(routingContext.sourceSection)} because there are no intact conduits on the path. Fix: Repair conduits to create a continuous path.`,
                  );
                  return;
                }

                if (!routingPath) {
                  setLastError(
                    `Cannot route power to ${String(sectionKey)} from ${String(routingContext.sourceSection)} because no intact conduit path exists. Fix: Repair conduits to create a continuous path between sections.`,
                  );
                  return;
                }

                if (!canAllocateMoreFromBudget) {
                  setLastError(
                    `Cannot route more power because there is no remaining restored power to allocate. Root cause: allocated power equals total restored power. Fix: Clear allocations or leave the remaining power to deposit in ${String(routingContext.sourceSection)}.`,
                  );
                  return;
                }

                return;
              }

              setExecutionConfirmed(false);

              const existingRaw = (restoreAction.parameters as Record<string, unknown> | undefined)
                ?.routeAllocations as { section?: string; amount?: number }[] | undefined;

              const bySection = new Map<ShipSection, number>();

              if (existingRaw && Array.isArray(existingRaw)) {
                const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);

                for (const entry of existingRaw) {
                  const key = entry.section as string | undefined;
                  const amount = entry.amount as number | undefined;

                  if (
                    !key ||
                    !validSections.has(key as ShipSection) ||
                    typeof amount !== 'number' ||
                    !Number.isFinite(amount) ||
                    amount <= 0
                  ) {
                    continue;
                  }

                  const cast = key as ShipSection;
                  const previous = bySection.get(cast) ?? 0;
                  bySection.set(cast, previous + amount);
                }
              }

              const targetSection = sectionKey as ShipSection;

              if (targetSection === routingContext.sourceSection) {
                setLastError(
                  `No allocation needed for ${String(targetSection)}. Root cause: unallocated restored power automatically deposits in the restoring crew's current section (${String(routingContext.sourceSection)}). Fix: Allocate to other sections, or leave power unallocated to keep it here.`,
                );
                return;
              }

              const previousAmount = bySection.get(targetSection) ?? 0;
              const newAmount = previousAmount + 1;
              bySection.set(targetSection, newAmount);

              const nextAllocations: { section: ShipSection; amount: number }[] = [];

              for (const [s, amt] of bySection.entries()) {
                nextAllocations.push({ section: s, amount: amt });
              }

              updatePlannedActionParameters(
                activeCrewId,
                {
                  routeAllocations: nextAllocations,
                },
                restoreAction ? getPlannedActionSlot(restoreAction) : ui.selectedActionSlot,
              );

              return;
            }

            const repairAction = findPlannedAction(activeCrewId, ui.selectedActionSlot, 'repair');

            if (isRepairMode && repairAction) {
              if (!canRepairSection) {
                return;
              }

              setExecutionConfirmed(false);

              updatePlannedActionTarget(
                activeCrewId,
                {
                  section: sectionKey as ShipSection,
                },
                repairAction ? getPlannedActionSlot(repairAction) : ui.selectedActionSlot,
              );

              const existingRepairType = (repairAction.parameters as any)?.repairType as
                | string
                | undefined;

              if (!existingRepairType) {
                updatePlannedActionParameters(activeCrewId, {
                  repairType: 'hull',
                }, repairAction ? getPlannedActionSlot(repairAction) : ui.selectedActionSlot);
              }

              return;
            }

            if (!canMoveToSection) {
              return;
            }

            setExecutionConfirmed(false);

            const success = moveCrew(activeCrewId, sectionKey as ShipSection);

            if (success) {
              updatePlannedActionParameters(
                activeCrewId,
                {
                  movedThisExecution: true,
                },
                ui.selectedActionSlot,
              );
            }
          };

          return (
            <div
              key={sectionKey}
              ref={registerSectionRef(sectionKey)}
              className="h-full"
            >
              <SectionCard
                sectionKey={sectionKey as ShipSection}
                section={sectionState}
                ship={ship}
                installedUpgrades={installedUpgrades}
                crew={allCrew}
                sectionDiff={sectionDiffs ? sectionDiffs[sectionKey as ShipSection] : null}
                explorerRepairKit={explorerRepairKit}
                onOpenUpgradeDetails={onOpenUpgradeDetails}
                onChargeUpgrade={onChargeUpgrade}
                selectedUpgradeId={selectedUpgradeId}
                onCloseUpgradeDetails={onCloseUpgradeDetails}
                applyingUpgradeIds={applyingUpgradeIds}
                canSelectAsMoveTarget={
                  isRouteMode || (isMoveMode && canMoveToSection) || (isRepairMode && canRepairSection)
                }
                onSelectAsMoveTarget={
                  isRouteMode || (isMoveMode && canMoveToSection) || (isRepairMode && canRepairSection)
                    ? handleSelectAsMoveTarget
                    : undefined
                }
                isRoutingMode={isRouteMode && !!routingContext}
                isRoutingTarget={isRouteMode && reachableForRouting}
                isMoveTarget={isMoveMode && canMoveToSection}
                isRepairTarget={isRepairMode && canRepairSection}
                allocatedPower={routingContext ? routingAllocated : 0}
                safeCapacity={routingContext ? safeCapacity : 0}
                willOverload={routingContext ? willOverload : false}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Render a crew token
 */
function CrewToken({
  crew,
  isReviveTarget,
  canSelectReviveTarget,
  reviveBlockedReason,
  onSelectReviveTarget,
  isStimDoctor,
  canSelectStimDoctor,
  onSelectStimDoctor,
  isSelectedForMove,
  onSelectForMove,
}: {
  crew: AnyCrew | Captain;
  isReviveTarget?: boolean;
  canSelectReviveTarget?: boolean;
  reviveBlockedReason?: string;
  onSelectReviveTarget?: () => void;
  isStimDoctor?: boolean;
  canSelectStimDoctor?: boolean;
  onSelectStimDoctor?: () => void;
  isSelectedForMove?: boolean;
  onSelectForMove?: () => void;
}) {
  const role = getCrewRole(crew);
  const color = CREW_ROLE_COLORS[role] ?? 'bg-gray-500';
  const isUnconscious = crew.status === 'unconscious';

  const assembleProgress =
    typeof (crew as { assembleProgress?: unknown }).assembleProgress === 'number' &&
    Number.isFinite((crew as { assembleProgress: number }).assembleProgress)
      ? (crew as { assembleProgress: number }).assembleProgress
      : 0;

  const assembleItemType =
    typeof (crew as { assembleItemType?: unknown }).assembleItemType === 'string'
      ? (crew as { assembleItemType: string }).assembleItemType
      : null;

  const assembleProgressByItemTypeRaw = (crew as { assembleProgressByItemType?: unknown })
    .assembleProgressByItemType;

  let displayAssembleProgress = assembleProgress;
  let displayAssembleItemType: string | null = assembleItemType;

  if (
    !(displayAssembleItemType && displayAssembleProgress > 0) &&
    assembleProgressByItemTypeRaw &&
    typeof assembleProgressByItemTypeRaw === 'object'
  ) {
    for (const [key, value] of Object.entries(assembleProgressByItemTypeRaw as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        continue;
      }
      if (!displayAssembleItemType || value > displayAssembleProgress) {
        displayAssembleItemType = key;
        displayAssembleProgress = value;
      }
    }
  }

  const showAssembleProgress =
    crew.status === 'active' && displayAssembleProgress > 0 && displayAssembleItemType !== null;

  // Get abbreviation
  const abbrev = getCrewAbbrev(role);

  const tooltipTitle = buildCrewTokenTooltipTitle({
    crew,
    role,
    showAssembleProgress,
    displayAssembleItemType,
    displayAssembleProgress,
  });

  const clickableRevive = !!canSelectReviveTarget && !!onSelectReviveTarget;
  const clickableStimDoctor = !!canSelectStimDoctor && !!onSelectStimDoctor;
  const clickableMove = !!onSelectForMove;
  const clickable = clickableRevive || clickableStimDoctor || clickableMove;

  return (
    <div
      className={`crew-token relative ${color} ${isUnconscious ? 'opacity-50 grayscale' : ''} ${
        clickable ? 'cursor-pointer' : 'cursor-default hover:scale-100'
      } ${isReviveTarget ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-slate-900' : ''} ${
        isStimDoctor && !isReviveTarget ? 'ring-2 ring-fuchsia-400 ring-offset-2 ring-offset-slate-900' : ''
      } ${
        isSelectedForMove && !isReviveTarget && !isStimDoctor
          ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-slate-900'
          : ''
      }`}
      title={tooltipTitle}
      onClick={
        clickable
          ? clickableRevive
            ? onSelectReviveTarget
            : clickableStimDoctor
              ? onSelectStimDoctor
              : onSelectForMove
          : undefined
      }
    >
      <span className="relative z-10">{abbrev}</span>
      {isUnconscious && crew.reviveProgress > 0 && (
        <span className="absolute -bottom-1 -right-1 z-20 rounded border border-green-400 bg-green-950/90 px-0.5 text-[9px] font-bold text-green-200">
          {crew.reviveProgress}/{CREW_CONFIG.REVIVE_THRESHOLD}
        </span>
      )}
      {reviveBlockedReason && canSelectReviveTarget === false && (
        <span className="absolute -top-1 -right-1 z-20 rounded border border-amber-400 bg-amber-950/90 px-0.5 text-[9px] font-bold text-amber-200">
          {reviveBlockedReason}
        </span>
      )}
      {showAssembleProgress && (
        <span className="absolute -bottom-1 -left-1 z-20 rounded border border-amber-400 bg-amber-950/90 px-0.5 text-[9px] font-bold text-amber-200">
          {displayAssembleProgress}/{CREW_CONFIG.ASSEMBLE_THRESHOLD}
        </span>
      )}
    </div>
  );
}

/**
 * Resource display
 */
function ResourceDisplay({ resources }: { resources: PlayerResources }) {
  const resourceConfig: Array<{ key: ResourceType; label: string; icon: string; color: string }> = [
    { key: 'spare_parts', label: 'Parts', icon: '⬡', color: 'text-resource-spare-parts' },
    { key: 'power_cell', label: 'Power', icon: '⚡', color: 'text-blue-400' },
    { key: 'medical_kit', label: 'Med-Kit', icon: '✚', color: 'text-resource-med-kit' },
    { key: 'torpedo', label: 'Torps', icon: '▲', color: 'text-resource-torpedo' },
    { key: 'probe', label: 'Probes', icon: '◆', color: 'text-resource-probe' },
    { key: 'fuel_cell', label: 'Fuel', icon: 'F', color: 'text-emerald-200' },
    { key: 'antimatter', label: 'Anti', icon: 'A', color: 'text-fuchsia-200' },
    { key: 'energy_weapon', label: 'E-Weap', icon: 'E', color: 'text-amber-200' },
    { key: 'particle_weapon', label: 'P-Weap', icon: 'P', color: 'text-sky-200' },
    { key: 'phased_weapon', label: 'Φ-Weap', icon: 'Φ', color: 'text-purple-200' },
    { key: 'phased_shielding', label: 'Φ-Shld', icon: 'Φ', color: 'text-purple-200' },
  ];

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
      {resourceConfig.map((res) => (
        <div key={res.key} className="flex items-center gap-1" title={res.label}>
          <span className={`text-lg ${res.color}`}>{res.icon}</span>
          <span className="text-sm font-bold">{resources[res.key] ?? 0}</span>
        </div>
      ))}
    </div>
  );

}

/**
 * Shield tracker
 */
function ShieldTracker({ ship, board }: { ship: Ship; board: Board }) {
  const maxShields = 18;
  const maxSpeed = Math.max(6, board.rings.reduce((acc, ring) => Math.max(acc, ring.speedRequirement), 0));
  const speedRequirement = board.rings[ship.position.ring - 1]?.speedRequirement ?? null;

  return (
    <ShipStatusMeters
      shields={ship.shields}
      maxShields={maxShields}
      speed={ship.speed}
      maxSpeed={maxSpeed}
      speedRequirement={speedRequirement}
    />
  );
}

export function ShipDashboard() {
  const {
    game,
    currentPlayerId,
    ui,
    toggleRoster,
    addPlannedAction,
    updatePlannedActionParameters,
    removePlannedAction,
    clearPlannedActions,
    updatePlannedActionTarget,
    selectTarget,
    selectCrew,
    selectActionSlot,
    moveCrew,
    setExecutionConfirmed,
    setLastError,
    playTurn,
    assignExplorerRepairKit,
    chooseSpacePirateStartingUpgrade,
  } = useGameStore();

  const [interactionMode, setInteractionMode] = useState<'none' | 'move' | 'route_power' | 'repair'>(
    'none',
  );

  const [clearConfirm, setClearConfirm] = useState<
    | { kind: 'single'; crewId: string; slot: 'primary' | 'bonus' }
    | { kind: 'all' }
    | null
  >(null);

  const [shouldPulseBanner, setShouldPulseBanner] = useState(false);
  const [isUpgradesOpen, setIsUpgradesOpen] = useState(false);
  const [upgradeDetailsId, setUpgradeDetailsId] = useState<string | null>(null);
  const pulseTimeoutRef = useRef<number | null>(null);
  const lastExecutionTurnRef = useRef<number | null>(null);

  const player = currentPlayerId ? game?.players.get(currentPlayerId) : null;

  if (!player) {
    return (
      <div className="p-4 text-center text-gravity-muted">
        No player selected
      </div>
    );
  }

  if (!game) {
    return (
      <div className="p-4 text-center text-gravity-muted">
        No game loaded
      </div>
    );
  }

  const { ship, crew, captain, resources } = player;
  const boardState = game.board;

  const isExecutionPhase =
    game.status === 'in_progress' && game.turnPhase === 'action_execution';

  const explorerNeedsRepairKitPlacement =
    game.status === 'in_progress' &&
    captain.captainType === 'explorer' &&
    !!player.explorerRepairKit &&
    player.explorerRepairKit.used === false &&
    player.explorerRepairKit.section === null;

  const damagedSectionsForRepairKit = (Object.values(SHIP_SECTIONS) as ShipSection[]).filter((sectionKey) => {
    const state = ship.sections[sectionKey];
    const maxHull = CORE_SECTION_CONFIG[sectionKey]?.maxHull ?? state.hull;
    return state.hull < maxHull;
  });

  const spacePirateNeedsStartingUpgradeChoice =
    game.status === 'in_progress' &&
    captain.captainType === 'space_pirate' &&
    Array.isArray(player.spacePirateStartingUpgradeOptions) &&
    player.spacePirateStartingUpgradeOptions.length > 0;

  // Combine captain and crew for display
  const allCrew = [captain, ...crew];

  const advancedCrew = crew.filter((c) => (c as any)?.type === 'officer');
  const basicCrew = crew.filter((c) => (c as any)?.type === 'basic');

  const baseLifeSupportPower = (() => {
    const baseLifeSupportPowerRaw = ship.lifeSupportPower;
    return typeof baseLifeSupportPowerRaw === 'number' &&
      Number.isFinite(baseLifeSupportPowerRaw) &&
      baseLifeSupportPowerRaw > 0
      ? baseLifeSupportPowerRaw
      : 0;
  })();

  const totalLifeSupportPower = (() => {
    let value = baseLifeSupportPower;

    if (captain.captainType === 'explorer') {
      value += 5;
    }

    const bioFilters = player.installedUpgrades.find((u) => u.id === 'bio_filters');
    if (bioFilters) {
      const status = getUpgradePowerStatus(bioFilters, ship);
      if (status.isPowered) {
        value += 3;
      }
    }

    const bioEngine = player.installedUpgrades.find((u) => u.id === 'bio_engine');
    if (bioEngine) {
      const status = getUpgradePowerStatus(bioEngine, ship);
      if (status.isPowered) {
        value += 1;
      }
    }

    return value;
  })();

  const crewRequiringLifeSupport = crew.filter((c) => CrewUtils.requiresLifeSupport(c));
  const crewRequiringLifeSupportCount = crewRequiringLifeSupport.length;
  const captainActive = captain.status === 'active';

  const powerPerCrewSetting = LIFE_SUPPORT_CONFIG?.POWER_PER_CREW;
  const powerPerCrew =
    typeof powerPerCrewSetting === 'number' && Number.isFinite(powerPerCrewSetting) && powerPerCrewSetting > 0
      ? powerPerCrewSetting
      : 1;

  const fallbackLifeSupportCapacity = Math.max(0, Math.floor(totalLifeSupportPower / powerPerCrew));

  const lifeSupportCapacity = useMemo(() => {
    try {
      return computeLifeSupportCapacity(player);
    } catch (error) {
      console.error('Failed to compute life support capacity in ShipDashboard', error);
      return fallbackLifeSupportCapacity;
    }
  }, [player, fallbackLifeSupportCapacity]);

  const projectedLifeSupportLoad = useMemo(() => {
    try {
      return countLifeSupportConsumersWithRevives(player, ui.plannedActions);
    } catch (error) {
      console.error('Failed to evaluate life support load from planned actions', error);
      return crewRequiringLifeSupportCount + (captainActive ? 1 : 0);
    }
  }, [player, ui.plannedActions, crewRequiringLifeSupportCount, captainActive]);

  const lifeSupportCapacitySafe = Math.max(0, lifeSupportCapacity);
  const lifeSupportLoad = Math.max(0, projectedLifeSupportLoad);
  const overCapacity = lifeSupportCapacitySafe > 0 ? lifeSupportLoad > lifeSupportCapacitySafe : lifeSupportLoad > 0;
  const lifeSupportRatio =
    lifeSupportCapacitySafe > 0
      ? Math.min(lifeSupportLoad, lifeSupportCapacitySafe) / lifeSupportCapacitySafe
      : 0;
  const reviveCapacityHeadroom = Math.max(0, lifeSupportCapacitySafe - lifeSupportLoad);

  const contributionLines = (() => {
    const lines = [`Base Pool: ${baseLifeSupportPower} power`];

    if (captain.captainType === 'explorer') {
      lines.push('Explorer: +5 power');
    }

    const bioFilters = player.installedUpgrades.find((u) => u.id === 'bio_filters');
    if (bioFilters) {
      const status = getUpgradePowerStatus(bioFilters, ship);
      if (status.isPowered) {
        lines.push('Bio-Filters: +3 power');
      } else {
        lines.push('Bio-Filters: +3 power (unpowered)');
      }
    }

    const bioEngine = player.installedUpgrades.find((u) => u.id === 'bio_engine');
    if (bioEngine) {
      const status = getUpgradePowerStatus(bioEngine, ship);
      if (status.isPowered) {
        lines.push('Bio-Engine: +1 power');
      } else {
        lines.push('Bio-Engine: +1 power (unpowered)');
      }
    }

    lines.push(`Total Life Support Power: ${totalLifeSupportPower} power`);
    lines.push(`Power per crew slot: ${powerPerCrew} power`);
    lines.push(`Converted Capacity: ${lifeSupportCapacitySafe} crew`);

    return lines;
  })();

  const lifeSupportTooltipBase =
    'Life support converts stored power (plus any bonuses) into crew capacity. ' +
    `Current conversion rate: ${powerPerCrew} power per crew slot. ` +
    'If projected crew (including pending Revives) exceed capacity, excess crew fall unconscious at end of turn.';

  const lifeSupportTooltip =
    lifeSupportTooltipBase +
    `\n\nProjected load: ${lifeSupportLoad}/${lifeSupportCapacitySafe} crew.` +
    (contributionLines.length
      ? '\n\nCurrent sources:\n' + contributionLines.join('\n')
      : '\n\nCurrent sources:\nNone (life support pool is empty).');

  const hazardPressure = useMemo(() => {
    if (!boardState) {
      return { totalHull: 0, totalLifeSupport: 0, contributors: [] as HazardContributor[] };
    }

    const hazardObjects = boardState.objects.filter((obj) => obj.type === 'hazard');
    const contributors: HazardContributor[] = [];
    let totalHull = 0;
    let totalLifeSupport = 0;

    for (const hazard of hazardObjects) {
      const distance = BoardUtils.calculateDistance(ship.position, hazard.position, boardState);
      if (distance <= HAZARD_CONFIG.range) {
        contributors.push({ id: hazard.id, ring: hazard.position.ring, space: hazard.position.space, distance });
        totalHull += HAZARD_CONFIG.damage;
        totalLifeSupport += HAZARD_CONFIG.lifeSupportReduction;
      }
    }

    return {
      totalHull,
      totalLifeSupport,
      contributors,
    };
  }, [boardState, ship.position]);

  const hazardLifeSupportPowerLoss = hazardPressure.totalLifeSupport;
  const hazardHullDamage = hazardPressure.totalHull;
  const hazardCrewSlotsImpact = powerPerCrew > 0 ? hazardLifeSupportPowerLoss / powerPerCrew : 0;
  const hazardCrewSlotsImpactLabel = hazardCrewSlotsImpact > 0
    ? hazardCrewSlotsImpact >= 1
      ? Math.round(hazardCrewSlotsImpact).toString()
      : hazardCrewSlotsImpact.toFixed(1)
    : '0';

  const executionPreviewSectionDiffs = useMemo((): Record<ShipSection, SectionDiff> | null => {
    if (!game || !currentPlayerId || !isExecutionPhase) {
      return null;
    }

    const currentPlayer = game.players.get(currentPlayerId);
    if (!currentPlayer || currentPlayer.status !== 'active') {
      return null;
    }

    const actionsByPlayer: Record<string, PlayerAction[]> = {};
    for (const [playerId, state] of game.players.entries()) {
      if (state.status !== 'active') {
        continue;
      }
      actionsByPlayer[playerId] = [];
    }

    const safeActions: PlayerAction[] = [];
    for (const action of ui.plannedActions) {
      if (action.playerId !== currentPlayerId) {
        continue;
      }

      if (!isNonEmptyString(action.crewId)) {
        continue;
      }
      if (!isNonEmptyString(action.type)) {
        continue;
      }

      const targetObjectId = (action.target as any)?.objectId as unknown;
      const targetSection = (action.target as any)?.section as unknown;
      const parameters = (action.parameters ?? {}) as Record<string, unknown>;

      const stimmed = parameters.stimmed === true;
      const stimDoctorId = (parameters as any).stimDoctorId as unknown;
      if (stimmed && !isNonEmptyString(stimDoctorId)) {
        continue;
      }

      if (action.type === 'revive') {
        const targetCrewId = (parameters as any).targetCrewId as unknown;
        if (!isNonEmptyString(targetCrewId)) {
          continue;
        }
      }

      if (action.type === 'repair') {
        const repairType = (parameters as any).repairType as unknown;
        if (!isNonEmptyString(targetSection)) {
          continue;
        }
        if (repairType !== 'hull' && repairType !== 'conduit' && repairType !== 'corridor') {
          continue;
        }
      }

      if (action.type === 'scan' || action.type === 'acquire' || action.type === 'attack') {
        if (!isNonEmptyString(targetObjectId)) {
          continue;
        }
      }

      if (action.type === 'launch') {
        const launchType = (parameters as any).launchType as unknown;
        if (!isNonEmptyString(targetObjectId)) {
          continue;
        }
        if (launchType !== 'torpedo' && launchType !== 'probe') {
          continue;
        }
      }

      if (action.type === 'route') {
        const sourceSection = (parameters as any).sourceSection as unknown;
        const destinationSection = (parameters as any).targetSection as unknown;
        const amount = (parameters as any).amount as unknown;
        if (!isNonEmptyString(sourceSection) || !isNonEmptyString(destinationSection)) {
          continue;
        }
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
          continue;
        }
      }

      if (action.type === 'maneuver') {
        const direction = (parameters as any).direction as unknown;
        const powerSpent = (parameters as any).powerSpent as unknown;
        if (!isNonEmptyString(direction)) {
          continue;
        }
        if (typeof powerSpent !== 'number' || !Number.isFinite(powerSpent) || powerSpent < 1) {
          continue;
        }
      }

      if (action.type === 'assemble') {
        const itemType = (parameters as any).itemType as unknown;
        if (!isNonEmptyString(itemType)) {
          continue;
        }
      }

      if (action.type === 'integrate') {
        const upgradeId = (parameters as any).upgradeId as unknown;
        if (!isNonEmptyString(upgradeId)) {
          continue;
        }
      }

      safeActions.push({
        playerId: currentPlayerId,
        crewId: action.crewId,
        type: action.type,
        target: action.target ?? null,
        parameters: action.parameters,
      });
    }

    actionsByPlayer[currentPlayerId] = safeActions;

    try {
      const previewGame = applyPlayerActions(game, actionsByPlayer);
      const previewPlayer = previewGame.players.get(currentPlayerId);
      if (!previewPlayer || previewPlayer.status !== 'active') {
        return null;
      }

      const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
      const sectionDiffs: Record<ShipSection, SectionDiff> = {} as Record<ShipSection, SectionDiff>;

      for (const key of sectionKeys) {
        const prev = currentPlayer.ship.sections[key];
        const next = previewPlayer.ship.sections[key];

        const prevHull = prev?.hull ?? 0;
        const nextHull = next?.hull ?? 0;

        const prevPower = (prev?.powerDice ?? []).reduce((sum, die) => sum + die, 0);
        const nextPower = (next?.powerDice ?? []).reduce((sum, die) => sum + die, 0);

        const prevConduits = Object.values(prev?.conduitConnections ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
        const nextConduits = Object.values(next?.conduitConnections ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);

        const prevCorridors = Object.values(prev?.corridors ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);
        const nextCorridors = Object.values(next?.corridors ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);

        sectionDiffs[key] = {
          hullDelta: nextHull - prevHull,
          powerDelta: nextPower - prevPower,
          conduitsDelta: nextConduits - prevConduits,
          corridorsDelta: nextCorridors - prevCorridors,
        };
      }

      return sectionDiffs;
    } catch {
      return null;
    }
  }, [currentPlayerId, game, isExecutionPhase, ui.plannedActions]);

  const getPlannedActionSlot = (action: PlayerAction | null | undefined): 'primary' | 'bonus' => {
    const slotRaw = (action?.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown;
    return slotRaw === 'bonus' ? 'bonus' : 'primary';
  };

  const findPlannedAction = (
    crewId: string | null | undefined,
    slot: 'primary' | 'bonus',
    type?: PlayerAction['type'],
  ): PlayerAction | undefined => {
    if (!crewId) {
      return undefined;
    }
    return ui.plannedActions.find((a) => {
      if (a.crewId !== crewId) {
        return false;
      }
      if (type !== undefined && a.type !== type) {
        return false;
      }
      return getPlannedActionSlot(a) === slot;
    });
  };

  // Selected crew state (used for both revive targeting and crew placement)
  const actingReviverId = ui.selectedCrewId;
  const reviveAction = findPlannedAction(actingReviverId, ui.selectedActionSlot, 'revive');
  const currentReviveTargetId = reviveAction?.parameters?.targetCrewId as string | undefined;
  const hasPendingRevive = !!reviveAction;
  const reviveNeedsTarget = hasPendingRevive && !currentReviveTargetId;

  const reviveActions = ui.plannedActions.filter((a) => a.type === 'revive');
  const restoreActions = ui.plannedActions.filter((a) => a.type === 'restore');
  const scanActions = ui.plannedActions.filter((a) => a.type === 'scan');
  const acquireActions = ui.plannedActions.filter((a) => a.type === 'acquire');
  const attackActions = ui.plannedActions.filter((a) => a.type === 'attack');

  const getReviveCapacityStatus = (crewMember: AnyCrew | Captain): { canSelect: boolean; blockedReason?: string } => {
    if (!hasPendingRevive) {
      return { canSelect: false };
    }
    if (crewMember.status !== 'unconscious') {
      return { canSelect: false, blockedReason: 'Only unconscious crew can be revived.' };
    }

    const alreadySelected = crewMember.id === currentReviveTargetId;
    const hasHeadroom = reviveCapacityHeadroom > 0;
    if (!hasHeadroom && !alreadySelected) {
      return { canSelect: false, blockedReason: 'No life support capacity remaining for additional revives.' };
    }

    return { canSelect: true };
  };

  const handleChargeUpgrade = useCallback(
    (upgradeId: string, fromSection: ShipSection) => {
      if (!isExecutionPhase) {
        setLastError('Cannot charge upgrades right now. Fix: Charge upgrades during the Action Execution phase.');
        return;
      }

      const upgrade = player.installedUpgrades.find((u) => u.id === upgradeId);
      if (!upgrade) {
        setLastError('Cannot charge upgrade because it is not installed. Fix: Install the upgrade first.');
        return;
      }

      const status = getUpgradePowerStatus(upgrade, ship);
      if (status.upgradePowerRequired <= 0) {
        return;
      }

      const missing = Math.max(0, status.upgradePowerRequired - status.storedPower);
      if (missing <= 0) {
        setUpgradeDetailsId(upgradeId);
        return;
      }

      const maxPerAction = POWER_CONFIG.MAX_POWER_PER_CONDUIT;
      const desiredAmount = Math.min(maxPerAction, missing);

      const crewById = new Map<string, AnyCrew | Captain>();
      for (const c of [captain, ...crew]) {
        crewById.set(c.id, c);
      }

      const candidates = [captain, ...crew].filter((c) => c.status === 'active');

      const selectedCrew = ui.selectedCrewId ? crewById.get(ui.selectedCrewId) : undefined;

      const preferredCrewId = selectedCrew && selectedCrew.status === 'active' ? selectedCrew.id : null;

      const crewId = preferredCrewId ?? candidates[0]?.id ?? null;
      if (!crewId) {
        setLastError(
          'Cannot charge upgrade because there is no active crew available. Fix: Ensure at least one crew member (or the captain) is active during Action Execution.',
        );
        return;
      }

      const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
      const performer = crewById.get(crewId);
      const performerLoc = (performer as any)?.location as ShipSection | null | undefined;
      const spendFromSection =
        performerLoc && validSections.has(performerLoc)
          ? performerLoc
          : validSections.has(fromSection)
            ? fromSection
            : DEFAULT_POWER_ROUTING_HUB_SECTION;

      const crewActions = ui.plannedActions.filter((a) => a.crewId === crewId);
      const restoreActionForCrew = crewActions.find((a) => a.type === 'restore');
      const blockingNonRestoreAction = crewActions.find((a) => a.type !== 'restore');
      if (!restoreActionForCrew && blockingNonRestoreAction) {
        setLastError(
          'Cannot charge upgrade because the selected crew already has a different planned action. ' +
            `Root cause: crew "${crewId}" has planned action type "${blockingNonRestoreAction.type}". ` +
            'Fix: Clear that action first or choose a different crew member to perform Restore.',
        );
        return;
      }

      setExecutionConfirmed(false);
      selectCrew(crewId);
      if (interactionMode !== 'route_power') {
        setInteractionMode('route_power');
      }

      const restoreAction = restoreActionForCrew;

      const rawTransfers = (restoreAction?.parameters as any)?.transfers as
        | Array<{ fromSection?: string; toSection?: string; toUpgradeId?: string; amount?: number }>
        | undefined;
      const transfers = Array.isArray(rawTransfers) ? rawTransfers.filter((t) => t && typeof t === 'object') : [];

      const existingUpgradeLoad = transfers.reduce((sum, entry) => {
        const toUpgradeId = (entry as any)?.toUpgradeId as unknown;
        const amount = (entry as any)?.amount as unknown;
        if (toUpgradeId !== upgradeId) {
          return sum;
        }
        if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) {
          return sum;
        }
        return sum + amount;
      }, 0);

      const remainingBudget = Math.max(0, maxPerAction - existingUpgradeLoad);
      const amount = Math.min(desiredAmount, remainingBudget);
      if (amount <= 0) {
        setLastError(
          `Cannot charge upgrade any further this action. Root cause: upgrade transfers are capped at ${maxPerAction} power per action. Fix: Execute this turn and charge again next turn.`,
        );
        return;
      }

      const nextTransfers = [...transfers, { fromSection: spendFromSection, toUpgradeId: upgradeId, amount } as any];

      if (!restoreAction) {
        addPlannedAction({
          playerId: currentPlayerId,
          crewId,
          type: 'restore',
          parameters: {
            transfers: nextTransfers,
          },
        } as any);
        return;
      }

      updatePlannedActionParameters(crewId, { transfers: nextTransfers as any }, getPlannedActionSlot(restoreAction));
    },
    [
      addPlannedAction,
      captain,
      crew,
      currentPlayerId,
      getPlannedActionSlot,
      interactionMode,
      isExecutionPhase,
      player.installedUpgrades,
      selectCrew,
      setExecutionConfirmed,
      setInteractionMode,
      setLastError,
      setUpgradeDetailsId,
      ship,
      ui.plannedActions,
      ui.selectedCrewId,
      updatePlannedActionParameters,
    ],
  );
  const allRevivesTargeted = reviveActions.every((a) => {
    const targetCrewId = (a.parameters as any)?.targetCrewId as unknown;
    return (
      typeof targetCrewId === 'string' &&
      targetCrewId.length > 0
    );
  });

  useEffect(() => {
    if (!isExecutionPhase) {
      return;
    }

    const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
    const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);
    let didChange = false;
    let didChangeTransfers = false;

    for (const action of ui.plannedActions) {
      if (action.type !== 'restore') {
        continue;
      }

      const performer = [captain, ...crew].find((c) => c.id === action.crewId);
      const restoredPower = performer ? getRestorePowerForCrew(performer, ship) : 0;

      const rawAllocations = (action.parameters as any)
        ?.routeAllocations as { section?: string; amount?: number }[] | undefined;

      if (Array.isArray(rawAllocations)) {
        const filtered = rawAllocations.filter((entry) => {
          const key = entry.section as string | undefined;
          const amount = entry.amount as number | undefined;
          if (!key || !validSections.has(key as ShipSection)) {
            return false;
          }
          if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
            return false;
          }
          const sectionState = ship.sections[key as ShipSection];
          return !!sectionState && sectionState.hull > 0;
        });

        const totalRequested = filtered.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
        const nextAllocations = restoredPower <= 0 ? [] : filtered;

        if (nextAllocations.length !== rawAllocations.length || (restoredPower <= 0 && totalRequested > 0)) {
          didChange = true;
          updatePlannedActionParameters(
            action.crewId,
            {
              routeAllocations: nextAllocations as any,
            },
            getPlannedActionSlot(action),
          );
        }
      }

      const rawTransfers = (action.parameters as any)?.transfers as
        | Array<{ fromSection?: string; toSection?: string; toUpgradeId?: string; amount?: number }>
        | undefined;

      if (!rawTransfers || !Array.isArray(rawTransfers)) {
        continue;
      }

      const filteredTransfers = rawTransfers.filter((entry) => {
        const fromSection = entry.fromSection as string | undefined;
        const toSection = entry.toSection as string | undefined;
        const toUpgradeId = (entry as any)?.toUpgradeId as string | undefined;
        const amount = entry.amount as number | undefined;

        if (!fromSection || !validSections.has(fromSection as ShipSection)) {
          return false;
        }
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
          return false;
        }

        const fromState = ship.sections[fromSection as ShipSection];
        if (!fromState || fromState.hull <= 0) {
          return false;
        }

        if (typeof toUpgradeId === 'string' && toUpgradeId.length > 0) {
          return true;
        }

        if (!toSection) {
          return false;
        }

        if (toSection === LIFE_SUPPORT_ROUTE_KEY) {
          return true;
        }

        if (!validSections.has(toSection as ShipSection)) {
          return false;
        }

        const toState = ship.sections[toSection as ShipSection];
        return !!toState && toState.hull > 0;
      });

      if (filteredTransfers.length !== rawTransfers.length) {
        didChangeTransfers = true;
        updatePlannedActionParameters(
          action.crewId,
          {
            transfers: filteredTransfers as any,
          },
          getPlannedActionSlot(action),
        );
      }
    }

    if (didChange || didChangeTransfers) {
      setExecutionConfirmed(false);
      setLastError(
        'Removed invalid Restore allocations/transfers. Root cause: power cannot be routed to/from destroyed sections, and restore allocations require generated power. Fix: Repair hull to at least 1 before routing/transferring power, and remove allocations for crews that generate 0 power.',
      );
    }
  }, [isExecutionPhase, setExecutionConfirmed, setLastError, ship.sections, ui.plannedActions, updatePlannedActionParameters]);

  const firstReviveNeedingTargetCrewId = reviveActions.find((a) => {
    const targetCrewId = (a.parameters as any)?.targetCrewId as unknown;
    const needsTarget = !(typeof targetCrewId === 'string' && targetCrewId.length > 0);
    return needsTarget;
  })?.crewId ?? null;

  const firstReviveNeedingTargetSlot = (() => {
    const action = reviveActions.find((a) => {
      const targetCrewId = (a.parameters as any)?.targetCrewId as unknown;
      return !(typeof targetCrewId === 'string' && targetCrewId.length > 0);
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  const repairActions = ui.plannedActions.filter((a) => a.type === 'repair');
  const allRepairsTargeted = repairActions.every(
    (a) => !!a.target?.section && !!(a.parameters as any)?.repairType,
  );

  const firstRepairNeedingTargetCrewId = repairActions.find(
    (a) => !a.target?.section || !(a.parameters as any)?.repairType,
  )?.crewId ?? null;

  const firstRepairNeedingTargetSlot = (() => {
    const action = repairActions.find((a) => !a.target?.section || !(a.parameters as any)?.repairType);
    return action ? getPlannedActionSlot(action) : null;
  })();

  const boardTargetActions = ui.plannedActions.filter(
    (a) => a.type === 'scan' || a.type === 'acquire' || a.type === 'attack',
  );

  const allBoardTargetsSelected = boardTargetActions.every((a) => {
    const objectId = a.target?.objectId;
    if (typeof objectId !== 'string' || objectId.length === 0) {
      return false;
    }

    return true;
  });

  const firstBoardTargetNeedingCrewId = boardTargetActions.find((a) => {
    const objectId = a.target?.objectId;
    if (typeof objectId !== 'string' || objectId.length === 0) {
      return true;
    }

    return false;
  })?.crewId ?? null;

  const firstBoardTargetNeedingSlot = (() => {
    const action = boardTargetActions.find((a) => {
      const objectId = a.target?.objectId;
      return !(typeof objectId === 'string' && objectId.length > 0);
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  const maneuverActions = ui.plannedActions.filter((a) => a.type === 'maneuver');
  const isManeuverCountValid = maneuverActions.length <= 1;
  const allManeuversConfigured = maneuverActions.every((a) => {
    const dir = (a.parameters as any)?.direction as string | undefined;
    const pwr = (a.parameters as any)?.powerSpent as number | undefined;
    const draftDir = (a.parameters as any)?.draftDirection as unknown;
    const draftPwr = (a.parameters as any)?.draftPowerSpent as unknown;
    const hasDraft = typeof draftDir === 'string' || typeof draftPwr === 'number';
    const dirOk = dir === 'forward' || dir === 'backward' || dir === 'inward' || dir === 'outward';
    const pwrOk = typeof pwr === 'number' && Number.isFinite(pwr) && pwr >= 1;
    return dirOk && pwrOk && !hasDraft;
  });

  const firstManeuverNeedingConfigCrewId = maneuverActions.find((a) => {
    const dir = (a.parameters as any)?.direction as string | undefined;
    const pwr = (a.parameters as any)?.powerSpent as number | undefined;
    const draftDir = (a.parameters as any)?.draftDirection as unknown;
    const draftPwr = (a.parameters as any)?.draftPowerSpent as unknown;
    const hasDraft = typeof draftDir === 'string' || typeof draftPwr === 'number';
    const dirOk = dir === 'forward' || dir === 'backward' || dir === 'inward' || dir === 'outward';
    const pwrOk = typeof pwr === 'number' && Number.isFinite(pwr) && pwr >= 1;
    return !(dirOk && pwrOk) || hasDraft;
  })?.crewId ?? null;

  const firstManeuverNeedingConfigSlot = (() => {
    const action = maneuverActions.find((a) => {
      const dir = (a.parameters as any)?.direction as string | undefined;
      const pwr = (a.parameters as any)?.powerSpent as number | undefined;
      const draftDir = (a.parameters as any)?.draftDirection as unknown;
      const draftPwr = (a.parameters as any)?.draftPowerSpent as unknown;
      const hasDraft = typeof draftDir === 'string' || typeof draftPwr === 'number';
      const dirOk = dir === 'forward' || dir === 'backward' || dir === 'inward' || dir === 'outward';
      const pwrOk = typeof pwr === 'number' && Number.isFinite(pwr) && pwr >= 1;
      return !(dirOk && pwrOk) || hasDraft;
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  // Assemble action validation: must have itemType selected
  const assembleActions = ui.plannedActions.filter((a) => a.type === 'assemble');
  const allAssemblesConfigured = assembleActions.every((a) => {
    const itemType = (a.parameters as any)?.itemType as string | undefined;
    const itemOk = itemType === 'spare_parts' || itemType === 'medical_kit' || itemType === 'probe' || itemType === 'torpedo';
    return itemOk;
  });

  const firstAssembleNeedingConfigCrewId = assembleActions.find((a) => {
    const itemType = (a.parameters as any)?.itemType as string | undefined;
    const itemOk = itemType === 'spare_parts' || itemType === 'medical_kit' || itemType === 'probe' || itemType === 'torpedo';
    return !itemOk;
  })?.crewId ?? null;

  const firstAssembleNeedingConfigSlot = (() => {
    const action = assembleActions.find((a) => {
      const itemType = (a.parameters as any)?.itemType as string | undefined;
      const itemOk = itemType === 'spare_parts' || itemType === 'medical_kit' || itemType === 'probe' || itemType === 'torpedo';
      return !itemOk;
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  // Integrate action validation: must have upgradeId selected (from pending upgrades)
  const integrateActions = ui.plannedActions.filter((a) => a.type === 'integrate');
  const allIntegratesConfigured = integrateActions.every((a) => {
    const upgradeId = (a.parameters as any)?.upgradeId as string | undefined;
    return typeof upgradeId === 'string' && upgradeId.length > 0;
  });

  const firstIntegrateNeedingConfigCrewId = integrateActions.find((a) => {
    const upgradeId = (a.parameters as any)?.upgradeId as string | undefined;
    return !(typeof upgradeId === 'string' && upgradeId.length > 0);
  })?.crewId ?? null;

  const firstIntegrateNeedingConfigSlot = (() => {
    const action = integrateActions.find((a) => {
      const upgradeId = (a.parameters as any)?.upgradeId as string | undefined;
      return !(typeof upgradeId === 'string' && upgradeId.length > 0);
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  // Launch action validation: must have launchType and board target
  const launchActions = ui.plannedActions.filter((a) => a.type === 'launch');
  const allLaunchesConfigured = launchActions.every((a) => {
    const launchType = (a.parameters as any)?.launchType as string | undefined;
    const objectId = a.target?.objectId;
    const typeOk = launchType === 'torpedo' || launchType === 'probe';
    const targetOk = typeof objectId === 'string' && objectId.length > 0;
    return typeOk && targetOk;
  });

  const firstLaunchNeedingConfigCrewId = launchActions.find((a) => {
    const launchType = (a.parameters as any)?.launchType as string | undefined;
    const objectId = a.target?.objectId;
    const typeOk = launchType === 'torpedo' || launchType === 'probe';
    const targetOk = typeof objectId === 'string' && objectId.length > 0;
    return !(typeOk && targetOk);
  })?.crewId ?? null;

  const firstLaunchNeedingConfigSlot = (() => {
    const action = launchActions.find((a) => {
      const launchType = (a.parameters as any)?.launchType as string | undefined;
      const objectId = a.target?.objectId;
      const typeOk = launchType === 'torpedo' || launchType === 'probe';
      const targetOk = typeof objectId === 'string' && objectId.length > 0;
      return !(typeOk && targetOk);
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  // Route action validation: must have sourceSection, targetSection, and amount > 0
  const routeActions = ui.plannedActions.filter((a) => a.type === 'route');
  const allRoutesConfigured = routeActions.every((a) => {
    const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
    const params = a.parameters as { sourceSection?: string; targetSection?: string; amount?: number } | undefined;
    const sourceOk = typeof params?.sourceSection === 'string' && params.sourceSection.length > 0;
    const targetOk = typeof params?.targetSection === 'string' && params.targetSection.length > 0;
    const amountOk = typeof params?.amount === 'number' && params.amount > 0;
    if (!sourceOk || !targetOk || !amountOk) {
      return false;
    }

    const sourceIsLifeSupport = params.sourceSection === LIFE_SUPPORT_ROUTE_KEY;
    const targetIsLifeSupport = params.targetSection === LIFE_SUPPORT_ROUTE_KEY;

    if (sourceIsLifeSupport && targetIsLifeSupport) {
      return false;
    }

    const safeLifeSupportPower =
      typeof ship.lifeSupportPower === 'number' && Number.isFinite(ship.lifeSupportPower) && ship.lifeSupportPower > 0
        ? ship.lifeSupportPower
        : 0;

    const sourceState = sourceIsLifeSupport ? null : ship.sections[params.sourceSection as ShipSection];
    const targetState = targetIsLifeSupport ? null : ship.sections[params.targetSection as ShipSection];
    const sourceHullOk = sourceIsLifeSupport ? safeLifeSupportPower > 0 : !!sourceState && sourceState.hull > 0;
    const targetHullOk = targetIsLifeSupport ? true : !!targetState && targetState.hull > 0;
    return sourceHullOk && targetHullOk;
  });

  const firstRouteNeedingConfigCrewId = routeActions.find((a) => {
    const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
    const params = a.parameters as { sourceSection?: string; targetSection?: string; amount?: number } | undefined;
    const sourceOk = typeof params?.sourceSection === 'string' && params.sourceSection.length > 0;
    const targetOk = typeof params?.targetSection === 'string' && params.targetSection.length > 0;
    const amountOk = typeof params?.amount === 'number' && params.amount > 0;
    if (!sourceOk || !targetOk || !amountOk) {
      return true;
    }

    const sourceIsLifeSupport = params.sourceSection === LIFE_SUPPORT_ROUTE_KEY;
    const targetIsLifeSupport = params.targetSection === LIFE_SUPPORT_ROUTE_KEY;

    if (sourceIsLifeSupport && targetIsLifeSupport) {
      return true;
    }

    const safeLifeSupportPower =
      typeof ship.lifeSupportPower === 'number' && Number.isFinite(ship.lifeSupportPower) && ship.lifeSupportPower > 0
        ? ship.lifeSupportPower
        : 0;

    const sourceState = sourceIsLifeSupport ? null : ship.sections[params.sourceSection as ShipSection];
    const targetState = targetIsLifeSupport ? null : ship.sections[params.targetSection as ShipSection];
    const sourceHullOk = sourceIsLifeSupport ? safeLifeSupportPower > 0 : !!sourceState && sourceState.hull > 0;
    const targetHullOk = targetIsLifeSupport ? true : !!targetState && targetState.hull > 0;
    return !(sourceHullOk && targetHullOk);
  })?.crewId ?? null;

  const firstRouteNeedingConfigSlot = (() => {
    const action = routeActions.find((a) => {
      const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
      const params = a.parameters as { sourceSection?: string; targetSection?: string; amount?: number } | undefined;
      const sourceOk = typeof params?.sourceSection === 'string' && params.sourceSection.length > 0;
      const targetOk = typeof params?.targetSection === 'string' && params.targetSection.length > 0;
      const amountOk = typeof params?.amount === 'number' && params.amount > 0;
      if (!sourceOk || !targetOk || !amountOk) {
        return true;
      }

      const sourceIsLifeSupport = params.sourceSection === LIFE_SUPPORT_ROUTE_KEY;
      const targetIsLifeSupport = params.targetSection === LIFE_SUPPORT_ROUTE_KEY;

      if (sourceIsLifeSupport && targetIsLifeSupport) {
        return true;
      }

      const safeLifeSupportPower =
        typeof ship.lifeSupportPower === 'number' && Number.isFinite(ship.lifeSupportPower) && ship.lifeSupportPower > 0
          ? ship.lifeSupportPower
          : 0;

      const sourceState = sourceIsLifeSupport ? null : ship.sections[params.sourceSection as ShipSection];
      const targetState = targetIsLifeSupport ? null : ship.sections[params.targetSection as ShipSection];
      const sourceHullOk = sourceIsLifeSupport ? safeLifeSupportPower > 0 : !!sourceState && sourceState.hull > 0;
      const targetHullOk = targetIsLifeSupport ? true : !!targetState && targetState.hull > 0;
      return !(sourceHullOk && targetHullOk);
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  const stimActions = ui.plannedActions.filter((a) => (a.parameters as any)?.stimmed === true);
  const allStimsConfigured = stimActions.every((a) => {
    const stimDoctorId = (a.parameters as any)?.stimDoctorId as unknown;
    return typeof stimDoctorId === 'string' && stimDoctorId.length > 0 && stimDoctorId !== a.crewId;
  });

  const firstStimNeedingDoctorCrewId = stimActions.find((a) => {
    const stimDoctorId = (a.parameters as any)?.stimDoctorId as unknown;
    const ok = typeof stimDoctorId === 'string' && stimDoctorId.length > 0 && stimDoctorId !== a.crewId;
    return !ok;
  })?.crewId ?? null;

  const firstStimNeedingDoctorSlot = (() => {
    const action = stimActions.find((a) => {
      const stimDoctorId = (a.parameters as any)?.stimDoctorId as unknown;
      const ok = typeof stimDoctorId === 'string' && stimDoctorId.length > 0 && stimDoctorId !== a.crewId;
      return !ok;
    });
    return action ? getPlannedActionSlot(action) : null;
  })();

  const selectedCrewId = ui.selectedCrewId;
  const selectedCrew = allCrew.find((c) => c.id === selectedCrewId) ?? null;
  const selectedAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot);
  const selectedRestoreAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'restore');

  const selectedRepairAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'repair');

  const selectedManeuverAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'maneuver');

  const selectedAssembleAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'assemble');

  const selectedIntegrateAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'integrate');

  const selectedLaunchAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'launch');

  const selectedRouteAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot, 'route');

  const selectedStimmed = (selectedAction?.parameters as any)?.stimmed === true;
  const selectedStimDoctorId = (selectedAction?.parameters as any)?.stimDoctorId as string | undefined;
  const selectedStimNeedsDoctor =
    !!selectedAction &&
    selectedStimmed &&
    !(typeof selectedStimDoctorId === 'string' && selectedStimDoctorId.length > 0 && selectedStimDoctorId !== selectedAction.crewId);

  const selectedCrewSection =
    selectedCrew && typeof (selectedCrew as { location?: unknown }).location === 'string'
      ? ((selectedCrew as { location: string }).location as ShipSection)
      : null;

  useEffect(() => {
    if (!game || game.status !== 'in_progress') {
      return;
    }

    if (game.turnPhase !== 'action_execution') {
      lastExecutionTurnRef.current = null;
      setShouldPulseBanner(false);
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current);
        pulseTimeoutRef.current = null;
      }
      return;
    }

    if (lastExecutionTurnRef.current === game.currentTurn) {
      return;
    }

    lastExecutionTurnRef.current = game.currentTurn;

    if (ui.selectedCrewId === null) {
      if (firstReviveNeedingTargetCrewId) {
        selectCrew(firstReviveNeedingTargetCrewId);
        if (firstReviveNeedingTargetSlot) {
          selectActionSlot(firstReviveNeedingTargetSlot);
        }
        setInteractionMode('none');
      } else if (firstRepairNeedingTargetCrewId) {
        selectCrew(firstRepairNeedingTargetCrewId);
        if (firstRepairNeedingTargetSlot) {
          selectActionSlot(firstRepairNeedingTargetSlot);
        }
        setInteractionMode('repair');
      } else if (firstStimNeedingDoctorCrewId) {
        selectCrew(firstStimNeedingDoctorCrewId);
        if (firstStimNeedingDoctorSlot) {
          selectActionSlot(firstStimNeedingDoctorSlot);
        }
        setInteractionMode('none');
      } else if (firstBoardTargetNeedingCrewId) {
        selectCrew(firstBoardTargetNeedingCrewId);
        if (firstBoardTargetNeedingSlot) {
          selectActionSlot(firstBoardTargetNeedingSlot);
        }
        setInteractionMode('none');
      } else if (firstManeuverNeedingConfigCrewId) {
        selectCrew(firstManeuverNeedingConfigCrewId);
        if (firstManeuverNeedingConfigSlot) {
          selectActionSlot(firstManeuverNeedingConfigSlot);
        }
        setInteractionMode('move');
      } else if (firstAssembleNeedingConfigCrewId) {
        selectCrew(firstAssembleNeedingConfigCrewId);
        if (firstAssembleNeedingConfigSlot) {
          selectActionSlot(firstAssembleNeedingConfigSlot);
        }
        setInteractionMode('none');
      } else if (firstIntegrateNeedingConfigCrewId) {
        selectCrew(firstIntegrateNeedingConfigCrewId);
        if (firstIntegrateNeedingConfigSlot) {
          selectActionSlot(firstIntegrateNeedingConfigSlot);
        }
        setInteractionMode('none');
      } else if (firstLaunchNeedingConfigCrewId) {
        selectCrew(firstLaunchNeedingConfigCrewId);
        if (firstLaunchNeedingConfigSlot) {
          selectActionSlot(firstLaunchNeedingConfigSlot);
        }
        setInteractionMode('none');
      } else if (firstRouteNeedingConfigCrewId) {
        selectCrew(firstRouteNeedingConfigCrewId);
        if (firstRouteNeedingConfigSlot) {
          selectActionSlot(firstRouteNeedingConfigSlot);
        }
        setInteractionMode('none');
      } else {
        setInteractionMode('move');
      }
    }

    setShouldPulseBanner(true);
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
    pulseTimeoutRef.current = window.setTimeout(() => {
      setShouldPulseBanner(false);
      pulseTimeoutRef.current = null;
    }, 950);
  }, [
    captain.id,
    firstAssembleNeedingConfigCrewId,
    firstAssembleNeedingConfigSlot,
    firstBoardTargetNeedingCrewId,
    firstBoardTargetNeedingSlot,
    firstIntegrateNeedingConfigCrewId,
    firstIntegrateNeedingConfigSlot,
    firstLaunchNeedingConfigCrewId,
    firstLaunchNeedingConfigSlot,
    firstManeuverNeedingConfigCrewId,
    firstManeuverNeedingConfigSlot,
    firstRepairNeedingTargetCrewId,
    firstRepairNeedingTargetSlot,
    firstReviveNeedingTargetCrewId,
    firstReviveNeedingTargetSlot,
    firstRouteNeedingConfigCrewId,
    firstRouteNeedingConfigSlot,
    firstStimNeedingDoctorCrewId,
    firstStimNeedingDoctorSlot,
    game,
    selectActionSlot,
    selectCrew,
    ui.selectedCrewId,
  ]);

  useEffect(() => {
    if (!isExecutionPhase || selectedCrewId === null) {
      if (interactionMode !== 'none') {
        setInteractionMode('none');
      }
      return;
    }

    if (interactionMode === 'none') {
      setInteractionMode('move');
    }
  }, [hasPendingRevive, interactionMode, isExecutionPhase, selectedCrewId, ui.plannedActions]);

  let routingContext:
    | {
        crewId: string;
        sourceSection: ShipSection;
        restoredPower: number;
        allocations: Map<ShipSection, number>;
        totalAllocated: number;
      }
    | null = null;

  if (
    interactionMode === 'route_power' &&
    isExecutionPhase &&
    !hasPendingRevive &&
    selectedCrew &&
    selectedRestoreAction
  ) {
    const sourceSection = (selectedCrew as any)?.location as ShipSection | null | undefined;
    if (!sourceSection) {
      routingContext = null;
    } else {
    const restoredPower = getRestorePowerForCrew(selectedCrew, ship);
    const allocations = new Map<ShipSection, number>();
    const rawAllocations = (selectedRestoreAction.parameters as any)
      ?.routeAllocations as { section?: string; amount?: number }[] | undefined;

    if (rawAllocations && Array.isArray(rawAllocations)) {
      const validSections = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);

      for (const entry of rawAllocations) {
        const sectionKey = entry.section as string | undefined;
        const amount = entry.amount as number | undefined;

        if (!sectionKey || !validSections.has(sectionKey as ShipSection)) {
          continue;
        }

        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
          continue;
        }

        const castSection = sectionKey as ShipSection;
        const previous = allocations.get(castSection) ?? 0;
        allocations.set(castSection, previous + amount);
      }
    }

    let totalAllocated = 0;
    for (const amount of allocations.values()) {
      totalAllocated += amount;
    }

    routingContext = {
      crewId: selectedCrew.id,
      sourceSection,
      restoredPower,
      allocations,
      totalAllocated,
    };
    }
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <Dialog.Root open={clearConfirm !== null} onOpenChange={(open) => {
        if (!open) {
          setClearConfirm(null);
        }
      }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(520px,95vw)] -translate-x-1/2 -translate-y-1/2 rounded border border-gravity-border bg-gravity-bg p-4 text-slate-100 shadow-xl z-[101]">
            <Dialog.Title className="text-sm font-bold tracking-wide">
              CONFIRM CLEAR
            </Dialog.Title>

            <div className="mt-2 text-[10px] text-gravity-muted whitespace-pre-wrap">
              {(() => {
                if (!clearConfirm) {
                  return '';
                }

                if (clearConfirm.kind === 'all') {
                  return (
                    'This will remove ALL planned actions for this turn.\n' +
                    'You can re-plan actions before advancing.\n\n' +
                    'This does not move crew, undo damage, or refund power already spent in prior turns.'
                  );
                }

                const action = ui.plannedActions.find(
                  (a) => a.crewId === clearConfirm.crewId && getPlannedActionSlot(a) === clearConfirm.slot,
                );
                const crewMember = allCrew.find((c) => c.id === clearConfirm.crewId);
                const crewLabel = crewMember ? crewMember.name : clearConfirm.crewId;
                const actionLabel = action?.type ? String(action.type) : 'action';

                return (
                  `This will remove the planned ${actionLabel} action for ${crewLabel} for this turn.\n` +
                  'You can re-plan an action for this crew before advancing.\n\n' +
                  'This does not move crew, undo damage, or refund power already spent in prior turns.'
                );
              })()}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                onClick={() => setClearConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded bg-slate-900/60 text-red-100 border border-red-400/30 text-[10px] hover:bg-slate-900"
                onClick={() => {
                  if (!clearConfirm) {
                    return;
                  }

                  setExecutionConfirmed(false);

                  if (clearConfirm.kind === 'all') {
                    clearPlannedActions();
                    setInteractionMode('none');
                    setClearConfirm(null);
                    return;
                  }

                  removePlannedAction(clearConfirm.crewId, clearConfirm.slot);
                  setInteractionMode('move');
                  selectTarget(null);
                  setClearConfirm(null);
                }}
              >
                {clearConfirm?.kind === 'all' ? 'Clear All' : 'Clear Action'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={upgradeDetailsId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setUpgradeDetailsId(null);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <Dialog.Content className="fixed top-0 right-0 h-full w-[min(420px,94vw)] border-l border-gravity-border bg-gravity-bg p-4 text-slate-100 shadow-2xl overflow-y-auto z-[101]">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-bold tracking-wide">UPGRADE</div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>

            {(() => {
              if (!upgradeDetailsId) {
                return null;
              }

              const upgrade = player.installedUpgrades.find((u) => u.id === upgradeDetailsId);
              if (!upgrade) {
                return (
                  <div className="mt-3 rounded border border-red-500/30 bg-red-950/20 p-2 text-[10px] text-red-200">
                    Selected upgrade was not found on this ship.
                  </div>
                );
              }

              const status = getUpgradePowerStatus(upgrade, ship);
              const sectionLabel = status.section ? (SECTION_CONFIG[status.section]?.label ?? status.section) : '—';
              const needsPower = status.upgradePowerRequired > 0;

              const upgradePowerMax = Math.max(0, status.upgradePowerRequired);
              const upgradePowerPercent =
                upgradePowerMax > 0 ? Math.max(0, Math.min(100, (status.storedPower / upgradePowerMax) * 100)) : 0;

              const fillClass = status.isPowered
                ? 'bg-gradient-to-r from-emerald-500/35 via-emerald-400/40 to-emerald-300/45 shadow-[0_0_10px_rgba(52,211,153,0.16)]'
                : 'bg-gradient-to-r from-amber-500/30 via-amber-400/35 to-amber-300/40 shadow-[0_0_10px_rgba(251,191,36,0.12)]';

              return (
                <div className="mt-3">
                  <div className="text-[14px] font-semibold">{upgrade.name}</div>
                  <div className="mt-1 text-[11px] text-gravity-muted whitespace-pre-wrap break-words hyphens-auto">
                    {upgrade.description}
                  </div>

                  <div className="mt-3 rounded border border-gravity-border bg-slate-950/20 p-2">
                    <div className="text-[10px] text-gravity-muted">Installed in</div>
                    <div className="text-[12px] font-semibold">{sectionLabel}</div>
                  </div>

                  {needsPower && (
                    <div className="mt-2 rounded border border-gravity-border bg-slate-950/20 p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] text-gravity-muted">Power</div>
                        <div
                          className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${
                            status.isPowered
                              ? 'border-emerald-400/50 bg-emerald-950/30 text-emerald-200'
                              : 'border-amber-400/50 bg-amber-950/30 text-amber-200'
                          }`}
                        >
                          {status.isPowered ? 'POWERED' : 'UNPOWERED'}
                        </div>
                      </div>

                      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-200">
                        <div>Upgrade</div>
                        <div className="font-semibold tabular-nums">{status.storedPower}/{status.upgradePowerRequired}</div>
                      </div>
                      <div className="mt-1 relative">
                        <div className="relative h-3 rounded-md border border-slate-700/70 bg-slate-950/25 overflow-hidden">
                          <div
                            className="absolute inset-0 z-0"
                            style={{
                              background:
                                'repeating-linear-gradient(90deg, rgba(148,163,184,0.10) 0px, rgba(148,163,184,0.10) 1px, rgba(0,0,0,0) 6px, rgba(0,0,0,0) 10px)',
                            }}
                          />
                          <div
                            className={`absolute left-0 top-0 z-10 h-full ${fillClass}`}
                            style={{ width: `${upgradePowerPercent}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-200">
                        <div>Host section</div>
                        <div className="font-semibold tabular-nums">{status.totalPowerInSection}/{status.basePowerRequired}</div>
                      </div>

                      {!status.isPowered && (
                        <div className="mt-2 text-[10px] text-gravity-muted">
                          Click the OFF tag on the section card to charge this upgrade (max 3 power per action).
                        </div>
                      )}
                    </div>
                  )}

                  {!needsPower && (
                    <div className="mt-2 rounded border border-gravity-border bg-slate-950/20 p-2 text-[10px] text-gravity-muted">
                      This upgrade has no power requirement.
                    </div>
                  )}
                </div>
              );
            })()}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Crew roster at top */}
      <div className="panel p-2 mb-1">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-xs font-bold tracking-wide">CREW</div>
          <button
            type="button"
            className="px-2 py-0.5 rounded border border-gravity-border text-[10px] hover:bg-gravity-border transition-colors"
            onClick={toggleRoster}
            title="Edit captain and officers"
          >
            Edit
          </button>
        </div>
        {reviveNeedsTarget && (
          <div className="text-[10px] text-center text-green-300 mb-1">
            Select a crew to revive
          </div>
        )}

        {selectedStimNeedsDoctor && (
          <div className="text-[10px] text-center text-fuchsia-300 mb-1">
            Select a Doctor to apply stim pack
          </div>
        )}
 
        <div className="flex w-full items-start justify-between gap-3">
          <div className="flex flex-col gap-1 items-start text-left">
            <div className="text-[10px] tracking-wide text-gravity-muted uppercase">Captain</div>
            <div className="flex gap-1.5 flex-nowrap">
              {[captain].map((c) => {
                const isReviveTarget = hasPendingRevive && c.id === currentReviveTargetId;
                const { canSelect: canSelectReviveTarget, blockedReason: reviveBlockedReason } =
                  getReviveCapacityStatus(c);

                const isStimDoctor = selectedStimmed && c.id === selectedStimDoctorId;
                const canSelectStimDoctor = false;

                const isSelectedForMove =
                  isExecutionPhase && ui.selectedCrewId === c.id;
                const canSelectForMove =
                  isExecutionPhase && c.status === 'active';

                return (
                  <CrewToken
                    key={c.id}
                    crew={c}
                    isReviveTarget={isReviveTarget}
                    canSelectReviveTarget={canSelectReviveTarget}
                    reviveBlockedReason={reviveBlockedReason}
                    onSelectReviveTarget={
                      canSelectReviveTarget && actingReviverId
                        ? () => {
                            updatePlannedActionParameters(
                              actingReviverId,
                              {
                                targetCrewId: c.id,
                              },
                              ui.selectedActionSlot,
                            );
                            setExecutionConfirmed(false);
                            selectTarget(c.id);
                          }
                        : undefined
                    }
                    isStimDoctor={isStimDoctor}
                    canSelectStimDoctor={canSelectStimDoctor}
                    onSelectStimDoctor={undefined}
                    isSelectedForMove={isSelectedForMove}
                    onSelectForMove={
                      canSelectForMove && !canSelectReviveTarget
                        ? () => {
                            setExecutionConfirmed(false);
                            if (ui.selectedCrewId === c.id) {
                              selectCrew(null);
                              setInteractionMode('none');
                            } else {
                              selectCrew(c.id);
                              setInteractionMode('move');
                            }
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1 items-center text-center">
            <div className="text-[10px] tracking-wide text-gravity-muted uppercase">Advanced Crew</div>
            <div className="flex gap-1.5 flex-nowrap justify-center">
              {advancedCrew.map((c) => {
                const isReviveTarget = hasPendingRevive && c.id === currentReviveTargetId;
                const canSelectReviveTarget = hasPendingRevive && c.status === 'unconscious';

                const isDoctor =
                  !('captainType' in c) &&
                  (c as any)?.type === 'officer' &&
                  (c as any)?.role === 'doctor' &&
                  c.status === 'active';
                const canSelectStimDoctor =
                  selectedStimmed &&
                  !!selectedCrew &&
                  !!selectedCrewSection &&
                  isDoctor &&
                  c.location === selectedCrewSection &&
                  c.id !== selectedCrew.id;
                const isStimDoctor = selectedStimmed && c.id === selectedStimDoctorId;

                const isSelectedForMove =
                  isExecutionPhase && ui.selectedCrewId === c.id;
                const canSelectForMove =
                  isExecutionPhase && c.status === 'active';

                return (
                  <CrewToken
                    key={c.id}
                    crew={c}
                    isReviveTarget={isReviveTarget}
                    canSelectReviveTarget={canSelectReviveTarget}
                    onSelectReviveTarget={
                      canSelectReviveTarget && actingReviverId
                        ? () => {
                            updatePlannedActionParameters(
                              actingReviverId,
                              {
                                targetCrewId: c.id,
                              },
                              ui.selectedActionSlot,
                            );
                            setExecutionConfirmed(false);
                            selectTarget(c.id);
                          }
                        : undefined
                    }
                    isStimDoctor={isStimDoctor}
                    canSelectStimDoctor={canSelectStimDoctor}
                    onSelectStimDoctor={
                      canSelectStimDoctor && selectedCrewId
                        ? () => {
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(
                              selectedCrewId,
                              {
                                stimDoctorId: c.id,
                              },
                              ui.selectedActionSlot,
                            );
                          }
                        : undefined
                    }
                    isSelectedForMove={isSelectedForMove}
                    onSelectForMove={
                      canSelectForMove && !canSelectReviveTarget
                        ? () => {
                            setExecutionConfirmed(false);
                            if (ui.selectedCrewId === c.id) {
                              selectCrew(null);
                              setInteractionMode('none');
                            } else {
                              selectCrew(c.id);
                              setInteractionMode('move');
                            }
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1 items-end text-right">
            <div className="text-[10px] tracking-wide text-gravity-muted uppercase">Basic Crew</div>
            <div className="flex gap-1.5 flex-nowrap">
              {basicCrew.map((c) => {
                const isReviveTarget = hasPendingRevive && c.id === currentReviveTargetId;
                const canSelectReviveTarget = hasPendingRevive && c.status === 'unconscious';

                const isSelectedForMove =
                  isExecutionPhase && ui.selectedCrewId === c.id;
                const canSelectForMove =
                  isExecutionPhase && c.status === 'active';

                return (
                  <CrewToken
                    key={c.id}
                    crew={c}
                    isReviveTarget={isReviveTarget}
                    canSelectReviveTarget={canSelectReviveTarget}
                    onSelectReviveTarget={
                      canSelectReviveTarget && actingReviverId
                        ? () => {
                            updatePlannedActionParameters(
                              actingReviverId,
                              {
                                targetCrewId: c.id,
                              },
                              ui.selectedActionSlot,
                            );
                            setExecutionConfirmed(false);
                            selectTarget(c.id);
                          }
                        : undefined
                    }
                    isSelectedForMove={isSelectedForMove}
                    onSelectForMove={
                      canSelectForMove && !canSelectReviveTarget
                        ? () => {
                            setExecutionConfirmed(false);
                            if (ui.selectedCrewId === c.id) {
                              selectCrew(null);
                              setInteractionMode('none');
                            } else {
                              selectCrew(c.id);
                              setInteractionMode('move');
                            }
                          }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-2" title={lifeSupportTooltip}>
          <div className="flex items-center justify-between text-[10px] text-gravity-muted mb-1">
            <span>Life Support</span>
            <span className={overCapacity ? 'text-red-300 font-semibold' : 'text-gravity-muted'}>
              {lifeSupportLoad} / {lifeSupportCapacitySafe}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${overCapacity ? 'bg-red-500' : 'bg-green-500'}`}
              style={{ width: `${lifeSupportRatio * 100}%` }}
            />
          </div>
          <div
            className={`mt-1 text-[10px] text-center ${overCapacity ? 'text-red-300' : 'text-gravity-muted'}`}
          >
            {overCapacity
              ? 'Over capacity - excess crew will fall unconscious at end of turn.'
              : `Revive capacity remaining: ${reviveCapacityHeadroom}`}
          </div>
          <div className="mt-2">
            {hazardLifeSupportPowerLoss > 0 ? (
              <div
                className="rounded border border-fuchsia-500/50 bg-fuchsia-950/30 px-2 py-2 text-[10px] text-fuchsia-100"
                title="Hazards within range will drain life support power at the end of the Environment phase."
              >
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200">
                  <span>Hazard Drain</span>
                  <span>
                    −{hazardLifeSupportPowerLoss} LS power
                    {hazardCrewSlotsImpact > 0 ? ` (≈${hazardCrewSlotsImpactLabel} crew slots)` : ''}
                  </span>
                </div>
                <div className="mt-0.5 text-fuchsia-100/90">
                  {hazardPressure.contributors.length === 1
                    ? '1 hazard is within radiation range of the ship.'
                    : `${hazardPressure.contributors.length} hazards are within radiation range of the ship.`}
                </div>
                <ul className="mt-1 space-y-0.5 text-fuchsia-100/80">
                  {hazardPressure.contributors.map((hazard) => (
                    <li key={hazard.id}>
                      Ring {hazard.ring} · Space {hazard.space} — distance {hazard.distance} (≤{HAZARD_CONFIG.range})
                    </li>
                  ))}
                </ul>
                {hazardHullDamage > 0 && (
                  <div className="mt-1 text-fuchsia-100/80">
                    Also expect −{hazardHullDamage} hull if you stay in range.
                  </div>
                )}
              </div>
            ) : (
              <div
                className="rounded border border-slate-700/70 bg-slate-950/40 px-2 py-2 text-[10px] text-slate-300"
                title="No hazards are currently positioned to drain life support."
              >
                No hazard-induced life support drain detected.
              </div>
            )}
          </div>
        </div>
      </div>

      {(() => {
        const diff = ui.lastPlayerDiff;
        if (!diff) {
          return null;
        }

        const sectionEntries = Object.entries(diff.sectionDiffs).filter(([, d]) =>
          d.hullDelta !== 0 || d.powerDelta !== 0 || d.conduitsDelta !== 0 || d.corridorsDelta !== 0,
        );
        const resourceEntries = Object.entries(diff.resourceDiffs);

        const pendingUpgradesGained = diff.pendingUpgradesGained ?? [];
        const installedUpgradesGained = diff.installedUpgradesGained ?? [];

        const hasAnyChanges =
          diff.shieldsDelta !== 0 ||
          diff.speedDelta !== 0 ||
          sectionEntries.length > 0 ||
          resourceEntries.length > 0 ||
          pendingUpgradesGained.length > 0 ||
          installedUpgradesGained.length > 0;

        if (!hasAnyChanges) {
          return null;
        }

        const formatDelta = (value: number) => (value > 0 ? `+${value}` : `${value}`);

        return (
          <div className="panel p-2">
            <div className="text-xs font-bold mb-1 tracking-wide text-center">LAST CHANGES</div>
            <div className="text-[10px] text-gravity-muted text-center mb-2">
              Turn {diff.fromTurn} ({diff.fromPhase}) → Turn {diff.toTurn} ({diff.toPhase})
            </div>

            {(diff.shieldsDelta !== 0 || diff.speedDelta !== 0) && (
              <div className="flex flex-wrap gap-2 justify-center text-[10px] mb-1">
                {diff.shieldsDelta !== 0 && (
                  <span
                    className={`px-2 py-0.5 rounded border ${
                      diff.shieldsDelta > 0
                        ? 'border-blue-400/40 bg-blue-950/30 text-blue-200'
                        : 'border-red-400/40 bg-red-950/30 text-red-200'
                    }`}
                  >
                    Shields {formatDelta(diff.shieldsDelta)}
                  </span>
                )}
                {diff.speedDelta !== 0 && (
                  <span
                    className={`px-2 py-0.5 rounded border ${
                      diff.speedDelta > 0
                        ? 'border-sky-400/40 bg-sky-950/30 text-sky-200'
                        : 'border-red-400/40 bg-red-950/30 text-red-200'
                    }`}
                  >
                    Speed {formatDelta(diff.speedDelta)}
                  </span>
                )}
              </div>
            )}

            {sectionEntries.length > 0 && (
              <div className="mt-1 flex flex-col gap-1 text-[10px]">
                {sectionEntries.map(([sectionKey, d]) => {
                  const cfg = SECTION_CONFIG[sectionKey];
                  const label = cfg?.label ?? sectionKey;
                  const parts: string[] = [];
                  if (d.hullDelta !== 0) parts.push(`Hull ${formatDelta(d.hullDelta)}`);
                  if (d.powerDelta !== 0) parts.push(`Power ${formatDelta(d.powerDelta)}`);
                  if (d.conduitsDelta !== 0) parts.push(`Conduits ${formatDelta(d.conduitsDelta)}`);
                  if (d.corridorsDelta !== 0) parts.push(`Corridors ${formatDelta(d.corridorsDelta)}`);

                  return (
                    <div key={sectionKey} className="flex items-center justify-between gap-2">
                      <span className="text-gravity-muted">{label}</span>
                      <span className="text-slate-100">{parts.join(' · ')}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {resourceEntries.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-gravity-muted text-center mb-1">Resources</div>
                <div className="flex flex-wrap gap-2 justify-center text-[10px]">
                  {resourceEntries.map(([key, delta]) => (
                    <span
                      key={key}
                      className={`px-2 py-0.5 rounded border ${
                        typeof delta === 'number' && delta > 0
                          ? 'border-green-400/40 bg-green-950/30 text-green-200'
                          : 'border-red-400/40 bg-red-950/30 text-red-200'
                      }`}
                    >
                      {key} {typeof delta === 'number' ? formatDelta(delta) : String(delta)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {(pendingUpgradesGained.length > 0 || installedUpgradesGained.length > 0) && (
              <div className="mt-2">
                <div className="text-[10px] text-gravity-muted text-center mb-1">Upgrades</div>
                <div className="flex flex-col gap-1 text-[10px]">
                  {pendingUpgradesGained.length > 0 && (
                    <div>
                      <div className="text-gravity-muted">Pending</div>
                      <div className="flex flex-wrap gap-2 justify-center mt-0.5">
                        {pendingUpgradesGained.map((u) => (
                          <span
                            key={`pending-${u.id}`}
                            className="px-2 py-0.5 rounded border border-emerald-400/40 bg-emerald-950/20 text-emerald-100"
                            title={u.description}
                          >
                            {u.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {installedUpgradesGained.length > 0 && (
                    <div>
                      <div className="text-gravity-muted">Installed</div>
                      <div className="flex flex-wrap gap-2 justify-center mt-0.5">
                        {installedUpgradesGained.map((u) => (
                          <span
                            key={`installed-${u.id}`}
                            className="px-2 py-0.5 rounded border border-sky-400/40 bg-sky-950/20 text-sky-100"
                            title={u.description}
                          >
                            {u.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {isExecutionPhase && (
        <div className="panel p-2 order-last">
          {ui.lastError && (
            <div className="mb-2 rounded border border-red-500/40 bg-red-950/30 px-2 py-1 text-[10px] text-red-200">
              <div className="flex items-start justify-between gap-2">
                <div className="whitespace-pre-wrap">{ui.lastError}</div>
                <button
                  type="button"
                  className="shrink-0 px-2 py-0.5 rounded bg-slate-900/60 text-red-200 hover:bg-slate-900"
                  onClick={() => setLastError(null)}
                >
                  Dismiss
                </button>
              </div>
              {(() => {
                if (!currentPlayerId || !ui.lastError) {
                  return null;
                }

                const match = ui.lastError.match(/crew\s+"([^"]+)"/);
                const inferredCrewId = match?.[1] ?? ui.selectedCrewId;
                if (!inferredCrewId) {
                  return null;
                }

                const inferredCrew = allCrew.find((c) => c.id === inferredCrewId);
                if (!inferredCrew) {
                  return null;
                }

                const currentAction =
                  findPlannedAction(inferredCrewId, ui.selectedActionSlot) ??
                  findPlannedAction(inferredCrewId, 'primary') ??
                  findPlannedAction(inferredCrewId, 'bonus');
                const currentActionType = currentAction?.type;
                const canSwitch = currentActionType !== 'restore' && currentActionType !== 'repair';

                const didMoveThisExecution = (currentAction?.parameters as any)?.movedThisExecution === true;
                const currentActionSlot = currentAction ? getPlannedActionSlot(currentAction) : ui.selectedActionSlot;

                return (
                  <div className="mt-2 flex flex-col gap-2">
                    {canSwitch && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-red-200">
                          Fix: switch action for <span className="font-semibold">{inferredCrew.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-yellow-700/30 text-yellow-100 border border-yellow-400/40 hover:bg-yellow-700/50"
                            onClick={() => {
                              setExecutionConfirmed(false);
                              addPlannedAction({
                                playerId: currentPlayerId,
                                crewId: inferredCrewId,
                                type: 'restore',
                                parameters: {
                                  uiSlot: ui.selectedActionSlot,
                                  ...(didMoveThisExecution ? { movedThisExecution: true } : {}),
                                },
                              } as any);
                              selectCrew(inferredCrewId);
                              setInteractionMode('move');
                            }}
                          >
                            Switch to Restore
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-blue-700/30 text-blue-100 border border-blue-400/40 hover:bg-blue-700/50"
                            onClick={() => {
                              setExecutionConfirmed(false);
                              addPlannedAction({
                                playerId: currentPlayerId,
                                crewId: inferredCrewId,
                                type: 'repair',
                                parameters: {
                                  uiSlot: ui.selectedActionSlot,
                                  repairType: 'hull',
                                  ...(didMoveThisExecution ? { movedThisExecution: true } : {}),
                                },
                              } as any);
                              selectCrew(inferredCrewId);
                              setInteractionMode('repair');
                            }}
                          >
                            Switch to Repair
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] text-red-200">Or proceed by skipping the blocked action.</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-slate-900/60 text-red-100 border border-red-400/30 hover:bg-slate-900"
                          onClick={() => {
                            setExecutionConfirmed(false);
                            removePlannedAction(inferredCrewId, currentActionSlot);
                            if (ui.selectedCrewId === inferredCrewId) {
                              selectCrew(null);
                              setInteractionMode('none');
                            }
                          }}
                        >
                          Skip This Action
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-slate-900/60 text-red-100 border border-red-400/30 hover:bg-slate-900"
                          onClick={() => {
                            setExecutionConfirmed(false);
                            setClearConfirm({ kind: 'all' });
                          }}
                        >
                          Skip All Remaining
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {reviveActions.length > 0 && (
            <div className="mb-2 rounded border border-green-400/30 bg-green-950/10 px-2 py-1 text-[10px] text-green-200">
              <div className="font-semibold">Revive breakdown</div>
              {(() => {
                const hasNanoBots = player.installedUpgrades.some((upgrade) => upgrade.id === 'nano_bots');
                const nanoBotsMultiplier = hasNanoBots ? 2 : 1;

                return reviveActions.map((action, index) => {
                  const performer = allCrew.find((c) => c.id === action.crewId);
                  const performerType = performer ? (performer as { type?: unknown }).type : null;
                  const targetCrewId = (action.parameters as { targetCrewId?: unknown } | undefined)
                    ?.targetCrewId;

                  const crewBonus = performer ? getCrewReviveBonusForPreview(performer) : null;
                  const medLabBonus = getMedLabReviveBonusForPreview(ship, index);
                  const rollValue = performer ? getFixedReviveRollValueForPreview(performer) : null;

                  const targetName =
                    typeof targetCrewId === 'string'
                      ? allCrew.find((c) => c.id === targetCrewId)?.name
                      : null;

                  const performerLabel = performer
                    ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                    : `Unknown performer (${action.crewId})`;

                  const performerStatusLabel = performer
                    ? `${performer.status}${performer.location ? ` @ ${performer.location}` : ''}`
                    : null;

                  const rollLabel = rollValue === null ? 'unknown' : String(rollValue);
                  const crewBonusLabel = crewBonus === null ? 'unknown' : String(crewBonus);

                  const totalBeforeMultiplier =
                    rollValue !== null && crewBonus !== null ? rollValue + crewBonus + medLabBonus : null;
                  const totalPreview =
                    totalBeforeMultiplier !== null ? totalBeforeMultiplier * nanoBotsMultiplier : null;

                  return (
                    <div key={action.crewId} className="mt-1">
                      <div>
                        <span className="font-semibold">{performerLabel}</span>
                        {' → '}
                        <span className="font-semibold">
                          {typeof targetCrewId === 'string'
                            ? `${targetName ?? targetCrewId}`
                            : `No target (${String(targetCrewId)})`}
                        </span>
                      </div>
                      {performerStatusLabel && (
                        <div className="text-gravity-muted">performer: {performerStatusLabel}</div>
                      )}
                      <div className="text-gravity-muted">
                        roll={rollLabel}, crewBonus={crewBonusLabel}, medLabBonus={medLabBonus}
                        {totalPreview !== null
                          ? `, total=${totalPreview}${nanoBotsMultiplier > 1 ? ' (Nano-Bots x2)' : ''}`
                          : ''}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {repairActions.length > 0 && (
            <div className="mb-2 rounded border border-slate-400/30 bg-slate-950/10 px-2 py-1 text-[10px] text-slate-200">
              <div className="font-semibold">Repair breakdown</div>
              {repairActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const fromSection = performer?.location ?? null;
                const targetSection = action.target?.section;
                const repairType = (action.parameters as any)?.repairType as string | undefined;
                const baseMultiplier = performer ? getCrewRepairMultiplierForPreview(performer) : 1;
                let multiplier = baseMultiplier;
                const applied: string[] = [];

                const repairDroids = player.installedUpgrades.find((u) => u.id === 'repair_droids');
                if (repairDroids && fromSection === SHIP_SECTIONS.ENGINEERING) {
                  const status = getUpgradePowerStatus(repairDroids, ship);
                  if (status.isPowered) {
                    multiplier *= 2;
                    applied.push('Repair Droids x2');
                  }
                }

                const droidStation = player.installedUpgrades.find((u) => u.id === 'droid_station');
                if (droidStation && fromSection === SHIP_SECTIONS.MED_LAB) {
                  const status = getUpgradePowerStatus(droidStation, ship);
                  if (status.isPowered) {
                    multiplier *= 2;
                    applied.push('Droid Station x2');
                  }
                }

                return (
                  <div key={action.crewId} className="mt-1">
                    <div className="font-semibold">{performerLabel}</div>
                    <div className="text-gravity-muted">
                      from={String(fromSection ?? '—')}, target={String(targetSection ?? '—')}, type={String(repairType ?? '—')}, multiplier={multiplier}${applied.length > 0 ? ` (${applied.join(', ')})` : ''}, powerCost=1
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {routeActions.length > 0 && (
            <div className="mb-2 rounded border border-sky-400/30 bg-sky-950/10 px-2 py-1 text-[10px] text-sky-200">
              <div className="font-semibold">Route breakdown</div>
              {routeActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const fromSection = performer?.location ?? null;
                const params = action.parameters as { sourceSection?: string; targetSection?: string; amount?: number } | undefined;
                const sourceSection = params?.sourceSection as ShipSection | undefined;
                const targetSection = params?.targetSection as ShipSection | undefined;
                const amount = params?.amount;

                const amountLabel =
                  typeof amount === 'number' && Number.isFinite(amount) ? String(amount) : `invalid (${String(amount)})`;

                const path =
                  sourceSection && targetSection && sourceSection !== targetSection
                    ? findRoutingPath(ship, sourceSection, targetSection)
                    : sourceSection && targetSection && sourceSection === targetSection
                      ? [sourceSection]
                      : null;

                let minConduitsOnPath = Infinity;
                if (path && path.length > 1) {
                  for (let i = 0; i < path.length - 1; i++) {
                    const from = path[i];
                    const to = path[i + 1];
                    const conduitCount = ship.sections[from]?.conduitConnections?.[to] ?? 0;
                    minConduitsOnPath = Math.min(minConduitsOnPath, conduitCount);
                  }
                }
                const safeCapacity =
                  path && path.length > 1 && Number.isFinite(minConduitsOnPath)
                    ? minConduitsOnPath * POWER_CONFIG.MAX_POWER_PER_CONDUIT
                    : 0;

                const willOverload =
                  typeof amount === 'number' && Number.isFinite(amount) && safeCapacity > 0 && amount > safeCapacity;

                const sourceState = sourceSection ? ship.sections[sourceSection] : undefined;
                const targetState = targetSection ? ship.sections[targetSection] : undefined;
                const sourcePower = sourceState ? sourceState.powerDice.reduce((sum, d) => sum + d, 0) : null;
                const targetPower = targetState ? targetState.powerDice.reduce((sum, d) => sum + d, 0) : null;
                const targetCapacity = typeof targetPower === 'number' ? 18 - targetPower : null;

                return (
                  <div key={action.crewId} className="mt-1">
                    <div className="font-semibold">{performerLabel}</div>
                    <div className="text-gravity-muted">
                      from={String(fromSection ?? '—')}, source={String(sourceSection ?? '—')}, target={String(targetSection ?? '—')}, amount={amountLabel}, powerCost=1
                    </div>
                    <div className="text-gravity-muted">
                      sourcePower={sourcePower ?? '—'}, targetCapacity={targetCapacity ?? '—'}, safeCapacity={safeCapacity || '—'}
                      {path ? `, path=${path.join('→')}` : ', path=none'}
                      {willOverload ? ', overload=YES' : ', overload=no'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {launchActions.length > 0 && (
            <div className="mb-2 rounded border border-fuchsia-400/30 bg-fuchsia-950/10 px-2 py-1 text-[10px] text-fuchsia-200">
              <div className="font-semibold">Launch breakdown</div>
              {launchActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const launchType = (action.parameters as any)?.launchType as string | undefined;
                const targetObjectId = action.target?.objectId;
                const stimmed = (action.parameters as any)?.stimmed === true;
                const stimDoctorId = (action.parameters as any)?.stimDoctorId as string | undefined;

                const torpedoesRaw = (player.resources as any)?.torpedo as unknown;
                const probesRaw = (player.resources as any)?.probe as unknown;

                const torpedoes =
                  typeof torpedoesRaw === 'number' && Number.isFinite(torpedoesRaw) && torpedoesRaw >= 0
                    ? torpedoesRaw
                    : 0;
                const probes =
                  typeof probesRaw === 'number' && Number.isFinite(probesRaw) && probesRaw >= 0
                    ? probesRaw
                    : 0;

                return (
                  <div key={action.crewId} className="mt-1">
                    <div>
                      <span className="font-semibold">{performerLabel}</span>
                      {typeof targetObjectId === 'string' && targetObjectId.length > 0 ? ` → ${targetObjectId}` : ''}
                    </div>
                    <div className="text-gravity-muted">
                      type={String(launchType ?? '—')}, powerCost=1
                      {launchType === 'torpedo'
                        ? `, torpedoes=${torpedoes}→${Math.max(0, torpedoes - 1)}, damage=6`
                        : launchType === 'probe'
                          ? `, probes=${probes}→${Math.max(0, probes - 1)}`
                          : ''}
                      {stimmed ? `, stimDoctor=${String(stimDoctorId ?? '—')}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {integrateActions.length > 0 && (
            <div className="mb-2 rounded border border-emerald-400/30 bg-emerald-950/10 px-2 py-1 text-[10px] text-emerald-200">
              <div className="font-semibold">Integrate breakdown</div>
              {integrateActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const upgradeId = (action.parameters as any)?.upgradeId as string | undefined;
                const upgrade = typeof upgradeId === 'string' ? player.pendingUpgrades.find((u) => u.id === upgradeId) : null;
                const upgradeLabel = upgrade ? `${upgrade.name} (${upgrade.id})` : String(upgradeId ?? '—');

                return (
                  <div key={action.crewId} className="mt-1">
                    <div className="font-semibold">{performerLabel}</div>
                    <div className="text-gravity-muted">upgrade={upgradeLabel}, powerCost=1</div>
                  </div>
                );
              })}
            </div>
          )}

          {restoreActions.length > 0 && (
            <div className="mb-2 rounded border border-yellow-400/30 bg-yellow-950/10 px-2 py-1 text-[10px] text-yellow-200">
              <div className="font-semibold">Restore breakdown</div>
              {restoreActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;

                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const actingSection = performer ? (performer.location as ShipSection | null) : null;

                const coolant = player.installedUpgrades.find((u) => u.id === 'coolant');
                const coolantBonus =
                  coolant && actingSection === SHIP_SECTIONS.ENGINEERING && getUpgradePowerStatus(coolant, ship).isPowered ? 1 : 0;

                const base = 1;
                const engineeringFullyPowered =
                  !!actingSection &&
                  actingSection === DEFAULT_POWER_ROUTING_HUB_SECTION &&
                  ShipUtils.isFullyPowered(ship, DEFAULT_POWER_ROUTING_HUB_SECTION);
                const fullBonus = engineeringFullyPowered ? 2 : 0;
                const crewBonus = performer ? getCrewRestorePowerBonusForPreview(performer) : 0;

                const baseTotal = performer ? getRestorePowerForCrew(performer, ship) : 0;
                const total = baseTotal + coolantBonus;
                const shieldBonus =
                  performer && performer.location === SHIP_SECTIONS.DEFENSE
                    ? getCrewRestoreShieldBonusForPreview(performer)
                    : 0;

                const rawAllocations = (action.parameters as any)?.routeAllocations as
                  | Array<{ section?: string; amount?: number }>
                  | undefined;

                let allocated = 0;
                if (Array.isArray(rawAllocations)) {
                  for (const entry of rawAllocations) {
                    const amount = entry?.amount;
                    if (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
                      allocated += amount;
                    }
                  }
                }
                const toActingSection = total - allocated;
                const depositLabel = actingSection ? `to${actingSection}` : 'toSection';

                return (
                  <div key={action.crewId} className="mt-1">
                    <div className="font-semibold">{performerLabel}</div>
                    <div className="text-gravity-muted">
                      base={base}, engineeringFull={engineeringFullyPowered ? `+${fullBonus}` : '+0'}, crewBonus={crewBonus}, total={total}
                      {coolantBonus > 0 ? ` (Coolant +${coolantBonus})` : ''}
                      {baseTotal <= 0 && performer ? ' (0 generated)' : ''}
                      {shieldBonus > 0 ? `, shieldBonus=${shieldBonus}` : ''}
                      {Array.isArray(rawAllocations) ? `, routed=${allocated}, ${depositLabel}=${toActingSection}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {maneuverActions.length > 0 && (
            <div className="mb-2 rounded border border-cyan-400/30 bg-cyan-950/10 px-2 py-1 text-[10px] text-cyan-200">
              <div className="font-semibold">Maneuver breakdown</div>
              {maneuverActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const direction = (action.parameters as any)?.direction as string | undefined;
                const powerSpent = (action.parameters as any)?.powerSpent as number | undefined;
                const pwrLabel = typeof powerSpent === 'number' && Number.isFinite(powerSpent) ? powerSpent : '—';

                const bridgeFullyPowered = ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.BRIDGE);
                const bridgeBonus = bridgeFullyPowered ? 1 : 0;
                const crewBonus = performer && !('captainType' in performer)
                  ? (CrewUtils.getBonuses(performer).acceleration ?? 0)
                  : 0;
                const crewBonusSafe = typeof crewBonus === 'number' && Number.isFinite(crewBonus) ? crewBonus : 0;
                const base = typeof powerSpent === 'number' && Number.isFinite(powerSpent) ? powerSpent : 0;
                const total = base + bridgeBonus + crewBonusSafe;

                return (
                  <div key={action.crewId} className="mt-1">
                    <div className="font-semibold">{performerLabel}</div>
                    <div className="text-gravity-muted">
                      dir={String(direction ?? '—')}, powerSpent={String(pwrLabel)}, base={base}, bridgeFull={bridgeFullyPowered ? '+1' : '+0'}, crewBonus={crewBonusSafe}, totalAccel={total}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(scanActions.length > 0 || acquireActions.length > 0) && (
            <div className="mb-2 rounded border border-purple-400/30 bg-purple-950/10 px-2 py-1 text-[10px] text-purple-200">
              <div className="font-semibold">Scan / Acquire breakdown</div>
              {[...scanActions, ...acquireActions].map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const objectId = action.target?.objectId;
                const rollValue = performer ? getFixedDiscoveryRollValueForPreview(performer) : null;
                const rollLabel = rollValue === null ? 'unknown' : String(rollValue);

                const sciLabFullyPowered = ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.SCI_LAB);
                const sciLabBonus = sciLabFullyPowered
                  ? (player.captain.captainType === 'technologist' ? 3 : 2)
                  : 0;
                const crewBonus = performer ? getScanRangeBonusForPreview(performer) : 0;
                const totalRange = 1 + sciLabBonus + crewBonus;

                const targetObject =
                  typeof objectId === 'string' && objectId.length > 0
                    ? game.board.objects.find((obj) => obj.id === objectId)
                    : null;
                const tachyonBeamPowered = (() => {
                  const upgrade = player.installedUpgrades.find((u) => u.id === 'tachyon_beam');
                  if (!upgrade) {
                    return false;
                  }
                  return getUpgradePowerStatus(upgrade, ship).isPowered;
                })();
                const canTachyonBeamClearHazard =
                  action.type === 'scan' &&
                  performer?.location === SHIP_SECTIONS.SCI_LAB &&
                  targetObject?.type === 'hazard' &&
                  tachyonBeamPowered;

                return (
                  <div key={`${action.type}:${action.crewId}`} className="mt-1">
                    <div>
                      <span className="font-semibold">{performerLabel}</span>{' '}
                      <span className="text-gravity-muted">({action.type})</span>
                      {typeof objectId === 'string' && objectId.length > 0 ? ` → ${objectId}` : ''}
                    </div>
                    <div className="text-gravity-muted">
                      roll={rollLabel}, range=1 + sciLabFull={sciLabFullyPowered ? `+${sciLabBonus}` : '+0'} + crewBonus={crewBonus} = {totalRange}
                    </div>
                    {canTachyonBeamClearHazard && (
                      <div className="text-gravity-muted">Tachyon Beam: scanning an adjacent hazard will remove it (costs 1 Sci Lab power).</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {attackActions.length > 0 && (
            <div className="mb-2 rounded border border-red-400/30 bg-red-950/10 px-2 py-1 text-[10px] text-red-200">
              <div className="font-semibold">Attack breakdown</div>
              {attackActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const targetObjectId = action.target?.objectId;
                const [die0, die1] = getFixedAttackRollValuesForPreview();
                const base = die0 + die1;

                const tacticalBridgePowered = (() => {
                  const upgrade = player.installedUpgrades.find((u) => u.id === 'tactical_bridge');
                  if (!upgrade) {
                    return false;
                  }
                  return getUpgradePowerStatus(upgrade, ship).isPowered;
                })();
                const canAttackFromBridge = performer?.location === SHIP_SECTIONS.BRIDGE && tacticalBridgePowered;
                const attackSection = canAttackFromBridge ? SHIP_SECTIONS.BRIDGE : SHIP_SECTIONS.DEFENSE;

                const attackSectionFullyPowered = ShipUtils.isFullyPowered(ship, attackSection);
                const attackSectionBonus = attackSectionFullyPowered ? 2 : 0;
                const crewBonus = performer ? getCrewAttackDamageBonusForPreview(performer) : 0;
                const scannedBonus =
                  typeof targetObjectId === 'string' && typeof player.scannedHostiles?.[targetObjectId] === 'number'
                    ? 2
                    : 0;

                const total = base + attackSectionBonus + crewBonus + scannedBonus;

                return (
                  <div key={action.crewId} className="mt-1">
                    <div>
                      <span className="font-semibold">{performerLabel}</span>
                      {typeof targetObjectId === 'string' && targetObjectId.length > 0 ? ` → ${targetObjectId}` : ''}
                    </div>
                    <div className="text-gravity-muted">
                      dice={`${die0}+${die1}`}, base={base}, attackSection={attackSection}, sectionFull={attackSectionFullyPowered ? `+${attackSectionBonus}` : '+0'}, crewBonus={crewBonus}
                      {scannedBonus > 0 ? `, scanned=+${scannedBonus}` : ''}
                      , total={total}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {assembleActions.length > 0 && (
            <div className="mb-2 rounded border border-amber-400/30 bg-amber-950/10 px-2 py-1 text-[10px] text-amber-200">
              <div className="font-semibold">Assemble breakdown</div>
              {assembleActions.map((action) => {
                const performer = allCrew.find((c) => c.id === action.crewId);
                const performerType = performer ? (performer as { type?: unknown }).type : null;
                const performerLabel = performer
                  ? `${performer.name} (${String(performerType)}:${getCrewRole(performer)})`
                  : `Unknown performer (${action.crewId})`;

                const itemType = (action.parameters as any)?.itemType as string | undefined;
                const rollValue = performer && typeof itemType === 'string' ? getFixedAssembleRollValueForPreview(performer, itemType) : null;
                const rollLabel = rollValue === null ? 'unknown' : String(rollValue);

                const crewBonus = performer && typeof itemType === 'string'
                  ? getCrewAssembleBonusForPreview(performer, itemType)
                  : 0;
                const points = rollValue !== null ? rollValue + crewBonus : null;

                const crewState = performer as any;
                const byItem = crewState?.assembleProgressByItemType as Record<string, unknown> | undefined;
                const stored =
                  typeof itemType === 'string' && byItem && typeof byItem === 'object' && !Array.isArray(byItem)
                    ? byItem[itemType]
                    : undefined;
                const existingProgress =
                  typeof stored === 'number' && Number.isFinite(stored) && stored > 0
                    ? stored
                    : (crewState?.assembleItemType === itemType && typeof crewState?.assembleProgress === 'number'
                        ? crewState.assembleProgress
                        : 0);

                const newProgress = points !== null ? existingProgress + points : null;
                const willComplete = newProgress !== null && newProgress >= CREW_CONFIG.ASSEMBLE_THRESHOLD;

                return (
                  <div key={action.crewId} className="mt-1">
                    <div className="font-semibold">{performerLabel}</div>
                    <div className="text-gravity-muted">
                      item={String(itemType ?? '—')}, roll={rollLabel}, crewBonus={crewBonus}
                      {points !== null ? `, points=${points}` : ''}
                      {typeof itemType === 'string' ? `, progress=${existingProgress} → ${newProgress ?? '—'}${willComplete ? ' (complete)' : ''}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(!allRevivesTargeted || !allRepairsTargeted || !allStimsConfigured || !isManeuverCountValid || !allManeuversConfigured || !allBoardTargetsSelected || !allAssemblesConfigured || !allIntegratesConfigured || !allLaunchesConfigured || !allRoutesConfigured) && (
            <div className="mt-1 text-[10px] text-green-300 text-center">
              {!isManeuverCountValid
                ? 'Only one Maneuver action may be planned per player each turn. Clear extra Maneuver actions before advancing.'
                : 'Complete all pending choices before advancing.'}
            </div>
          )}
        </div>
      )}

      {isExecutionPhase && selectedCrew && (
        <div
          className={`panel p-2 ${shouldPulseBanner ? 'banner-pulse-once ring-2 ring-sky-400/60' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-gravity-muted">
              {interactionMode === 'route_power'
                ? `Allocating restored power: ${selectedCrew.name}`
                : interactionMode === 'repair'
                  ? `Select repair target: ${selectedCrew.name}`
                  : (() => {
                      const selectedAction = findPlannedAction(selectedCrew.id, ui.selectedActionSlot);
                      const isBoardTargetAction =
                        selectedAction?.type === 'scan' ||
                        selectedAction?.type === 'acquire' ||
                        selectedAction?.type === 'attack' ||
                        selectedAction?.type === 'launch';
                      const objectId = selectedAction?.target?.objectId;
                      const needsBoardTarget =
                        isBoardTargetAction && !(typeof objectId === 'string' && objectId.length > 0);
                      if (needsBoardTarget) {
                        return `Select board target (${selectedAction?.type}): ${selectedCrew.name}`;
                      }
                      if (selectedAction?.type === 'assemble') {
                        return `Configure assemble: ${selectedCrew.name}`;
                      }
                      if (selectedAction?.type === 'integrate') {
                        return `Select upgrade: ${selectedCrew.name}`;
                      }
                      if (selectedAction?.type === 'maneuver') {
                        return `Plan maneuver: ${selectedCrew.name}`;
                      }
                      if (selectedAction?.type === 'route') {
                        return `Configure power transfer: ${selectedCrew.name}`;
                      }
                      return `Move crew: ${selectedCrew.name}`;
                    })()}
            </div>
            <div className="flex items-center gap-2">
              {(() => {
                const primary = findPlannedAction(selectedCrew.id, 'primary');
                const bonus = findPlannedAction(selectedCrew.id, 'bonus');
                if (!bonus) {
                  return null;
                }
                const activeClass = 'bg-sky-700/40 text-sky-100 border border-sky-400/40';
                const inactiveClass = 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-transparent';
                return (
                  <div className="flex items-center overflow-hidden rounded border border-slate-700/60">
                    <button
                      type="button"
                      className={`px-2 py-1 text-[10px] ${ui.selectedActionSlot === 'primary' ? activeClass : inactiveClass}`}
                      disabled={!primary}
                      onClick={() => {
                        if (!primary) {
                          return;
                        }
                        setExecutionConfirmed(false);
                        setInteractionMode('none');
                        selectActionSlot('primary');
                      }}
                    >
                      Primary
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 text-[10px] ${ui.selectedActionSlot === 'bonus' ? activeClass : inactiveClass}`}
                      disabled={!bonus}
                      onClick={() => {
                        if (!bonus) {
                          return;
                        }
                        setExecutionConfirmed(false);
                        setInteractionMode('none');
                        selectActionSlot('bonus');
                      }}
                    >
                      Bonus
                    </button>
                  </div>
                );
              })()}
              {selectedRestoreAction && (
                <button
                  className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                  onClick={() =>
                    setInteractionMode(
                      interactionMode === 'route_power' ? 'move' : 'route_power',
                    )
                  }
                  type="button"
                >
                  {interactionMode === 'route_power' ? 'Move' : 'Allocate Power'}
                </button>
              )}
              {selectedRepairAction && (
                <button
                  className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                  onClick={() =>
                    setInteractionMode(
                      interactionMode === 'repair' ? 'move' : 'repair',
                    )
                  }
                  type="button"
                >
                  {interactionMode === 'repair' ? 'Move' : 'Repair'}
                </button>
              )}
              {selectedAction && (
                <button
                  className="px-2 py-1 rounded bg-slate-900/60 text-red-100 border border-red-400/30 text-[10px] hover:bg-slate-900"
                  onClick={() => {
                    setExecutionConfirmed(false);
                    setClearConfirm({ kind: 'single', crewId: selectedCrew.id, slot: ui.selectedActionSlot });
                  }}
                  type="button"
                >
                  Clear Action
                </button>
              )}
              <button
                className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                onClick={() => {
                  selectCrew(null);
                  setInteractionMode('none');
                }}
                type="button"
              >
                Done
              </button>
            </div>
          </div>

          {selectedRepairAction && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-300">
                Target:{' '}
                <span className="font-semibold">
                  {(selectedRepairAction.target as any)?.section ?? '—'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {(['hull', 'conduit', 'corridor'] as const).map((t) => {
                  const active = ((selectedRepairAction.parameters as any)?.repairType as string | undefined) === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`px-2 py-1 rounded text-[10px] ${
                        active
                          ? 'bg-amber-700/60 text-amber-100 border border-amber-400/60'
                          : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                      }`}
                      onClick={() => {
                        setExecutionConfirmed(false);
                        updatePlannedActionParameters(selectedCrew.id, { repairType: t }, ui.selectedActionSlot);
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedAction && (() => {
            const isDoctor = selectedCrew && 
              !('captainType' in selectedCrew) &&
              (selectedCrew as any)?.type === 'officer' &&
              (selectedCrew as any)?.role === 'doctor';
            
            if (!isDoctor) {
              return null;
            }

            return (
              <div className="mt-2 rounded border border-fuchsia-400/30 bg-fuchsia-950/10 px-2 py-1 text-[10px] text-fuchsia-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">Stim Pack</div>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-[10px] ${
                      selectedStimmed
                        ? 'bg-fuchsia-700/60 text-fuchsia-100 border border-fuchsia-400/60'
                        : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                    }`}
                    onClick={() => {
                      setExecutionConfirmed(false);
                      if (selectedStimmed) {
                        updatePlannedActionParameters(selectedCrew.id, {
                          stimmed: undefined,
                          stimDoctorId: undefined,
                          secondaryTargetObjectId: undefined,
                          secondaryLaunchType: undefined,
                          secondaryUpgradeId: undefined,
                        }, ui.selectedActionSlot);
                        return;
                      }
                      updatePlannedActionParameters(selectedCrew.id, {
                        stimmed: true,
                        stimDoctorId: undefined,
                      }, ui.selectedActionSlot);
                    }}
                  >
                    {selectedStimmed ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

              {selectedStimmed && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-300">Doctor:</div>
                  {(() => {
                    const actingSection = selectedCrewSection;
                    const eligibleDoctors = allCrew.filter((c): c is AnyCrew => {
                      if ('captainType' in c) {
                        return false;
                      }
                      const crewType = (c as any)?.type;
                      const role = (c as any)?.role;
                      return (
                        selectedStimmed &&
                        crewType === 'officer' &&
                        role === 'doctor' &&
                        c.status === 'active' &&
                        typeof c.location === 'string' &&
                        typeof actingSection === 'string' &&
                        c.location === actingSection &&
                        c.id !== selectedCrew.id
                      );
                    });

                    const stimDoctorId = typeof selectedStimDoctorId === 'string' ? selectedStimDoctorId : '';

                    return (
                      <>
                        <select
                          value={stimDoctorId}
                          onChange={(e) => {
                            const value = e.target.value;
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(selectedCrew.id, {
                              stimDoctorId: value ? value : undefined,
                            }, ui.selectedActionSlot);
                          }}
                          className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                        >
                          <option value="">Select...</option>
                          {eligibleDoctors.map((doc) => {
                            const usedRaw = (doc as any)?.stimPacksUsed as unknown;
                            const used = typeof usedRaw === 'number' && Number.isFinite(usedRaw) && usedRaw >= 0 ? usedRaw : null;
                            return (
                              <option key={doc.id} value={doc.id}>
                                {doc.name}{used !== null ? ` (used ${used}/3)` : ''}
                              </option>
                            );
                          })}
                        </select>
                        {eligibleDoctors.length === 0 && (
                          <span className="text-[10px] text-red-300">No eligible Doctor in this section</span>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {selectedStimmed && (selectedAction.type === 'scan' || selectedAction.type === 'acquire') && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-300">Second target:</div>
                  {(() => {
                    const primaryTarget = selectedAction.target?.objectId;
                    if (typeof primaryTarget !== 'string' || primaryTarget.length === 0) {
                      return <span className="text-[10px] text-gravity-muted">Select primary target first</span>;
                    }

                    const secondaryRaw = (selectedAction.parameters as any)?.secondaryTargetObjectId as unknown;
                    const secondaryTargetObjectId = typeof secondaryRaw === 'string' ? secondaryRaw : '';

                    const sciLabFullyPowered = ShipUtils.isFullyPowered(ship, SHIP_SECTIONS.SCI_LAB);
                    const sciLabBonus = sciLabFullyPowered
                      ? (player.captain.captainType === 'technologist' ? 3 : 2)
                      : 0;
                    const crewBonus = getScanRangeBonusForPreview(selectedCrew);
                    const techBasicBonus =
                      player.captain.captainType === 'technologist' &&
                      !('captainType' in selectedCrew) &&
                      (selectedCrew as any)?.type === 'basic' &&
                      crewBonus > 0
                        ? 1
                        : 0;
                    const maxRange = 1 + sciLabBonus + crewBonus + techBasicBonus;

                    const candidates = game.board.objects.filter((obj) => {
                      if (obj.id === primaryTarget) {
                        return false;
                      }
                      const distance = BoardUtils.calculateDistance(ship.position, obj.position, game.board);
                      return distance <= maxRange;
                    });

                    return (
                      <>
                        <select
                          value={secondaryTargetObjectId}
                          onChange={(e) => {
                            const value = e.target.value;
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(selectedCrew.id, {
                              secondaryTargetObjectId: value ? value : undefined,
                            }, ui.selectedActionSlot);
                          }}
                          className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                        >
                          <option value="">None</option>
                          {candidates.map((obj) => (
                            <option key={obj.id} value={obj.id}>
                              {obj.id} ({obj.type})
                            </option>
                          ))}
                        </select>
                        {candidates.length === 0 && (
                          <span className="text-[10px] text-gravity-muted">No targets in range</span>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {selectedStimmed && selectedAction.type === 'launch' && (
                <div className="mt-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] text-slate-300">Second launch type:</div>
                    {(() => {
                      const secondaryTypeRaw = (selectedAction.parameters as any)?.secondaryLaunchType as unknown;
                      const secondaryLaunchType = typeof secondaryTypeRaw === 'string' ? secondaryTypeRaw : '';
                      return (
                        <select
                          value={secondaryLaunchType}
                          onChange={(e) => {
                            const value = e.target.value;
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(selectedCrew.id, {
                              secondaryLaunchType: value ? value : undefined,
                            }, ui.selectedActionSlot);
                          }}
                          className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                        >
                          <option value="">Same as primary</option>
                          <option value="torpedo">Torpedo</option>
                          <option value="probe">Probe</option>
                        </select>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] text-slate-300">Second target:</div>
                    {(() => {
                      const primaryTarget = selectedAction.target?.objectId;
                      const secondaryRaw = (selectedAction.parameters as any)?.secondaryTargetObjectId as unknown;
                      const secondaryTargetObjectId = typeof secondaryRaw === 'string' ? secondaryRaw : '';
                      const candidates = game.board.objects.filter((obj) => obj.id !== primaryTarget);
                      return (
                        <select
                          value={secondaryTargetObjectId}
                          onChange={(e) => {
                            const value = e.target.value;
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(selectedCrew.id, {
                              secondaryTargetObjectId: value ? value : undefined,
                            }, ui.selectedActionSlot);
                          }}
                          className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                        >
                          <option value="">None</option>
                          {candidates.map((obj) => (
                            <option key={obj.id} value={obj.id}>
                              {obj.id} ({obj.type})
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </div>
                </div>
              )}

              {selectedStimmed && selectedAction.type === 'integrate' && (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-300">Second upgrade:</div>
                  {(() => {
                    const primaryUpgradeIdRaw = (selectedAction.parameters as any)?.upgradeId as unknown;
                    const primaryUpgradeId = typeof primaryUpgradeIdRaw === 'string' ? primaryUpgradeIdRaw : '';
                    const secondaryRaw = (selectedAction.parameters as any)?.secondaryUpgradeId as unknown;
                    const secondaryUpgradeId = typeof secondaryRaw === 'string' ? secondaryRaw : '';
                    const candidates = player.pendingUpgrades.filter((u) => u.id !== primaryUpgradeId);
                    return (
                      <>
                        <select
                          value={secondaryUpgradeId}
                          onChange={(e) => {
                            const value = e.target.value;
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(selectedCrew.id, {
                              secondaryUpgradeId: value ? value : undefined,
                            }, ui.selectedActionSlot);
                          }}
                          className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                        >
                          <option value="">None</option>
                          {candidates.map((upgrade) => (
                            <option key={upgrade.id} value={upgrade.id}>
                              {upgrade.name}
                            </option>
                          ))}
                        </select>
                        {candidates.length === 0 && (
                          <span className="text-[10px] text-gravity-muted">No second upgrade available</span>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            );
          })()}

          {selectedAction &&
            (selectedAction.type === 'revive' ||
              selectedAction.type === 'scan' ||
              selectedAction.type === 'acquire' ||
              (selectedAction.type === 'launch' &&
                ((selectedAction.parameters as any)?.launchType as string | undefined) === 'probe')) && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[10px] text-slate-300">Roll (d6):</div>
                <div className="text-[10px] text-slate-200">
                  {selectedAction.type === 'revive'
                    ? `Auto: ${getFixedReviveRollValueForPreview(selectedCrew)}`
                    : `Auto: ${getFixedDiscoveryRollValueForPreview(selectedCrew)}`}
                </div>
              </div>
            )}

          {selectedAction && selectedAction.type === 'attack' && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-300">Roll (2d6):</div>
              <div className="text-[10px] text-slate-200">Auto: 3 + 3</div>
            </div>
          )}

          {selectedAssembleAction && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-300">Craft item:</div>
              <div className="flex items-center gap-1">
                {(['spare_parts', 'medical_kit', 'probe', 'torpedo'] as const).map((item) => {
                  const active = ((selectedAssembleAction.parameters as any)?.itemType as string | undefined) === item;
                  const labels: Record<string, string> = {
                    spare_parts: 'Parts',
                    medical_kit: 'Med-Kit',
                    probe: 'Probe',
                    torpedo: 'Torpedo',
                  };
                  return (
                    <button
                      key={item}
                      type="button"
                      className={`px-2 py-1 rounded text-[10px] ${
                        active
                          ? 'bg-amber-700/60 text-amber-100 border border-amber-400/60'
                          : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                      }`}
                      onClick={() => {
                        setExecutionConfirmed(false);
                        updatePlannedActionParameters(selectedCrew.id, { itemType: item }, ui.selectedActionSlot);
                      }}
                    >
                      {labels[item]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedAssembleAction && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-300">Roll (d6):</div>
              <div className="text-[10px] text-slate-200">
                {(() => {
                  const itemType = (selectedAssembleAction.parameters as any)?.itemType as string | undefined;
                  if (!itemType) {
                    return 'Auto: —';
                  }
                  return `Auto: ${getFixedAssembleRollValueForPreview(selectedCrew, itemType)}`;
                })()}
              </div>
            </div>
          )}

          {selectedIntegrateAction && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-300">Select upgrade:</div>
              <select
                value={((selectedIntegrateAction.parameters as any)?.upgradeId as string | undefined) ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  setExecutionConfirmed(false);
                  updatePlannedActionParameters(selectedCrew.id, { upgradeId: value }, ui.selectedActionSlot);
                }}
                className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
              >
                <option value="">Select...</option>
                {player.pendingUpgrades.map((upgrade) => (
                  <option key={upgrade.id} value={upgrade.id}>
                    {upgrade.name}
                  </option>
                ))}
              </select>
              {player.pendingUpgrades.length === 0 && (
                <span className="text-[10px] text-red-400">No upgrades available</span>
              )}
            </div>
          )}

          {selectedLaunchAction && (
            <div className="mt-1 flex items-center justify-between gap-2">
              <div className="text-[10px] text-slate-300">
                Launch type:
              </div>
              <div className="flex items-center gap-1">
                {(['torpedo', 'probe'] as const).map((t) => {
                  const active = ((selectedLaunchAction.parameters as any)?.launchType as string | undefined) === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`px-2 py-1 rounded text-[10px] ${
                        active
                          ? 'bg-red-700/60 text-red-100 border border-red-400/60'
                          : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                      }`}
                      onClick={() => {
                        setExecutionConfirmed(false);
                        updatePlannedActionParameters(selectedCrew.id, { launchType: t }, ui.selectedActionSlot);
                      }}
                    >
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-slate-400">
                Target: {selectedLaunchAction.target?.objectId ? '✓' : '—'}
              </div>
            </div>
          )}

          {selectedRouteAction && (() => {
            const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
            const params = selectedRouteAction.parameters as { sourceSection?: string; targetSection?: string; amount?: number } | undefined;
            const sourceSection = params?.sourceSection ?? '';
            const targetSection = params?.targetSection ?? '';
            const amount = params?.amount ?? 1;

            const safeLifeSupportPower =
              typeof ship.lifeSupportPower === 'number' && Number.isFinite(ship.lifeSupportPower) && ship.lifeSupportPower > 0
                ? ship.lifeSupportPower
                : 0;

            const sourceIsLifeSupport = sourceSection === LIFE_SUPPORT_ROUTE_KEY;
            const targetIsLifeSupport = targetSection === LIFE_SUPPORT_ROUTE_KEY;

            // Get sections with power (available as source)
            const sectionsWithPower = (Object.values(SHIP_SECTIONS) as ShipSection[])
              .filter((s) => {
                const state = ship.sections[s];
                return state && state.hull > 0 && state.powerDice.length > 0 && state.powerDice.reduce((sum, d) => sum + d, 0) > 0;
              })
              .map((s) => s as string);

            if (safeLifeSupportPower > 0) {
              sectionsWithPower.push(LIFE_SUPPORT_ROUTE_KEY);
            }

            // Calculate available power in source section
            const sourcePower = sourceSection
              ? sourceIsLifeSupport
                ? safeLifeSupportPower
                : ship.sections[sourceSection as ShipSection]?.powerDice.reduce((sum, d) => sum + d, 0) ?? 0
              : 0;

            // Calculate capacity in target section (simplified: assume max 18 power per section)
            const targetState = targetSection && !targetIsLifeSupport ? ship.sections[targetSection as ShipSection] : null;
            const targetCurrentPower = targetState?.powerDice.reduce((sum, d) => sum + d, 0) ?? 0;
            const targetCapacity = targetIsLifeSupport ? Infinity : 18 - targetCurrentPower; // Max 3 dice × 6 value = 18

            const lifeSupportEdgeConduits = (() => {
              if (!sourceIsLifeSupport || targetIsLifeSupport) {
                return null;
              }
              if (typeof targetSection !== 'string' || targetSection.length === 0) {
                return null;
              }

              const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
              let totalConduitsAtEdges = 0;
              for (const neighbor of sectionKeys) {
                if (neighbor === (targetSection as ShipSection)) {
                  continue;
                }
                const aToB = ship.sections[targetSection as ShipSection]?.conduitConnections?.[neighbor] ?? 0;
                const bToA = ship.sections[neighbor]?.conduitConnections?.[targetSection as ShipSection] ?? 0;
                const conduitsOnEdge = Math.min(aToB, bToA);
                if (conduitsOnEdge > 0) {
                  totalConduitsAtEdges += conduitsOnEdge;
                }
              }
              return totalConduitsAtEdges;
            })();

            // Calculate path and bottleneck conduit
            const path =
              sourceSection &&
              targetSection &&
              sourceSection !== targetSection &&
              !sourceIsLifeSupport &&
              !targetIsLifeSupport
                ? findRoutingPath(ship, sourceSection as ShipSection, targetSection as ShipSection)
                : null;

            // Find minimum conduits along path (bottleneck) - conduitConnections now stores the count per connection
            let minConduitsOnPath = Infinity;
            if (path && path.length > 1) {
              for (let i = 0; i < path.length - 1; i++) {
                const fromSection = path[i];
                const toSection = path[i + 1];
                const fromState = ship.sections[fromSection];
                const conduitCount = fromState?.conduitConnections?.[toSection] ?? 0;
                minConduitsOnPath = Math.min(minConduitsOnPath, conduitCount);
              }
            }

            const safeCapacity = (() => {
              if (typeof lifeSupportEdgeConduits === 'number') {
                return lifeSupportEdgeConduits > 0 ? lifeSupportEdgeConduits * 3 : 0;
              }
              if (!sourceIsLifeSupport && !targetIsLifeSupport) {
                return minConduitsOnPath === Infinity ? 0 : minConduitsOnPath * 3;
              }
              return 0;
            })();

            const safeCapacityDetails = (() => {
              if (typeof lifeSupportEdgeConduits === 'number') {
                return `edges: ${lifeSupportEdgeConduits} conduit${lifeSupportEdgeConduits !== 1 ? 's' : ''}`;
              }
              return `bottleneck: ${minConduitsOnPath} conduit${minConduitsOnPath !== 1 ? 's' : ''}`;
            })();

            const maxTransfer = (() => {
              if (!sourceSection || !targetSection || sourceSection === targetSection) {
                return 0;
              }
              if (targetIsLifeSupport) {
                return sourcePower;
              }
              if (sourceIsLifeSupport) {
                return Math.min(sourcePower, targetCapacity);
              }
              return Math.min(sourcePower, targetCapacity, path ? Infinity : 0);
            })();

            const willOverload = amount > safeCapacity && safeCapacity > 0;

            return (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gravity-muted w-12">From:</span>
                  <select
                    value={sourceSection}
                    onChange={(e) => {
                      setExecutionConfirmed(false);
                      updatePlannedActionParameters(selectedCrew.id, { sourceSection: e.target.value || null }, ui.selectedActionSlot);
                    }}
                    className="flex-1 px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                  >
                    <option value="">Select source...</option>
                    {sectionsWithPower.map((s) => {
                      const power =
                        s === LIFE_SUPPORT_ROUTE_KEY
                          ? safeLifeSupportPower
                          : ship.sections[s as ShipSection]?.powerDice.reduce((sum, d) => sum + d, 0) ?? 0;
                      return (
                        <option key={s} value={s}>
                          {s === LIFE_SUPPORT_ROUTE_KEY
                            ? `LIFE SUPPORT (${power} power)`
                            : `${s.replace('_', ' ').toUpperCase()} (${power} power)`}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gravity-muted w-12">To:</span>
                  <select
                    value={targetSection}
                    onChange={(e) => {
                      setExecutionConfirmed(false);
                      updatePlannedActionParameters(selectedCrew.id, { targetSection: e.target.value || null }, ui.selectedActionSlot);
                    }}
                    className="flex-1 px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                  >
                    <option value="">Select target...</option>
                    {([...Object.values(SHIP_SECTIONS), LIFE_SUPPORT_ROUTE_KEY] as Array<ShipSection | string>).map((s) => {
                        const canReach = (() => {
                          if (!sourceSection) {
                            return true;
                          }
                          if (sourceSection === LIFE_SUPPORT_ROUTE_KEY || s === LIFE_SUPPORT_ROUTE_KEY) {
                            return true;
                          }
                          return findRoutingPath(ship, sourceSection as ShipSection, s as ShipSection) !== null;
                        })();

                        const state = s === LIFE_SUPPORT_ROUTE_KEY ? null : ship.sections[s as ShipSection];
                        const hasHull = s === LIFE_SUPPORT_ROUTE_KEY ? true : !!state && state.hull > 0;
                        const isSameAsSource = !!sourceSection && sourceSection === s;
                        const hasLifeSupportConduits = (() => {
                          if (sourceSection !== LIFE_SUPPORT_ROUTE_KEY) {
                            return true;
                          }
                          if (s === LIFE_SUPPORT_ROUTE_KEY) {
                            return true;
                          }
                          const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
                          let totalConduitsAtEdges = 0;
                          for (const neighbor of sectionKeys) {
                            if (neighbor === (s as ShipSection)) {
                              continue;
                            }
                            const aToB = ship.sections[s as ShipSection]?.conduitConnections?.[neighbor] ?? 0;
                            const bToA = ship.sections[neighbor]?.conduitConnections?.[s as ShipSection] ?? 0;
                            const conduitsOnEdge = Math.min(aToB, bToA);
                            if (conduitsOnEdge > 0) {
                              totalConduitsAtEdges += conduitsOnEdge;
                            }
                          }
                          return totalConduitsAtEdges > 0;
                        })();
                        const currentPower =
                          s === LIFE_SUPPORT_ROUTE_KEY
                            ? safeLifeSupportPower
                            : state?.powerDice.reduce((sum, d) => sum + d, 0) ?? 0;
                        return (
                          <option
                            key={s}
                            value={s}
                            disabled={!canReach || !hasHull || !hasLifeSupportConduits || isSameAsSource}
                          >
                            {s === LIFE_SUPPORT_ROUTE_KEY
                              ? `LIFE SUPPORT (${currentPower} power)${!canReach ? ' (no path)' : ''}${isSameAsSource ? ' (same as source)' : ''}`
                              : `${(s as string).replace('_', ' ').toUpperCase()} (${currentPower}/18)${!hasHull ? ' (hull 0)' : ''}${!canReach ? ' (no path)' : ''}${!hasLifeSupportConduits ? ' (no conduits)' : ''}${isSameAsSource ? ' (same as source)' : ''}`}
                          </option>
                        );
                      })}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gravity-muted w-12">Amount:</span>
                  <input
                    type="number"
                    min={1}
                    max={maxTransfer}
                    value={amount}
                    onChange={(e) => {
                      const parsed = Number(e.target.value);
                      const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(maxTransfer, parsed)) : 1;
                      setExecutionConfirmed(false);
                      updatePlannedActionParameters(selectedCrew.id, { amount: clamped }, ui.selectedActionSlot);
                    }}
                    className="w-14 px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded text-right"
                  />
                  <span className="text-[10px] text-gravity-muted">
                    / {maxTransfer} max
                  </span>
                </div>
                {path && path.length > 1 && (
                  <div className="text-[10px] text-slate-400">
                    Path: {path.map((s) => s.replace('_', ' ').toUpperCase()).join(' → ')}
                  </div>
                )}
                {safeCapacity > 0 && (
                  <div className={`text-[10px] ${willOverload ? 'text-red-400' : 'text-cyan-400'}`}>
                    Safe capacity: {safeCapacity} ({safeCapacityDetails})
                    {willOverload && ' ⚠️ Will damage conduit!'}
                  </div>
                )}
                {!path && sourceSection && targetSection && !sourceIsLifeSupport && !targetIsLifeSupport && (
                  <div className="text-[10px] text-red-400">
                    No conduit path between these sections!
                  </div>
                )}
              </div>
            );
          })()}

          {selectedManeuverAction && (
            (() => {
              const params = selectedManeuverAction.parameters as
                | {
                    direction?: unknown;
                    powerSpent?: unknown;
                    distance?: unknown;
                    draftDirection?: unknown;
                    draftPowerSpent?: unknown;
                    draftDistance?: unknown;
                  }
                | undefined;

              const committedDirection =
                typeof params?.direction === 'string' ? params.direction : 'forward';
              const committedPowerSpent =
                typeof params?.powerSpent === 'number' && Number.isFinite(params.powerSpent)
                  ? params.powerSpent
                  : 1;
              const committedDistance =
                typeof params?.distance === 'number' && Number.isFinite(params.distance) && Number.isInteger(params.distance) && params.distance >= 1
                  ? params.distance
                  : null;

              const draftDirectionRaw = (params as any)?.draftDirection as unknown;
              const draftDirection = typeof draftDirectionRaw === 'string' ? draftDirectionRaw : undefined;

              const draftPowerSpentRaw = (params as any)?.draftPowerSpent as unknown;
              const draftPowerSpent =
                typeof draftPowerSpentRaw === 'number' && Number.isFinite(draftPowerSpentRaw)
                  ? draftPowerSpentRaw
                  : undefined;

              const draftDistanceRaw = (params as any)?.draftDistance as unknown;
              const draftDistance =
                draftDistanceRaw === null
                  ? null
                  : typeof draftDistanceRaw === 'number' &&
                      Number.isFinite(draftDistanceRaw) &&
                      Number.isInteger(draftDistanceRaw) &&
                      draftDistanceRaw >= 1
                    ? draftDistanceRaw
                    : undefined;

              const isEditing =
                draftDirection !== undefined ||
                draftPowerSpent !== undefined ||
                draftDistance !== undefined;

              const workingDirection = draftDirection ?? committedDirection;
              const workingPowerSpent = draftPowerSpent ?? committedPowerSpent;
              const workingDistance = draftDistance !== undefined ? draftDistance : committedDistance;
              const previewDistance = workingDistance === null ? undefined : workingDistance;

              const drivesPower = ship.sections[SHIP_SECTIONS.DRIVES]?.powerDice.reduce((sum, d) => sum + d, 0) ?? 0;

              let previewError: string | null = null;
              let previewSummary: { ring: number; space: number; acceleration: number; distanceMoved: number } | null = null;
              let previewDamageSummary:
                | {
                    ringColor: 'green' | 'yellow' | 'orange' | 'red';
                    environment: { hull: number; conduits: number; corridors: number };
                    hazard: { hull: number; lifeSupportReduction: number };
                  }
                | null = null;

              try {
                const preview = previewManeuver(
                  ship,
                  selectedCrew,
                  workingDirection,
                  workingPowerSpent,
                  game.board,
                  previewDistance,
                  player.installedUpgrades,
                );
                previewSummary = {
                  ring: preview.updatedShip.position.ring,
                  space: preview.updatedShip.position.space,
                  acceleration: preview.acceleration,
                  distanceMoved: preview.distanceMoved,
                };

                const destination = preview.updatedShip.position;
                const ringColor = BoardUtils.getRingColor(destination.ring);
                const environment = computeEnvironmentDamageForPosition(destination, game.board);
                const hazard = computeHazardDamageForPosition(destination, game.board);
                previewDamageSummary = {
                  ringColor,
                  environment,
                  hazard,
                };
              } catch (e) {
                previewError = e instanceof Error ? e.message : String(e);
              }

              const directionOk =
                workingDirection === 'forward' ||
                workingDirection === 'backward' ||
                workingDirection === 'inward' ||
                workingDirection === 'outward';

              const powerOk =
                typeof workingPowerSpent === 'number' &&
                Number.isFinite(workingPowerSpent) &&
                workingPowerSpent >= 1;

              const distanceOk =
                workingDistance === null ||
                (typeof workingDistance === 'number' &&
                  Number.isFinite(workingDistance) &&
                  Number.isInteger(workingDistance) &&
                  workingDistance >= 1);

              const canConfirm = isEditing && directionOk && powerOk && distanceOk;

              return (
                <div className="mt-2 space-y-2">
                  {!isEditing && (
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] text-slate-300">
                        Maneuver: <span className="font-semibold">{committedDirection}</span> | Power{' '}
                        <span className="font-semibold">{committedPowerSpent}</span> | Move{' '}
                        <span className="font-semibold">{committedDistance === null ? 'full' : committedDistance}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                          onClick={() => {
                            setExecutionConfirmed(false);
                            updatePlannedActionParameters(selectedCrew.id, {
                              draftDirection: committedDirection,
                              draftPowerSpent: committedPowerSpent,
                              draftDistance: committedDistance,
                            }, ui.selectedActionSlot);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-slate-900/60 text-red-100 border border-red-400/30 text-[10px] hover:bg-slate-900"
                          onClick={() => {
                            setExecutionConfirmed(false);
                            setClearConfirm({ kind: 'single', crewId: selectedCrew.id, slot: ui.selectedActionSlot });
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {isEditing && (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-slate-300">
                          Drives power: <span className="font-semibold">{drivesPower}</span> | Spend:{' '}
                          <span className="font-semibold">{workingPowerSpent}</span>
                          {previewSummary && (
                            <>
                              {' '}| Max accel: <span className="font-semibold">{previewSummary.acceleration}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                            onClick={() => {
                              setExecutionConfirmed(false);
                              updatePlannedActionParameters(selectedCrew.id, {
                                draftDirection: undefined,
                                draftPowerSpent: undefined,
                                draftDistance: undefined,
                              }, ui.selectedActionSlot);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-slate-900/60 text-red-100 border border-red-400/30 text-[10px] hover:bg-slate-900"
                            onClick={() => {
                              setExecutionConfirmed(false);
                              setClearConfirm({ kind: 'single', crewId: selectedCrew.id, slot: ui.selectedActionSlot });
                            }}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            disabled={!canConfirm}
                            className="px-2 py-1 rounded text-[10px] disabled:opacity-50 bg-sky-700/60 text-sky-100 border border-sky-400/60 hover:bg-sky-700"
                            onClick={() => {
                              if (!canConfirm) {
                                return;
                              }
                              setExecutionConfirmed(false);
                              updatePlannedActionParameters(selectedCrew.id, {
                                direction: workingDirection,
                                powerSpent: workingPowerSpent,
                                distance: workingDistance,
                                draftDirection: undefined,
                                draftPowerSpent: undefined,
                                draftDistance: undefined,
                              }, ui.selectedActionSlot);
                            }}
                          >
                            Confirm
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-gravity-muted">Direction</div>
                        <div className="flex items-center gap-1">
                          {([
                            { key: 'forward', label: 'Forward' },
                            { key: 'backward', label: 'Backward' },
                            { key: 'inward', label: 'Inward' },
                            { key: 'outward', label: 'Outward' },
                          ] as const).map((opt) => {
                            const active = workingDirection === opt.key;
                            return (
                              <button
                                key={opt.key}
                                type="button"
                                className={`px-2 py-1 rounded text-[10px] ${
                                  active
                                    ? 'bg-amber-700/60 text-amber-100 border border-amber-400/60'
                                    : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                                }`}
                                onClick={() => {
                                  setExecutionConfirmed(false);
                                  updatePlannedActionParameters(selectedCrew.id, {
                                    draftDirection: opt.key,
                                  }, ui.selectedActionSlot);
                                }}
                              >
                                {opt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-gravity-muted">Power</div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3].map((value) => {
                            const active = workingPowerSpent === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                className={`w-8 px-2 py-1 rounded text-[10px] text-center ${
                                  active
                                    ? 'bg-amber-700/60 text-amber-100 border border-amber-400/60'
                                    : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                                }`}
                                onClick={() => {
                                  setExecutionConfirmed(false);
                                  updatePlannedActionParameters(selectedCrew.id, {
                                    draftPowerSpent: value,
                                  }, ui.selectedActionSlot);
                                }}
                              >
                                {value}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-gravity-muted">Distance</div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={`px-2 py-1 rounded text-[10px] ${
                              workingDistance === null
                                ? 'bg-amber-700/60 text-amber-100 border border-amber-400/60'
                                : 'bg-slate-800 text-slate-100 hover:bg-slate-700'
                            }`}
                            onClick={() => {
                              setExecutionConfirmed(false);
                              updatePlannedActionParameters(selectedCrew.id, {
                                draftDistance: null,
                              }, ui.selectedActionSlot);
                            }}
                          >
                            Full
                          </button>

                          <input
                            type="number"
                            min={1}
                            max={previewSummary?.acceleration ?? undefined}
                            value={workingDistance === null ? '' : String(workingDistance)}
                            placeholder={previewSummary ? String(previewSummary.acceleration) : '—'}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                setExecutionConfirmed(false);
                                updatePlannedActionParameters(selectedCrew.id, {
                                  draftDistance: null,
                                }, ui.selectedActionSlot);
                                return;
                              }

                              const parsed = Number(raw);
                              if (!Number.isFinite(parsed)) {
                                return;
                              }

                              const max = previewSummary?.acceleration ?? Infinity;
                              const clamped = Math.max(1, Math.min(max, Math.floor(parsed)));
                              setExecutionConfirmed(false);
                              updatePlannedActionParameters(selectedCrew.id, {
                                draftDistance: clamped,
                              }, ui.selectedActionSlot);
                            }}
                            className="w-16 px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded text-right disabled:opacity-50"
                          />

                          {previewSummary && (
                            <span className="text-[10px] text-gravity-muted">/ {previewSummary.acceleration} max</span>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {previewError && (
                    <div className="rounded border border-red-500/40 bg-red-950/30 px-2 py-1 text-[10px] text-red-200 whitespace-pre-wrap">
                      {previewError}
                    </div>
                  )}

                  {previewSummary && (
                    <div className="text-[10px] text-slate-300">
                      Preview: Ring <span className="font-semibold">{previewSummary.ring}</span>, Space{' '}
                      <span className="font-semibold">{previewSummary.space}</span> | Accel{' '}
                      <span className="font-semibold">{previewSummary.acceleration}</span> | Move{' '}
                      <span className="font-semibold">{previewSummary.distanceMoved}</span>
                    </div>
                  )}

                  {previewDamageSummary && (() => {
                    const env = previewDamageSummary.environment;
                    const haz = previewDamageSummary.hazard;
                    const totalHull = env.hull + haz.hull;
                    const hasAny = totalHull > 0 || env.conduits > 0 || env.corridors > 0 || haz.lifeSupportReduction > 0;
                    if (!hasAny) {
                      return null;
                    }

                    const zoneLabel = previewDamageSummary.ringColor.toUpperCase();
                    const flavor =
                      previewDamageSummary.ringColor === 'red'
                        ? 'Red ring. The gravity well wants a sacrifice.'
                        : previewDamageSummary.ringColor === 'orange'
                          ? 'Orange ring. Your hull is about to get sandblasted by the cosmos.'
                          : previewDamageSummary.ringColor === 'yellow'
                            ? 'Yellow ring. Minor turbulence ahead.'
                            : 'Calm space… mostly.';

                    const envLine =
                      env.hull > 0 || env.conduits > 0 || env.corridors > 0
                        ? `Environment forecast (${zoneLabel}): hull -${env.hull}${env.conduits > 0 ? `, conduits -${env.conduits}` : ''}${env.corridors > 0 ? `, corridors -${env.corridors}` : ''}.`
                        : null;

                    const hazLine =
                      haz.hull > 0 || haz.lifeSupportReduction > 0
                        ? `Radiation proximity: hull -${haz.hull}${haz.lifeSupportReduction > 0 ? `, life support -${haz.lifeSupportReduction}` : ''}.`
                        : null;

                    return (
                      <div className="rounded border border-amber-400/40 bg-amber-950/15 px-2 py-1 text-[10px] text-amber-100">
                        <div className="font-semibold">Cosmic forecast</div>
                        <div className="text-amber-200/90">{flavor}</div>
                        {envLine && <div className="mt-0.5">{envLine}</div>}
                        {hazLine && <div className="mt-0.5">{hazLine}</div>}
                        {totalHull > 0 && (
                          <div className="mt-0.5 text-amber-200/90">
                            Total expected hull damage next Environment: <span className="font-semibold">{totalHull}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {isEditing && (
                    <div className="text-[10px] text-sky-300 text-center">
                      Board preview updates live. Confirm or cancel to continue.
                    </div>
                  )}
                </div>
              );
            })()
          )}
          {interactionMode === 'route_power' && routingContext && (
            <div className="mt-1 text-[10px] text-sky-300 text-center">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <div>
                  Power restored: {routingContext.restoredPower} | Allocated: {routingContext.totalAllocated} | Deposits to {String(routingContext.sourceSection)}: {Math.max(0, routingContext.restoredPower - routingContext.totalAllocated)}
                </div>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-slate-800 text-slate-100 hover:bg-slate-700"
                  onClick={() => {
                    setExecutionConfirmed(false);
                    updatePlannedActionParameters(routingContext.crewId, { routeAllocations: [] }, ui.selectedActionSlot);
                  }}
                >
                  Clear Allocations
                </button>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-slate-800 text-slate-100 hover:bg-slate-700"
                  onClick={() => {
                    setExecutionConfirmed(false);
                    updatePlannedActionParameters(routingContext.crewId, { transfers: [] }, ui.selectedActionSlot);
                  }}
                >
                  Clear Transfers
                </button>
              </div>
              <div className="mt-0.5">
                Click sections to allocate restored power from {String(routingContext.sourceSection)}.
                Unallocated power deposits in {String(routingContext.sourceSection)}.
              </div>
              <div className="mt-0.5">
                Conduit overload is cumulative across ALL Restore allocations + transfers this turn.
                Exceeding {POWER_CONFIG.MAX_POWER_PER_CONDUIT} per conduit on an edge will damage that conduit.
              </div>
              <div className="mt-0.5">Cannot route power to sections with 0 hull. Fix: Repair hull first.</div>

              {(() => {
                const LIFE_SUPPORT_ROUTE_KEY = 'life_support';
                const restoreAction = findPlannedAction(routingContext.crewId, ui.selectedActionSlot, 'restore');
                const rawTransfers = (restoreAction?.parameters as any)?.transfers as
                  | Array<{ fromSection?: string; toSection?: string; toUpgradeId?: string; amount?: number }>
                  | undefined;
                const allTransfers = Array.isArray(rawTransfers) ? rawTransfers : [];

                const sectionKeys = Object.values(SHIP_SECTIONS) as ShipSection[];
                const transferTargetOptions = [...sectionKeys, LIFE_SUPPORT_ROUTE_KEY] as Array<
                  ShipSection | typeof LIFE_SUPPORT_ROUTE_KEY
                >;
                const safeLifeSupportPower =
                  typeof ship.lifeSupportPower === 'number' &&
                  Number.isFinite(ship.lifeSupportPower) &&
                  ship.lifeSupportPower > 0
                    ? ship.lifeSupportPower
                    : 0;

                const defaultSection = routingContext.sourceSection ?? sectionKeys[0];
                const defaultToSection =
                  routingContext.sourceSection === DEFAULT_POWER_ROUTING_HUB_SECTION
                    ? SHIP_SECTIONS.BRIDGE
                    : DEFAULT_POWER_ROUTING_HUB_SECTION;
                const maxUpgradeTransferAmount = POWER_CONFIG.MAX_POWER_PER_CONDUIT;

                const upgradeTargets = player.installedUpgrades
                  .map((u) => {
                    const status = getUpgradePowerStatus(u, ship);
                    if (status.upgradePowerRequired <= 0) {
                      return null;
                    }
                    const label = u.name ?? u.id;
                    const sectionLabel = status.section ? (SECTION_CONFIG[status.section]?.label ?? status.section) : '—';
                    return {
                      id: u.id,
                      label,
                      sectionLabel,
                    };
                  })
                  .filter((x): x is { id: string; label: string; sectionLabel: string } => !!x);

                type TransferEntry = {
                  fromSection: ShipSection;
                  toSection?: ShipSection | typeof LIFE_SUPPORT_ROUTE_KEY;
                  toUpgradeId?: string;
                  amount: number;
                };

                const normalizeTransfers = (
                  nextRaw: Array<Record<string, unknown>>,
                ): TransferEntry[] => {
                  const normalized: TransferEntry[] = [];
                  const upgradeLoad = new Map<string, number>();

                  for (const entry of nextRaw) {
                    const fromRaw = (entry as any)?.fromSection as unknown;
                    const toRaw = (entry as any)?.toSection as unknown;
                    const toUpgradeIdRaw = (entry as any)?.toUpgradeId as unknown;
                    const amountRaw = (entry as any)?.amount as unknown;

                    const fromSection =
                      typeof fromRaw === 'string' && sectionKeys.includes(fromRaw as ShipSection)
                        ? (fromRaw as ShipSection)
                        : defaultSection;

                    const amount =
                      typeof amountRaw === 'number' && Number.isFinite(amountRaw) && amountRaw > 0
                        ? amountRaw
                        : 1;

                    if (typeof toUpgradeIdRaw === 'string' && toUpgradeIdRaw.length > 0) {
                      const previous = upgradeLoad.get(toUpgradeIdRaw) ?? 0;
                      const remaining = Math.max(0, maxUpgradeTransferAmount - previous);
                      if (remaining <= 0) {
                        continue;
                      }
                      const clamped = Math.max(1, Math.min(maxUpgradeTransferAmount, Math.min(amount, remaining)));
                      upgradeLoad.set(toUpgradeIdRaw, previous + clamped);
                      normalized.push({
                        fromSection,
                        toUpgradeId: toUpgradeIdRaw,
                        amount: clamped,
                      });
                      continue;
                    }

                    let candidate: ShipSection | typeof LIFE_SUPPORT_ROUTE_KEY = defaultToSection;
                    if (typeof toRaw === 'string') {
                      if (sectionKeys.includes(toRaw as ShipSection)) {
                        candidate = toRaw as ShipSection;
                      } else if (toRaw === LIFE_SUPPORT_ROUTE_KEY) {
                        candidate = LIFE_SUPPORT_ROUTE_KEY;
                      }
                    }

                    const safeToSection =
                      candidate === LIFE_SUPPORT_ROUTE_KEY
                        ? LIFE_SUPPORT_ROUTE_KEY
                        : candidate === fromSection
                          ? defaultToSection
                          : candidate;

                    normalized.push({
                      fromSection,
                      toSection: safeToSection,
                      amount: Math.max(1, Math.floor(amount)),
                    });
                  }

                  return normalized;
                };

                const transfers = normalizeTransfers(
                  allTransfers.filter((t) => t && typeof t === 'object') as Array<Record<string, unknown>>,
                );

                const setTransfers = (next: TransferEntry[]) => {
                  setExecutionConfirmed(false);
                  updatePlannedActionParameters(routingContext.crewId, {
                    transfers: next as any,
                  }, ui.selectedActionSlot);
                };

                const addTransfer = () => {
                  setTransfers([
                    ...transfers,
                    {
                      fromSection: routingContext.sourceSection ?? defaultSection,
                      toSection: defaultToSection,
                      amount: 1,
                    },
                  ]);
                };

                if (transfers.length === 0) {
                  return (
                    <div className="mt-1">
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-100 hover:bg-slate-700"
                        onClick={addTransfer}
                      >
                        Add Transfer
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center justify-center gap-2">
                      <div className="font-semibold">Transfers</div>
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-100 hover:bg-slate-700"
                        onClick={addTransfer}
                      >
                        Add
                      </button>
                    </div>

                    {transfers.map((t, index) => {
                      const fromSection = t.fromSection;
                      const amount = t.amount;

                      const targetValue =
                        typeof t.toUpgradeId === 'string' && t.toUpgradeId.length > 0
                          ? `upgrade:${t.toUpgradeId}`
                          : `section:${t.toSection ?? defaultToSection}`;

                      const isUpgradeTarget = typeof t.toUpgradeId === 'string' && t.toUpgradeId.length > 0;

                      return (
                        <div key={`restore-transfer-${index}`} className="flex items-center justify-center gap-2 flex-wrap">
                          <select
                            value={fromSection}
                            onChange={(e) => {
                              const next: TransferEntry[] = transfers.map((entry, i): TransferEntry =>
                                i === index
                                  ? {
                                      ...entry,
                                      fromSection: e.target.value as ShipSection,
                                    }
                                  : entry,
                              );
                              setTransfers(next);
                            }}
                            className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                          >
                            {sectionKeys.map((s) => (
                              <option key={`from-${s}`} value={s}>
                                {s.replace('_', ' ').toUpperCase()}
                              </option>
                            ))}
                          </select>

                          <span>→</span>

                          <select
                            value={targetValue}
                            onChange={(e) => {
                              const value = e.target.value;
                              const next: TransferEntry[] = transfers.map((entry, i): TransferEntry => {
                                if (i !== index) {
                                  return entry;
                                }

                                if (value.startsWith('upgrade:')) {
                                  const id = value.slice('upgrade:'.length);
                                  return {
                                    fromSection: entry.fromSection,
                                    toUpgradeId: id,
                                    amount: Math.max(1, Math.min(maxUpgradeTransferAmount, entry.amount)),
                                  };
                                }

                                if (value.startsWith('section:')) {
                                  const key = value.slice('section:'.length);
                                  const normalizedSection = (() => {
                                    if (key === LIFE_SUPPORT_ROUTE_KEY) {
                                      return LIFE_SUPPORT_ROUTE_KEY;
                                    }
                                    return sectionKeys.includes(key as ShipSection)
                                      ? (key as ShipSection)
                                      : defaultToSection;
                                  })();
                                  return {
                                    fromSection: entry.fromSection,
                                    toSection: normalizedSection,
                                    amount: Math.max(1, Math.floor(entry.amount)),
                                  };
                                }

                                return entry;
                              });
                              setTransfers(next);
                            }}
                            className="px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded"
                          >
                            {transferTargetOptions.map((s) => (
                              <option key={`to-section-${s}`} value={`section:${s}`}>
                                {s === LIFE_SUPPORT_ROUTE_KEY
                                  ? `LIFE SUPPORT (${safeLifeSupportPower} power)`
                                  : s.replace('_', ' ').toUpperCase()}
                              </option>
                            ))}
                            {upgradeTargets.map((u) => (
                              <option key={`to-upgrade-${u.id}`} value={`upgrade:${u.id}`}>
                                {u.label} ({u.sectionLabel})
                              </option>
                            ))}
                          </select>

                          <input
                            type="number"
                            min={1}
                            max={isUpgradeTarget ? maxUpgradeTransferAmount : undefined}
                            value={amount}
                            onChange={(e) => {
                              const parsed = Number(e.target.value);
                              const nextAmount =
                                typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
                                  ? parsed
                                  : 1;
                              const next: TransferEntry[] = transfers.map((entry, i): TransferEntry =>
                                i === index
                                  ? {
                                      ...entry,
                                      amount: isUpgradeTarget
                                        ? Math.max(1, Math.min(maxUpgradeTransferAmount, nextAmount))
                                        : Math.max(1, Math.floor(nextAmount)),
                                    }
                                  : entry,
                              );
                              setTransfers(next);
                            }}
                            className="w-12 px-1 py-0.5 text-[10px] bg-gravity-bg border border-gravity-border rounded text-right"
                          />

                          <button
                            type="button"
                            className="px-2 py-0.5 rounded bg-slate-900/60 text-red-100 border border-red-400/30 text-[10px] hover:bg-slate-900"
                            onClick={() => {
                              const next: TransferEntry[] = transfers.filter((_, i) => i !== index);
                              setTransfers(next);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
          {interactionMode === 'repair' && (
            <div className="mt-1 text-[10px] text-amber-300 text-center">
              Click a section to set the repair target.
            </div>
          )}
          {interactionMode === 'none' && (() => {
            const selectedAction = findPlannedAction(selectedCrew.id, ui.selectedActionSlot);
            const isBoardTargetAction =
              selectedAction?.type === 'scan' ||
              selectedAction?.type === 'acquire' ||
              selectedAction?.type === 'attack' ||
              selectedAction?.type === 'launch';
            const objectId = selectedAction?.target?.objectId;
            const needsBoardTarget =
              isBoardTargetAction && !(typeof objectId === 'string' && objectId.length > 0);
            if (!needsBoardTarget) return null;
            return (
              <div className="mt-1 text-[10px] text-sky-300 text-center">
                Click a board object to set the {selectedAction?.type} target.
              </div>
            );
          })()}
          {interactionMode === 'move' && (
            <div className="mt-1 text-[10px] text-sky-300 text-center">
              Click a connected section to move.
            </div>
          )}
        </div>
      )}

      {/* Ship sections grid with corridor overlay */}
      <Dialog.Root open={explorerNeedsRepairKitPlacement} onOpenChange={() => {}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(560px,95vw)] -translate-x-1/2 -translate-y-1/2 rounded border border-gravity-border bg-gravity-bg p-4 text-slate-100 shadow-xl z-[101]">
            <div className="text-sm font-bold tracking-wide">EXPLORER: PLACE REPAIR KIT</div>
            <div className="mt-2 text-[10px] text-gravity-muted">
              Select a damaged ship section to place your special repair kit.
            </div>

            {damagedSectionsForRepairKit.length === 0 ? (
              <div className="mt-3 rounded border border-red-500/30 bg-red-950/20 p-2 text-[10px] text-red-200">
                No damaged sections are available. The repair kit can only be placed on a damaged section.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {damagedSectionsForRepairKit.map((sectionKey) => (
                  <button
                    key={sectionKey}
                    type="button"
                    className="px-2 py-2 rounded bg-emerald-700/40 text-emerald-100 border border-emerald-400/40 text-[10px] hover:bg-emerald-700/60"
                    onClick={() => {
                      assignExplorerRepairKit(sectionKey);
                    }}
                    title={`Place kit in ${SECTION_CONFIG[sectionKey]?.label ?? String(sectionKey)}`}
                  >
                    <div className="font-semibold">{SECTION_CONFIG[sectionKey]?.label ?? String(sectionKey)}</div>
                    <div className="mt-0.5 text-[10px] text-emerald-200/90">
                      hull {ship.sections[sectionKey].hull}/{CORE_SECTION_CONFIG[sectionKey]?.maxHull ?? ship.sections[sectionKey].hull}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={spacePirateNeedsStartingUpgradeChoice} onOpenChange={() => {}}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(960px,95vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gravity-border bg-gravity-bg p-8 text-slate-100 shadow-2xl z-[101]"
          >
            <div className="text-2xl font-extrabold tracking-wide">SPACE PIRATE: CHOOSE STARTING UPGRADE</div>
            <div className="mt-4 text-[20px] leading-snug text-gravity-muted">
              Choose one upgrade to add to your ship’s pending upgrades.
            </div>

            <div className="mt-6 space-y-4">
              {(player.spacePirateStartingUpgradeOptions ?? []).map((upgrade) => (
                <div key={upgrade.id} className="rounded-2xl border border-gravity-border bg-slate-950/40 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 pr-4">
                      <div className="text-[22px] font-semibold">{upgrade.name}</div>
                      <div className="mt-2 text-[20px] leading-snug text-gravity-muted whitespace-pre-wrap">
                        {upgrade.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-6 py-3 rounded-xl bg-emerald-700/50 text-emerald-100 border border-emerald-400/60 text-[20px] font-semibold hover:bg-emerald-700/70 shrink-0"
                      onClick={() => {
                        chooseSpacePirateStartingUpgrade(upgrade.id);
                      }}
                    >
                      Choose
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <SectionGridWithOverlay
        ship={ship}
        routingContext={routingContext}
        sectionDiffs={isExecutionPhase ? (executionPreviewSectionDiffs ?? null) : (ui.lastPlayerDiff?.sectionDiffs ?? null)}
        interactionMode={interactionMode}
        actingCrew={selectedCrew}
        setExecutionConfirmed={setExecutionConfirmed}
        setLastError={setLastError}
        isExecutionPhase={isExecutionPhase}
        ui={ui}
        allCrew={allCrew}
        installedUpgrades={player.installedUpgrades}
        onOpenUpgradeDetails={(id) => setUpgradeDetailsId(id)}
        onChargeUpgrade={handleChargeUpgrade}
        selectedUpgradeId={upgradeDetailsId}
        onCloseUpgradeDetails={() => setUpgradeDetailsId(null)}
        updatePlannedActionParameters={updatePlannedActionParameters}
        updatePlannedActionTarget={updatePlannedActionTarget}
        moveCrew={moveCrew}
        explorerRepairKit={player.explorerRepairKit ?? null}
      />

      {/* Shield tracker */}
      <div className="panel p-2">
        <ShieldTracker ship={ship} board={game.board} />
      </div>

      {/* Resources */}
      <Dialog.Root open={isUpgradesOpen} onOpenChange={setIsUpgradesOpen}>
        <div className="panel p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex-1 text-xs font-bold tracking-wide text-center">RESOURCES</div>
            <Dialog.Trigger asChild>
              <button
                type="button"
                className="px-3 py-1 rounded bg-slate-800 text-slate-100 text-xs font-semibold hover:bg-slate-700"
              >
                Upgrades
              </button>
            </Dialog.Trigger>
          </div>
          <ResourceDisplay resources={resources} />
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[min(640px,95vw)] -translate-x-1/2 -translate-y-1/2 rounded border border-gravity-border bg-gravity-bg p-4 text-slate-100 shadow-xl z-[101]">
            <div className="flex items-start justify-between gap-2">
              <div className="text-sm font-bold tracking-wide">UPGRADES</div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-slate-800 text-slate-100 text-[10px] hover:bg-slate-700"
                >
                  Close
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-2 text-[10px] text-gravity-muted">
              {selectedCrew ? `Planning for: ${selectedCrew.name}` : 'Select a crew member to plan an installation.'}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="rounded border border-gravity-border bg-slate-900/30 p-2">
                <div className="text-[11px] font-semibold">
                  Pending ({player.pendingUpgrades.length})
                </div>
                {player.pendingUpgrades.length === 0 ? (
                  <div className="mt-1 text-[10px] text-gravity-muted">No pending upgrades.</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {player.pendingUpgrades.map((upgrade) => (
                      <div key={upgrade.id} className="rounded border border-gravity-border bg-slate-950/20 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold">{upgrade.name}</div>
                            <div className="mt-0.5 text-[10px] text-gravity-muted whitespace-pre-wrap">
                              {upgrade.description}
                            </div>
                            {(() => {
                              const sectionRaw = (upgrade as { section?: unknown }).section;
                              const powerRequiredRaw = (upgrade as { powerRequired?: unknown }).powerRequired;
                              const rulesTextRaw = (upgrade as { effects?: { rulesText?: unknown } }).effects?.rulesText;

                              const sectionLabel = typeof sectionRaw === 'string' ? sectionRaw : '—';
                              const powerLabel =
                                typeof powerRequiredRaw === 'number' && Number.isFinite(powerRequiredRaw)
                                  ? String(powerRequiredRaw)
                                  : '—';
                              const rulesTextLabel = typeof rulesTextRaw === 'string' ? rulesTextRaw : null;
                              const mechanicsSummary = getUpgradeMechanicsSummary(upgrade.id);

                              return (
                                <div className="mt-1 text-[10px] text-slate-300">
                                  <div>
                                    Requires: <span className="font-semibold">{sectionLabel}</span> | Power:{' '}
                                    <span className="font-semibold">{powerLabel}</span>
                                  </div>
                                  {mechanicsSummary && (
                                    <div className="mt-0.5 text-slate-200">Effect: {mechanicsSummary}</div>
                                  )}
                                  {rulesTextLabel && (
                                    <div className="mt-0.5 text-gravity-muted whitespace-pre-wrap">
                                      {rulesTextLabel}
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-emerald-700/40 text-emerald-100 border border-emerald-400/40 text-[10px] hover:bg-emerald-700/60 disabled:opacity-50"
                            disabled={(() => {
                              if (!isExecutionPhase || !currentPlayerId || !selectedCrewId) {
                                return true;
                              }

                              const sectionRaw = (upgrade as { section?: unknown }).section;
                              if (typeof sectionRaw !== 'string') {
                                return true;
                              }

                              if (sectionRaw === 'any') {
                                return false;
                              }

                              const crewLocationRaw = (selectedCrew as { location?: unknown } | null)?.location;
                              if (typeof crewLocationRaw !== 'string') {
                                return true;
                              }

                              return crewLocationRaw !== sectionRaw;
                            })()}
                            title={
                              (() => {
                                if (!isExecutionPhase) {
                                  return 'Only available during action execution.';
                                }
                                if (!selectedCrewId) {
                                  return 'Select a crew member first.';
                                }
                                const sectionRaw = (upgrade as { section?: unknown }).section;
                                if (typeof sectionRaw !== 'string') {
                                  return 'Cannot install this upgrade because it has no valid required section.';
                                }
                                if (sectionRaw === 'any') {
                                  return '';
                                }
                                const crewLocationRaw = (selectedCrew as { location?: unknown } | null)?.location;
                                if (typeof crewLocationRaw !== 'string') {
                                  return 'Cannot install because the selected crew has no valid location.';
                                }
                                if (crewLocationRaw !== sectionRaw) {
                                  return `Requires crew in ${sectionRaw}. Current crew is in ${crewLocationRaw}.`;
                                }
                                return '';
                              })()
                            }
                            onClick={() => {
                              if (!isExecutionPhase) {
                                setLastError(
                                  'Cannot plan integrate action because it is not the action execution phase. ' +
                                    'Fix: Start the action execution phase before installing upgrades.',
                                );
                                return;
                              }

                              if (!currentPlayerId) {
                                setLastError(
                                  'Cannot plan integrate action because current player is missing. ' +
                                    'Root cause: currentPlayerId is null. ' +
                                    'Fix: Ensure a player is selected before planning actions.',
                                );
                                return;
                              }

                              if (!selectedCrewId) {
                                setLastError(
                                  'Cannot plan integrate action because no crew member is selected. ' +
                                    'Fix: Select a crew member, then choose an upgrade to install.',
                                );
                                return;
                              }

                              const requiredSectionRaw = (upgrade as { section?: unknown }).section;
                              if (typeof requiredSectionRaw !== 'string') {
                                setLastError(
                                  'Cannot plan integrate action because upgrade.section is missing or invalid. ' +
                                    `Root cause: upgrade "${upgrade.id}" has section "${String(requiredSectionRaw)}". ` +
                                    'Fix: Ensure the upgrade card definition includes a valid section string (or "any").',
                                );
                                return;
                              }

                              if (requiredSectionRaw !== 'any') {
                                const crewLocationRaw = (selectedCrew as { location?: unknown } | null)?.location;
                                if (typeof crewLocationRaw !== 'string') {
                                  setLastError(
                                    'Cannot plan integrate action because selected crew has no location. ' +
                                      `Root cause: crew "${selectedCrewId}" has location "${String(crewLocationRaw)}". ` +
                                      'Fix: Move the crew to the required section before integrating.',
                                  );
                                  return;
                                }

                                if (crewLocationRaw !== requiredSectionRaw) {
                                  setLastError(
                                    'Cannot plan integrate action because crew is in the wrong section for this upgrade. ' +
                                      `Root cause: upgrade "${upgrade.name}" requires section "${requiredSectionRaw}" but crew is in "${crewLocationRaw}". ` +
                                      'Fix: Move the performing crew member to the required section before integrating this upgrade.',
                                  );
                                  return;
                                }
                              }

                              const existingAction = findPlannedAction(selectedCrewId, ui.selectedActionSlot);

                              if (existingAction && existingAction.type !== 'integrate') {
                                setLastError(
                                  'Cannot plan integrate action because the selected crew already has a different planned action. ' +
                                    `Root cause: crew "${selectedCrewId}" has planned action type "${existingAction.type}". ` +
                                    'Fix: Clear that action first or choose a different crew member to integrate this upgrade.',
                                );
                                return;
                              }

                              setExecutionConfirmed(false);

                              if (!existingAction) {
                                addPlannedAction({
                                  playerId: currentPlayerId,
                                  crewId: selectedCrewId,
                                  type: 'integrate',
                                  parameters: {
                                    upgradeId: upgrade.id,
                                    uiSlot: ui.selectedActionSlot,
                                  },
                                } as any);
                              } else {
                                updatePlannedActionParameters(selectedCrewId, { upgradeId: upgrade.id }, ui.selectedActionSlot);
                              }

                              setIsUpgradesOpen(false);
                            }}
                          >
                            Plan Install
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded border border-gravity-border bg-slate-900/30 p-2">
                <div className="text-[11px] font-semibold">
                  Installed ({player.installedUpgrades.length})
                </div>
                {player.installedUpgrades.length === 0 ? (
                  <div className="mt-1 text-[10px] text-gravity-muted">No installed upgrades.</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {player.installedUpgrades.map((upgrade) => (
                      <div key={upgrade.id} className="rounded border border-gravity-border bg-slate-950/20 p-2">
                        <div className="text-[11px] font-semibold">{upgrade.name}</div>
                        <div className="mt-0.5 text-[10px] text-gravity-muted whitespace-pre-wrap">
                          {upgrade.description}
                        </div>
                        {(() => {
                          const sectionRaw = (upgrade as { section?: unknown }).section;
                          const powerRequiredRaw = (upgrade as { powerRequired?: unknown }).powerRequired;
                          const rulesTextRaw = (upgrade as { effects?: { rulesText?: unknown } }).effects?.rulesText;

                          const sectionLabel = typeof sectionRaw === 'string' ? sectionRaw : '—';
                          const powerLabel =
                            typeof powerRequiredRaw === 'number' && Number.isFinite(powerRequiredRaw)
                              ? String(powerRequiredRaw)
                              : '—';
                          const rulesTextLabel = typeof rulesTextRaw === 'string' ? rulesTextRaw : null;
                          const mechanicsSummary = getUpgradeMechanicsSummary(upgrade.id);
                          const status = getUpgradePowerStatus(upgrade, ship);
                          const showPowerStatus = status.upgradePowerRequired > 0;

                          return (
                            <div className="mt-1 text-[10px] text-slate-300">
                              <div>
                                Installed in: <span className="font-semibold">{sectionLabel}</span> | Power:{' '}
                                <span className="font-semibold">{powerLabel}</span>
                              </div>
                              {showPowerStatus && (
                                <div className="mt-0.5">
                                  Status:{' '}
                                  <span className={`font-semibold ${status.isPowered ? 'text-emerald-200' : 'text-amber-200'}`}>
                                    {status.isPowered ? 'Powered' : 'Unpowered'}
                                  </span>
                                  <span className="text-gravity-muted">
                                    {' '}({status.totalPowerInSection}/{status.totalPowerRequired})
                                  </span>
                                </div>
                              )}
                              {mechanicsSummary && (
                                <div className="mt-0.5 text-slate-200">Effect: {mechanicsSummary}</div>
                              )}
                              {rulesTextLabel && (
                                <div className="mt-0.5 text-gravity-muted whitespace-pre-wrap">{rulesTextLabel}</div>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Position info */}
      <div className="text-xs text-center text-gravity-muted">
        Position: Ring {ship.position.ring}, Space {ship.position.space}
      </div>
    </div>
  );
}

