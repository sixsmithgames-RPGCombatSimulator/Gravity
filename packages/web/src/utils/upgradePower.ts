import type { Ship, ShipSection, UpgradeCard } from '@gravity/core';
import { SECTION_CONFIG, SHIP_SECTIONS } from '@gravity/core';

const VALID_SECTIONS_SET = new Set(Object.values(SHIP_SECTIONS) as ShipSection[]);

export function getUpgradePowerStatus(
  upgrade: UpgradeCard,
  ship: Ship,
): {
  section: ShipSection | null;
  upgradePowerRequired: number;
  storedPower: number;
  basePowerRequired: number;
  totalPowerRequired: number;
  totalPowerInSection: number;
  hasConduitConnection: boolean;
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
      hasConduitConnection: false,
      isPowered: storedPower >= upgradePowerRequired,
    };
  }

  const sectionState = ship.sections[section];
  if (!sectionState) {
    return {
      section: null,
      upgradePowerRequired,
      storedPower,
      basePowerRequired: 0,
      totalPowerRequired: upgradePowerRequired,
      totalPowerInSection: 0,
      hasConduitConnection: false,
      isPowered: false,
    };
  }

  const baseRequiredRaw = (SECTION_CONFIG as Record<string, unknown>)[section];
  const basePowerRequired =
    typeof (baseRequiredRaw as any)?.powerRequired === 'number' &&
    Number.isFinite((baseRequiredRaw as any).powerRequired) &&
    (baseRequiredRaw as any).powerRequired > 0
      ? (baseRequiredRaw as any).powerRequired
      : 0;

  const totalPowerRequired = basePowerRequired;

  const hasConduitConnection = sectionState
    ? Object.values(sectionState.conduitConnections ?? {}).some((count) => (count ?? 0) > 0)
    : false;

  const totalPowerInSection = sectionState.powerDice.reduce((sum, die) => sum + die, 0);
  const isPowered =
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
    hasConduitConnection,
    isPowered,
  };
}
