import { describe, it, expect } from 'vitest';
import type { Board } from './Board';
import { BoardUtils } from './Board';

function createTestBoard(): Board {
  const spacesPerRing = [9, 9, 12, 12, 14, 14, 18, 18];
  const colors: Array<'red' | 'orange' | 'yellow' | 'green'> = [
    'red',
    'red',
    'orange',
    'orange',
    'yellow',
    'yellow',
    'green',
    'green',
  ];

  return {
    rings: spacesPerRing.map((numSpaces, index) => ({
      index: index + 1,
      rotation: 0,
      numSpaces,
      speedRequirement: 1,
      color: colors[index] ?? 'green',
    })),
    objects: [],
    rotationDirection: 'clockwise',
  };
}

describe('BoardUtils', () => {
  describe('calculateDistance', () => {
    it('should compute shortest wrap-around distance on the same ring', () => {
      const board = createTestBoard();

      const distance = BoardUtils.calculateDistance(
        { ring: 6, space: 13 },
        { ring: 6, space: 0 },
        board,
      );

      expect(distance).toBe(1);
    });

    it('should treat overlapping wedges as adjacent across rings with different space counts (14 -> 18)', () => {
      const board = createTestBoard();

      const distance = BoardUtils.calculateDistance(
        { ring: 6, space: 0 },
        { ring: 7, space: 1 },
        board,
      );

      expect(distance).toBe(1);
    });

    it('should treat overlapping wedges as adjacent across rings with different space counts (18 -> 14)', () => {
      const board = createTestBoard();

      const distance = BoardUtils.calculateDistance(
        { ring: 7, space: 1 },
        { ring: 6, space: 0 },
        board,
      );

      expect(distance).toBe(1);
    });
  });
});
