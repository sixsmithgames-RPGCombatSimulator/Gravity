import { describe, expect, it } from 'vitest';

import { SHIP_SECTIONS } from '@gravity/core';
import { createMockGame } from './mockGame';

describe('mock game canonical setup', () => {
  it('uses the standard board-object set without a Functional Station', () => {
    const game = createMockGame('hard');
    const typeCounts = game.board.objects.reduce<Record<string, number>>((counts, object) => {
      counts[object.type] = (counts[object.type] ?? 0) + 1;
      return counts;
    }, {});

    expect(typeCounts).toMatchObject({
      hazard: 2,
      asteroid_cluster: 5,
      debris: 4,
      hostile_ship: 2,
      wrecked_ship: 2,
    });
    expect(typeCounts.functional_station ?? 0).toBe(0);
  });

  it('shows the canonical hard-difficulty starting hull values', () => {
    const game = createMockGame('hard');
    const player = game.players.get('player-1');

    expect(player).toBeDefined();
    expect(player!.ship.sections[SHIP_SECTIONS.BRIDGE].hull).toBe(6);
    expect(player!.ship.sections[SHIP_SECTIONS.ENGINEERING].hull).toBe(9);
    expect(player!.ship.sections[SHIP_SECTIONS.MED_LAB].hull).toBe(2);
  });
});
