import { SHIP_SECTIONS, type PlayerAction } from '@gravity/core';

import { gravitySessionGameFactory } from '../src/sessions/gravitySessionGameFactory';
import type { SessionGameFactory } from '../src/sessions/types';

export type ContentionMode = 'attack' | 'scan' | 'probe' | 'torpedo' | 'retaliate' | 'torpedo-retaliate' | 'acquire-attack' | 'acquire-retaliate';

/** Create deterministic contested-target snapshots, never imported by production runtime. */
export function createContentionFactory(mode: ContentionMode): SessionGameFactory {
  return { ...gravitySessionGameFactory, create(params) {
    const snapshot = gravitySessionGameFactory.create(params);
    const combatMode = !['scan', 'probe', 'torpedo'].includes(mode);
    const targetType = combatMode ? 'hostile_ship' : mode === 'scan' ? 'hazard' : 'debris';
    snapshot.game.board.objects = [{ id: 'shared-target', type: targetType, position: { ring: 8, space: 0 },
      hull: 1, hasTorpedo: false, lootResourceType: 'fuel_cell' }];
    for (const player of snapshot.game.players) {
      player.ship.position = { ring: 8, space: 0 };
      for (const section of [SHIP_SECTIONS.DEFENSE, SHIP_SECTIONS.SCI_LAB, SHIP_SECTIONS.BRIDGE]) {
        player.ship.sections[section].hull = 6;
        player.ship.sections[section].powerDice = [6];
      }
      const isFirst = player.id === params.participants.find(participant => participant.seatNumber === 1)?.playerId;
      player.captain.location = combatMode && !(isFirst && (mode === 'torpedo-retaliate' || mode.startsWith('acquire-')))
        ? SHIP_SECTIONS.DEFENSE : mode === 'scan' ? SHIP_SECTIONS.SCI_LAB : SHIP_SECTIONS.BRIDGE;
      player.resources.probe = 1;
      player.resources.torpedo = 1;
      if (mode === 'scan') player.installedUpgrades = [{ id: 'tachyon_beam', name: 'Tachyon Beam', description: 'Test',
        powerRequired: 6, storedPower: 6, section: SHIP_SECTIONS.SCI_LAB, effects: {} }];
      if (mode === 'probe' || mode === 'torpedo' || mode.startsWith('acquire-')) player.scanDiscoveriesByObjectId = {
        'shared-target': { objectId: 'shared-target', objectType: targetType, source: 'scan', rollValue: 6, totalRoll: 6,
          foundResource: !combatMode, resourceType: combatMode ? null : 'fuel_cell', foundUpgrade: false, reservedUpgrade: null, revealedAtTurn: snapshot.game.currentTurn, crewId: player.captain.id },
      };
    }
    return snapshot;
  } };
}

/** Return the first claimant/second contender plan for a scenario; the third human submits an empty plan. */
export function createContentionPlan(playerId: string, mode: ContentionMode, isFirst: boolean): PlayerAction[] {
  const type = mode === 'retaliate' ? (isFirst ? 'attack' : 'retaliate') :
    mode === 'torpedo-retaliate' ? (isFirst ? 'launch' : 'retaliate') :
      mode === 'acquire-attack' ? (isFirst ? 'acquire' : 'attack') :
        mode === 'acquire-retaliate' ? (isFirst ? 'acquire' : 'retaliate') :
          mode === 'attack' || mode === 'scan' ? mode : isFirst ? 'acquire' : 'launch';
  return [{ playerId, crewId: `${playerId}:captain`, target: { objectId: 'shared-target' },
    type, ...(type === 'launch' ? { parameters: { launchType: mode === 'probe' ? 'probe' : 'torpedo' } } : {}),
  }];
}
