import { useMemo, useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  applyPlayerActions,
  BoardUtils,
  previewManeuver,
  SHIP_SECTIONS,
  ShipUtils,
  computeHazardDamageForPosition,
  HAZARD_CONFIG,
} from '@gravity/core';
import type {
  Board,
  ShipPosition,
  AnySpaceObject,
  AnyCrew,
  Captain,
  ProbeScanLogEntry,
  ProbeScanRevealedItem,
  ScanDiscoveryRecord,
} from '@gravity/core';
import { getUpgradePowerStatus } from '../../utils/upgradePower';

/**
 * GameBoard component
 * Purpose: Render the circular game board with rings, objects, and ships
 *
 * Visual design based on reference images:
 * - 8 concentric rings with zone coloring (green outer, red inner)
 * - Space objects at their positions
 * - Player ships as tokens
 * - Crew tokens on the board
 *
 * Animation support:
 * - During environment phase, rings rotate smoothly with objects/ships moving with them
 * - Uses CSS transforms on SVG groups to rotate ring contents around board center
 * - Animation driven by requestAnimationFrame for smooth 60fps transitions
 */

const BOARD_SIZE = 600;
const CENTER = BOARD_SIZE / 2;
const VIEWBOX_PADDING = 28;
const NUM_RINGS = 8;
const MIN_RADIUS = 40;
const MAX_RADIUS = CENTER - 8;
const RING_SPACING = (MAX_RADIUS - MIN_RADIUS) / NUM_RINGS;

/**
 * Animation configuration
 * Purpose: Control ring rotation animation timing and easing
 */
const RING_ANIMATION_DURATION_MS = 1500; // Total animation duration in milliseconds
const RING_ANIMATION_EASING = (t: number): number => {
  // Smoothstep ease-in-out: slow start, faster middle, slow end
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
};

/**
 * Convert game position to SVG coordinates
 * Purpose: Calculate visual x,y from ring/space position, accounting for ring rotation
 * Parameters:
 *   - position: Ship or object position with ring and space indices
 *   - board: Current board state with ring rotation offsets
 * Returns: SVG coordinates {x, y} for rendering
 * Side effects: None (pure function)
 */
function positionToCoords(position: ShipPosition, board: Board): { x: number; y: number } {
  const { ring, space } = position;
  const ringData = board.rings[ring - 1];

  if (!ringData) {
    return { x: CENTER, y: CENTER };
  }

  // Compute radius directly on the ring arc so ships/objects occupy ring spaces
  // (not the band between rings).
  const rawRadius = MIN_RADIUS + (ring * RING_SPACING);
  const radius = Math.min(rawRadius, MAX_RADIUS);

  // Account for ring rotation: the ring.rotation value indicates how many spaces
  // the ring has rotated from its initial position. Add this offset to the space
  // index and then offset by 0.5 so tokens sit in the visual center of each
  // segment between radial dividers instead of on the dividers themselves.
  const effectiveSpace = ((space % ringData.numSpaces) + ringData.numSpaces) % ringData.numSpaces;
  const angle = ((effectiveSpace + 0.5) / ringData.numSpaces) * Math.PI * 2 - Math.PI / 2;

  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

/**
 * Get ring color based on zone
 */
function getRingColor(ringIndex: number): string {
  if (ringIndex >= 7) return '#22c55e'; // Green
  if (ringIndex >= 5) return '#eab308'; // Yellow
  if (ringIndex >= 3) return '#f97316'; // Orange
  return '#ef4444'; // Red
}

/**
 * Get object color based on type (used for strokes, fills, glows)
 */
function getObjectColor(type: string): string {
  switch (type) {
    case 'hazard': return '#a855f7';
    case 'asteroid_cluster': return '#a8a29e';
    case 'debris': return '#94a3b8';
    case 'hostile_ship': return '#ef4444';
    case 'wrecked_ship': return '#d97706';
    case 'functional_station': return '#34d399';
    default: return '#ffffff';
  }
}

/**
 * Render proper SVG icon for each board object type at given coordinates.
 * @param scale - multiplier for icon size (default 1.0); inner rings use smaller values
 */
function renderObjectIcon(type: string, cx: number, cy: number, color: string, scale: number = 1.0): JSX.Element {
  const r = 10 * scale;
  switch (type) {
    case 'hazard': {
      // Radiation trefoil: triangle + inner pulsing rings
      const pts = [
        `${cx},${cy - r}`,
        `${cx - r * 0.87},${cy + r * 0.5}`,
        `${cx + r * 0.87},${cy + r * 0.5}`,
      ].join(' ');
      return (
        <g>
          <polygon points={pts} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={4} fill={color} fillOpacity={0.9}>
            <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
            <animate attributeName="fill-opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx={cx} cy={cy} r={8} fill="none" stroke={color} strokeWidth={0.8} strokeDasharray="2 3" opacity={0.6}>
            <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="6s" repeatCount="indefinite" />
          </circle>
        </g>
      );
    }
    case 'asteroid_cluster': {
      // Jagged rock silhouette
      const pts = [
        `${cx - 2},${cy - r}`,
        `${cx + 6},${cy - r + 3}`,
        `${cx + r},${cy - 4}`,
        `${cx + r - 2},${cy + 4}`,
        `${cx + 5},${cy + r}`,
        `${cx - 4},${cy + r - 2}`,
        `${cx - r},${cy + 5}`,
        `${cx - r + 3},${cy - 3}`,
      ].join(' ');
      return (
        <g>
          <polygon points={pts} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          <polygon points={pts} fill="none" stroke="#d6d3d1" strokeWidth={0.5} strokeLinejoin="round" opacity={0.3} />
        </g>
      );
    }
    case 'debris': {
      // Scattered fragments – sized by scale
      const s = r * 0.5;
      return (
        <g opacity={0.9}>
          <rect x={cx - s * 1.2} y={cy - s * 1.6} width={s} height={s} rx={1} fill={color} fillOpacity={0.6} stroke={color} strokeWidth={1}
            transform={`rotate(25 ${cx - s * 0.7} ${cy - s * 1.1})`} />
          <rect x={cx + s * 0.4} y={cy - s * 0.6} width={s * 0.8} height={s * 1.4} rx={1} fill={color} fillOpacity={0.55} stroke={color} strokeWidth={1}
            transform={`rotate(-15 ${cx + s * 0.8} ${cy + s * 0.1})`} />
          <rect x={cx - s * 1.6} y={cy + s * 0.2} width={s * 1.2} height={s * 0.8} rx={1} fill={color} fillOpacity={0.55} stroke={color} strokeWidth={1}
            transform={`rotate(10 ${cx - s} ${cy + s * 0.6})`} />
          <rect x={cx + s * 0.2} y={cy + s} width={s * 0.6} height={s * 0.6} rx={0.5} fill={color} fillOpacity={0.5} stroke={color} strokeWidth={0.8} />
        </g>
      );
    }
    case 'hostile_ship': {
      // Aggressive angular ship silhouette pointing down-left
      const pts = [
        `${cx},${cy - r}`,
        `${cx + r * 0.7},${cy + 2}`,
        `${cx + r * 0.3},${cy + r * 0.5}`,
        `${cx},${cy + r * 0.3}`,
        `${cx - r * 0.3},${cy + r * 0.5}`,
        `${cx - r * 0.7},${cy + 2}`,
      ].join(' ');
      return (
        <g>
          <polygon points={pts} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
          <line x1={cx - 3} y1={cy - 2} x2={cx + 3} y2={cy - 2} stroke={color} strokeWidth={2} opacity={0.9} />
          <circle cx={cx} cy={cy - 4} r={2} fill={color} fillOpacity={0.8}>
            <animate attributeName="fill-opacity" values="0.8;0.3;0.8" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </g>
      );
    }
    case 'wrecked_ship': {
      // Broken hull with visible filled shape + damage cracks + glow
      const pts = [
        `${cx},${cy - r}`,
        `${cx + r * 0.7},${cy - r * 0.3}`,
        `${cx + r * 0.5},${cy + r * 0.6}`,
        `${cx},${cy + r * 0.9}`,
        `${cx - r * 0.5},${cy + r * 0.6}`,
        `${cx - r * 0.7},${cy - r * 0.3}`,
      ].join(' ');
      return (
        <g>
          {/* Ambient glow for visibility */}
          <circle cx={cx} cy={cy} r={r * 1.2} fill={color} fillOpacity={0.1} />
          {/* Hull shape */}
          <polygon points={pts} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          {/* Damage cracks */}
          <line x1={cx - r * 0.4} y1={cy - r * 0.2} x2={cx + r * 0.1} y2={cy + r * 0.5} stroke="#fbbf24" strokeWidth={1.2} opacity={0.8} />
          <line x1={cx + r * 0.3} y1={cy - r * 0.4} x2={cx - r * 0.15} y2={cy + r * 0.2} stroke="#fbbf24" strokeWidth={1} opacity={0.65} />
          {/* Fading spark */}
          <circle cx={cx} cy={cy} r={2 * scale} fill="#fbbf24" fillOpacity={0.8}>
            <animate attributeName="fill-opacity" values="0.8;0.2;0.8" dur="2.5s" repeatCount="indefinite" />
          </circle>
        </g>
      );
    }
    case 'functional_station': {
      // Station: octagon with inner ring
      const octPts = Array.from({ length: 8 }, (_, i) => {
        const angle = (i / 8) * Math.PI * 2 - Math.PI / 8;
        return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
      }).join(' ');
      return (
        <g>
          <polygon points={octPts} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} />
          <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={1} />
          <circle cx={cx} cy={cy} r={2.5} fill={color} fillOpacity={0.6} />
          <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={color} strokeWidth={0.6} strokeDasharray="3 4" opacity={0.35}>
            <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`-360 ${cx} ${cy}`} dur="20s" repeatCount="indefinite" />
          </circle>
        </g>
      );
    }
    default:
      return (
        <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.4} stroke={color} strokeWidth={1.5} />
      );
  }
}

function getObjectLabel(type: string): string {
  return type.replace(/_/g, ' ').toUpperCase();
}

/**
 * Calculate rotation angle delta between two ring states
 * Purpose: Determine how much a ring has rotated during environment phase
 * Parameters:
 *   - fromRotation: Ring rotation before environment phase (space index)
 *   - toRotation: Ring rotation after environment phase (space index)
 *   - numSpaces: Total spaces on the ring
 * Returns: Rotation angle in degrees (positive = clockwise visual rotation)
 * Side effects: None (pure function)
 */
function calculateRotationDelta(
  fromRotation: number,
  toRotation: number,
  numSpaces: number
): number {
  // Calculate the space difference
  let spaceDelta = toRotation - fromRotation;
  
  // Normalize to shortest path around the ring
  if (spaceDelta > numSpaces / 2) {
    spaceDelta -= numSpaces;
  } else if (spaceDelta < -numSpaces / 2) {
    spaceDelta += numSpaces;
  }
  
  // Convert space delta to degrees
  const degreesPerSpace = 360 / numSpaces;
  return spaceDelta * degreesPerSpace;
}

export function GameBoard() {
  const {
    game,
    currentPlayerId,
    ui,
    setBoardZoom,
    setBoardOffset,
    resetBoardView,
    setRingAnimationProgress,
    stopRingAnimation,
    updatePlannedActionTarget,
    selectTarget,
    setExecutionConfirmed,
    setLastError,
  } = useGameStore();

  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [pinnedObjectIds, setPinnedObjectIds] = useState<Set<string>>(() => new Set());
  const hoverTimeoutRef = useRef<number | null>(null);
  const PAN_STEP = 40;

  const currentPlayer = currentPlayerId ? game?.players.get(currentPlayerId) : null;
  const scanDiscoveriesByObjectId: Record<string, ScanDiscoveryRecord> | undefined =
    currentPlayer?.scanDiscoveriesByObjectId ?? undefined;
  
  // Animation refs for requestAnimationFrame
  const animationStartTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Drive ring rotation animation with requestAnimationFrame
  useEffect(() => {
    if (ui.ringAnimationPhase !== 'environment' || !ui.ringAnimationFromBoard) {
      // No animation in progress
      animationStartTimeRef.current = null;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const animate = (timestamp: number) => {
      if (animationStartTimeRef.current === null) {
        animationStartTimeRef.current = timestamp;
      }

      const elapsed = timestamp - animationStartTimeRef.current;
      const rawProgress = Math.min(elapsed / RING_ANIMATION_DURATION_MS, 1);
      const easedProgress = RING_ANIMATION_EASING(rawProgress);

      setRingAnimationProgress(easedProgress);

      if (rawProgress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete
        stopRingAnimation();
        animationStartTimeRef.current = null;
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [ui.ringAnimationPhase, ui.ringAnimationFromBoard, setRingAnimationProgress, stopRingAnimation]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
  }, []);

  const clearHoverTimeout = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const isExecutionPhase = game?.status === 'in_progress' && game.turnPhase === 'action_execution';
  const selectedCrewId = ui.selectedCrewId;
  const selectedCrewAction = selectedCrewId
    ? ui.plannedActions.find((a) => {
        if (a.crewId !== selectedCrewId) {
          return false;
        }
        const slotRaw = (a.parameters as Record<string, unknown> | undefined)?.uiSlot as unknown;
        const slot = slotRaw === 'bonus' ? 'bonus' : 'primary';
        return slot === ui.selectedActionSlot;
      })
    : undefined;

  const rangePreview = useMemo(() => {
    if (!game || !currentPlayerId || !isExecutionPhase) {
      return null;
    }

    if (!selectedCrewId || !selectedCrewAction) {
      return null;
    }

    if (
      selectedCrewAction.type !== 'scan' &&
      selectedCrewAction.type !== 'acquire' &&
      selectedCrewAction.type !== 'attack'
    ) {
      return null;
    }

    const player = game.players.get(currentPlayerId);
    if (!player || player.status !== 'active') {
      return null;
    }

    const playerForPowerPreview = (() => {
      const powerActions = ui.plannedActions
        .filter((action) => action.type === 'restore' || action.type === 'route')
        .map((action) => {
          if (action.type === 'route') {
            const params = action.parameters as { sourceSection?: unknown; targetSection?: unknown; amount?: unknown } | undefined;
            const sourceSection = params?.sourceSection;
            const targetSection = params?.targetSection;
            const amount = params?.amount;
            if (
              typeof sourceSection !== 'string' ||
              sourceSection.length === 0 ||
              typeof targetSection !== 'string' ||
              targetSection.length === 0 ||
              typeof amount !== 'number' ||
              !Number.isFinite(amount) ||
              amount <= 0
            ) {
              return null;
            }
          }

          return {
            playerId: currentPlayerId,
            crewId: action.crewId,
            type: action.type,
            target: action.target ?? null,
            parameters: action.parameters,
          };
        })
        .filter((action): action is NonNullable<typeof action> => action !== null);

      if (powerActions.length === 0) {
        return player;
      }

      try {
        const previewGame = applyPlayerActions(game, {
          [currentPlayerId]: powerActions,
        });
        const previewPlayer = previewGame.players.get(currentPlayerId);
        return previewPlayer && previewPlayer.status === 'active' ? previewPlayer : player;
      } catch {
        return player;
      }
    })();

    const selectedCrew: AnyCrew | Captain | null =
      playerForPowerPreview.captain.id === selectedCrewId
        ? playerForPowerPreview.captain
        : (playerForPowerPreview.crew.find((c) => c.id === selectedCrewId) as AnyCrew | undefined) ?? null;

    if (!selectedCrew) {
      return null;
    }

    const shipPositionForRange = playerForPowerPreview.ship.position;

    const tacticalBridgePowered = (() => {
      const upgrade = playerForPowerPreview.installedUpgrades.find((u) => u.id === 'tactical_bridge');
      if (!upgrade) {
        return false;
      }
      return getUpgradePowerStatus(upgrade, playerForPowerPreview.ship).isPowered;
    })();

    const tachyonBeamPowered = (() => {
      const upgrade = playerForPowerPreview.installedUpgrades.find((u) => u.id === 'tachyon_beam');
      if (!upgrade) {
        return false;
      }
      return getUpgradePowerStatus(upgrade, playerForPowerPreview.ship).isPowered;
    })();

    const maxRange = (() => {
      if (selectedCrewAction.type === 'attack') {
        const inDefense = selectedCrew.location === SHIP_SECTIONS.DEFENSE;
        const inBridgeWithUpgrade = selectedCrew.location === SHIP_SECTIONS.BRIDGE && tacticalBridgePowered;
        if (!inDefense && !inBridgeWithUpgrade) {
          return null;
        }
        return 1;
      }

      const sciLabFullyPowered = ShipUtils.isFullyPowered(playerForPowerPreview.ship, SHIP_SECTIONS.SCI_LAB);
      const sciLabBonus = sciLabFullyPowered
        ? (playerForPowerPreview.captain.captainType === 'technologist' ? 3 : 2)
        : 0;

      const crewBonus = (() => {
        if ('captainType' in selectedCrew) {
          return 0;
        }

        if (
          selectedCrew.type === 'basic' &&
          selectedCrew.role === 'scientist' &&
          selectedCrew.location === SHIP_SECTIONS.SCI_LAB
        ) {
          return 1;
        }

        if (
          selectedCrew.type === 'officer' &&
          selectedCrew.role === 'senior_scientist' &&
          (selectedCrew.location === SHIP_SECTIONS.BRIDGE || selectedCrew.location === SHIP_SECTIONS.SCI_LAB)
        ) {
          return 2;
        }

        return 0;
      })();

      const techBasicBonus =
        playerForPowerPreview.captain.captainType === 'technologist' &&
        !('captainType' in selectedCrew) &&
        selectedCrew.type === 'basic' &&
        crewBonus > 0
          ? 1
          : 0;

      const neutronCalibratorBonus = (() => {
        if (selectedCrew.location !== SHIP_SECTIONS.BRIDGE) {
          return 0;
        }

        const upgrade = playerForPowerPreview.installedUpgrades.find((u) => u.id === 'neutron_calibrator');
        if (!upgrade) {
          return 0;
        }

        const status = getUpgradePowerStatus(upgrade, playerForPowerPreview.ship);
        return status.isPowered ? 1 : 0;
      })();

      return 1 + sciLabBonus + crewBonus + techBasicBonus + neutronCalibratorBonus;
    })();

    if (maxRange === null) {
      return null;
    }

    const distancesByObjectId: Record<string, number> = {};
    const inRangeObjectIds = new Set<string>();

    for (const obj of game.board.objects) {
      const distance = BoardUtils.calculateDistance(shipPositionForRange, obj.position, game.board);
      distancesByObjectId[obj.id] = distance;

      const effectiveRange =
        selectedCrewAction.type === 'scan' &&
        tachyonBeamPowered &&
        selectedCrew.location === SHIP_SECTIONS.SCI_LAB &&
        obj.type === 'hazard'
          ? 1
          : maxRange;

      if (distance <= effectiveRange) {
        inRangeObjectIds.add(obj.id);
      }
    }

    return {
      maxRange,
      distancesByObjectId,
      inRangeObjectIds,
      actionType: selectedCrewAction.type,
    };
  }, [currentPlayerId, game, isExecutionPhase, selectedCrewAction, selectedCrewId, ui.plannedActions]);

  const maneuverPreview = useMemo(() => {
    if (!game || !currentPlayerId || !isExecutionPhase) {
      return null;
    }

    if (!selectedCrewId || selectedCrewAction?.type !== 'maneuver') {
      return null;
    }

    const player = game.players.get(currentPlayerId);
    if (!player || player.status !== 'active') {
      return null;
    }

    const selectedCrew: AnyCrew | Captain | null =
      player.captain.id === selectedCrewId
        ? player.captain
        : (player.crew.find((c) => c.id === selectedCrewId) as AnyCrew | undefined) ?? null;

    if (!selectedCrew) {
      return null;
    }

    const params = selectedCrewAction.parameters as
      | { direction?: unknown; powerSpent?: unknown; distance?: unknown; draftDirection?: unknown; draftPowerSpent?: unknown; draftDistance?: unknown }
      | undefined;

    const draftDirection = typeof params?.draftDirection === 'string' ? params.draftDirection : null;
    const draftPowerSpent = typeof params?.draftPowerSpent === 'number' ? params.draftPowerSpent : null;
    const hasDraftDistance =
      !!params && Object.prototype.hasOwnProperty.call(params as Record<string, unknown>, 'draftDistance');
    const draftDistanceRaw = (params as any)?.draftDistance as unknown;
    const draftDistance =
      !hasDraftDistance
        ? undefined
        : draftDistanceRaw === null
          ? null
          : typeof draftDistanceRaw === 'number' &&
              Number.isFinite(draftDistanceRaw) &&
              Number.isInteger(draftDistanceRaw) &&
              draftDistanceRaw >= 1
            ? draftDistanceRaw
            : null;
    const committedDirection = typeof params?.direction === 'string' ? params.direction : null;
    const committedPowerSpent = typeof params?.powerSpent === 'number' ? params.powerSpent : null;
    const hasCommittedDistance =
      !!params && Object.prototype.hasOwnProperty.call(params as Record<string, unknown>, 'distance');
    const committedDistanceRaw = (params as any)?.distance as unknown;
    const committedDistance =
      !hasCommittedDistance
        ? null
        : committedDistanceRaw === null
          ? null
          : typeof committedDistanceRaw === 'number' &&
              Number.isFinite(committedDistanceRaw) &&
              Number.isInteger(committedDistanceRaw) &&
              committedDistanceRaw >= 1
            ? committedDistanceRaw
            : null;

    const direction = draftDirection ?? committedDirection;
    const powerSpent = draftPowerSpent ?? committedPowerSpent;
    const distance = draftDistance !== undefined ? draftDistance : committedDistance;
    const previewDistance = distance === null ? undefined : distance;

    if (!direction || typeof powerSpent !== 'number') {
      return null;
    }

    try {
      const preview =
        typeof previewDistance === 'number'
          ? previewManeuver(
              player.ship,
              selectedCrew,
              direction,
              powerSpent,
              game.board,
              previewDistance,
              player.installedUpgrades,
            )
          : previewManeuver(
              player.ship,
              selectedCrew,
              direction,
              powerSpent,
              game.board,
              undefined,
              player.installedUpgrades,
            );
      return {
        from: player.ship.position,
        to: preview.updatedShip.position,
      };
    } catch {
      return null;
    }
  }, [currentPlayerId, game, isExecutionPhase, selectedCrewAction?.parameters, selectedCrewAction?.type, selectedCrewId]);

  const targetedObjectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of ui.plannedActions as any[]) {
      const objectId = a?.target?.objectId;
      if (typeof objectId === 'string' && objectId.length > 0) {
        ids.add(objectId);
      }
    }
    return ids;
  }, [ui.plannedActions]);

  // Calculate per-ring rotation angles for animation
  // Purpose: During animation, transform from old position to new position
  // Since positionToCoords now accounts for ring.rotation (giving NEW positions),
  // we need to apply a transform that goes from -totalDelta (old) to 0 (new)
  const ringRotationAngles = useMemo(() => {
    if (!game?.board?.rings) return [];
    
    const isAnimating = ui.ringAnimationPhase === 'environment' && ui.ringAnimationFromBoard;
    
    return game.board.rings.map((ring, idx) => {
      if (!isAnimating || !ui.ringAnimationFromBoard) {
        return 0; // No rotation transform when not animating
      }
      
      const fromRing = ui.ringAnimationFromBoard.rings[idx];
      if (!fromRing) return 0;
      
      const totalDelta = calculateRotationDelta(
        fromRing.rotation,
        ring.rotation,
        ring.numSpaces
      );
      
      // At progress=0: return -totalDelta (rotate back to old position)
      // At progress=1: return 0 (stay at new position, no transform needed)
      // Formula: totalDelta * (progress - 1) = -totalDelta * (1 - progress)
      return totalDelta * (ui.ringAnimationProgress - 1);
    });
  }, [game?.board?.rings, ui.ringAnimationPhase, ui.ringAnimationFromBoard, ui.ringAnimationProgress]);

  const maneuverPreviewMarker = useMemo(() => {
    if (!game?.board || !maneuverPreview) {
      return null;
    }

    const coords = positionToCoords(maneuverPreview.to, game.board);
    const ringIndex = maneuverPreview.to.ring;
    const rotationAngle = ringRotationAngles[ringIndex - 1] ?? 0;

    return (
      <g
        transform={`rotate(${rotationAngle} ${CENTER} ${CENTER})`}
        pointerEvents="none"
      >
        <circle
          cx={coords.x}
          cy={coords.y}
          r={22}
          fill="none"
          stroke="#60a5fa"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={0.7}
        />
        <polygon
          points={`${coords.x},${coords.y - 15} ${coords.x - 10},${coords.y + 10} ${coords.x + 10},${coords.y + 10}`}
          fill="#60a5fa"
          fillOpacity={0.18}
          stroke="#60a5fa"
          strokeWidth={2}
          strokeDasharray="5 4"
          opacity={0.85}
        />
      </g>
    );
  }, [game?.board, maneuverPreview, ringRotationAngles]);

  // Memoize ring rendering with rotation transforms
  const rings = useMemo(() => {
    if (!game?.board?.rings) return [];

    return game.board.rings.map((ring, idx) => {
      const rawRadius = MIN_RADIUS + ((idx + 1) * RING_SPACING);
      const radius = Math.min(rawRadius, MAX_RADIUS);
      const color = getRingColor(idx + 1);
      const rotationAngle = ringRotationAngles[idx] ?? 0;
      // Thinner strokes for inner rings, slightly thicker for outer
      const strokeW = idx < 2 ? 1 : idx < 4 ? 1.2 : 1.5;

      return (
        <g key={`ring-${idx}`}>
          {/* Ring circle – static, does not rotate */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeW}
            strokeOpacity={0.4}
          />
          {/* Ring number label at top of ring */}
          <text
            x={CENTER}
            y={CENTER - radius + 4}
            textAnchor="middle"
            fontSize={7}
            fill={color}
            fillOpacity={0.5}
            fontWeight={600}
            pointerEvents="none"
          >
            {idx + 1}
          </text>
          {/* Space markers – rotate with ring contents */}
          <g transform={`rotate(${rotationAngle} ${CENTER} ${CENTER})`}>
            {Array.from({ length: ring.numSpaces }).map((_, spaceIdx) => {
              const angle = (spaceIdx / ring.numSpaces) * Math.PI * 2 - Math.PI / 2;
              const x = CENTER + Math.cos(angle) * radius;
              const y = CENTER + Math.sin(angle) * radius;
              // Smaller dot for inner rings to reduce clutter
              const dotR = idx < 2 ? 1.5 : idx < 4 ? 2 : 2.5;

              return (
                <circle
                  key={`space-${idx}-${spaceIdx}`}
                  cx={x}
                  cy={y}
                  r={dotR}
                  fill={color}
                  fillOpacity={0.25}
                />
              );
            })}
          </g>
        </g>
      );
    });
  }, [game?.board?.rings, ringRotationAngles]);

  // Memoize object rendering with rotation transforms
  const objects = useMemo(() => {
    if (!game?.board?.objects) return [];

    // Group objects by ring for rotation
    const objectsByRing: Map<number, AnySpaceObject[]> = new Map();
    for (const obj of game.board.objects) {
      const ringIndex = obj.position.ring;
      if (!objectsByRing.has(ringIndex)) {
        objectsByRing.set(ringIndex, []);
      }
      objectsByRing.get(ringIndex)!.push(obj);
    }

    const elements: JSX.Element[] = [];

    objectsByRing.forEach((ringObjects, ringIndex) => {
      const rotationAngle = ringRotationAngles[ringIndex - 1] ?? 0;

      elements.push(
        <g
          key={`objects-ring-${ringIndex}`}
          transform={`rotate(${rotationAngle} ${CENTER} ${CENTER})`}
        >
          {ringObjects.map((obj) => {
            const coords = positionToCoords(obj.position, game.board);
            const objColor = getObjectColor(obj.type);

            const isPinned = pinnedObjectIds.has(obj.id);
            const showLabel = isPinned || hoveredObjectId === obj.id;

            const isTargeted = targetedObjectIds.has(obj.id) || ui.selectedTargetId === obj.id;

            const rangeDistance = rangePreview?.distancesByObjectId?.[obj.id];
            const isRangeKnown = typeof rangeDistance === 'number' && Number.isFinite(rangeDistance);
            const isInRange = rangePreview ? !!rangePreview.inRangeObjectIds.has(obj.id) : true;
            const shouldGateSelection = !!rangePreview;

            const labelTitle = getObjectLabel(obj.type);
            const labelSubtitle = `R${obj.position.ring} S${obj.position.space}`;

            const discoveryRecord = scanDiscoveriesByObjectId?.[obj.id];
            const scanLogs =
              currentPlayer?.probeScanLogsByObjectId &&
              typeof currentPlayer.probeScanLogsByObjectId === 'object'
                ? (currentPlayer.probeScanLogsByObjectId[obj.id] as ProbeScanLogEntry[] | undefined)
                : undefined;

            const hasProbeScanLog = Array.isArray(scanLogs) && scanLogs.length > 0;
            const hasReconData = !!discoveryRecord || hasProbeScanLog;

            const scanTooltip = (() => {
              if (discoveryRecord) {
                const bonus = discoveryRecord.totalRoll - discoveryRecord.rollValue;
                const lines = [
                  `${discoveryRecord.source === 'probe' ? 'Probe' : 'Scan'} result (turn ${discoveryRecord.revealedAtTurn})`,
                  `Roll: d6=${discoveryRecord.rollValue}${
                    bonus !== 0 ? ` ${bonus > 0 ? `+${bonus}` : bonus}` : ''
                  } ⇒ ${discoveryRecord.totalRoll}`,
                ];

                if (discoveryRecord.foundResource && discoveryRecord.resourceType) {
                  lines.push(`Resource: ${discoveryRecord.resourceType}`);
                } else {
                  lines.push('Resource: none');
                }

                if (discoveryRecord.foundUpgrade) {
                  const upgradeName = discoveryRecord.reservedUpgrade?.name ?? 'Upgrade reserved';
                  lines.push(`Upgrade: ${upgradeName}`);
                } else {
                  lines.push('Upgrade: none');
                }

                return lines.join('\n');
              }

              if (!hasProbeScanLog) {
                return '';
              }

              const formatRevealed = (revealed: ProbeScanRevealedItem[]): string => {
                if (!Array.isArray(revealed) || revealed.length === 0) {
                  return 'Nothing detected';
                }
                return revealed
                  .map((item) => {
                    if (!item || typeof item !== 'object') {
                      return 'Unknown';
                    }
                    if ((item as any).kind === 'resource') {
                      return `Resource: ${(item as any).resourceType}`;
                    }
                    if ((item as any).kind === 'upgrade') {
                      const upgrade = (item as any).upgrade as { name?: unknown; id?: unknown } | undefined;
                      const name = typeof upgrade?.name === 'string' ? upgrade.name : 'Unknown upgrade';
                      const id = typeof upgrade?.id === 'string' ? upgrade.id : 'unknown';
                      return `Upgrade: ${name} (${id})`;
                    }
                    return 'Unknown';
                  })
                  .join(', ');
              };

              return scanLogs!
                .slice(-6)
                .map((entry) => {
                  const turn = typeof entry.turn === 'number' ? entry.turn : '?';
                  const roll = typeof entry.rollValue === 'number' ? entry.rollValue : '?';
                  return `Turn ${turn} (d6=${roll}): ${formatRevealed(entry.revealed)}`;
                })
                .join('\n');
            })();

            const isHazard = obj.type === 'hazard';
            const hazardRangeRadius = isHazard
              ? Math.min(RING_SPACING * (HAZARD_CONFIG.range + 0.75), 140)
              : null;

            return (
              <g
                key={obj.id}
                className="cursor-pointer hover:opacity-80 transition-opacity"
                opacity={shouldGateSelection && !isInRange && !isTargeted ? 0.35 : 1}
                onMouseEnter={() => {
                  clearHoverTimeout();
                  hoverTimeoutRef.current = window.setTimeout(() => {
                    setHoveredObjectId(obj.id);
                    hoverTimeoutRef.current = null;
                  }, 1000);
                }}
                onMouseLeave={() => {
                  clearHoverTimeout();
                  setHoveredObjectId((prev) => (prev === obj.id && !isPinned ? null : prev));
                }}
                onClick={(e) => {
                  e.stopPropagation();

                  if (
                    isExecutionPhase &&
                    selectedCrewId &&
                    (selectedCrewAction?.type === 'scan' ||
                      selectedCrewAction?.type === 'acquire' ||
                      selectedCrewAction?.type === 'attack' ||
                      selectedCrewAction?.type === 'launch')
                  ) {
                    if (shouldGateSelection && !isInRange) {
                      const maxRange = rangePreview?.maxRange;
                      const distanceLabel = isRangeKnown ? String(rangeDistance) : '?';
                      const rangeLabel = typeof maxRange === 'number' ? String(maxRange) : '?';
                      setLastError(
                        `Target out of range: distance=${distanceLabel}, maxRange=${rangeLabel}. Fix: Maneuver closer or boost scan range (Sci-Lab / scientists).`
                      );
                      return;
                    }

                    setExecutionConfirmed(false);
                    updatePlannedActionTarget(
                      selectedCrewId,
                      {
                        objectId: obj.id,
                      },
                      ui.selectedActionSlot,
                    );
                    selectTarget(obj.id);
                  }

                  setPinnedObjectIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(obj.id)) {
                      next.delete(obj.id);
                    } else {
                      next.add(obj.id);
                    }
                    return next;
                  });
                  setHoveredObjectId(obj.id);
                }}
              >
                {isHazard && hazardRangeRadius !== null && (
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={hazardRangeRadius}
                    fill="#f0abfc20"
                    stroke="#f0abfc90"
                    strokeWidth={1.25}
                    strokeDasharray="6 6"
                    pointerEvents="none"
                  />
                )}
                {/* Targeted highlight ring */}
                {isTargeted && (
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={16}
                    fill="none"
                    stroke={objColor}
                    strokeWidth={3}
                    strokeOpacity={0.8}
                    pointerEvents="none"
                  />
                )}
                {/* Range-eligible indicator ring */}
                {shouldGateSelection && isInRange && (
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={18}
                    fill="none"
                    stroke={
                      rangePreview?.actionType === 'attack'
                        ? '#f87171'
                        : rangePreview?.actionType === 'acquire'
                          ? '#fb923c'
                          : '#c084fc'
                    }
                    strokeWidth={2}
                    strokeOpacity={0.55}
                    strokeDasharray="2 6"
                    pointerEvents="none"
                  />
                )}
                {/* Object SVG icon – scale based on ring (inner=smaller to avoid overlap) */}
                <g filter="url(#objectGlow)">
                  {renderObjectIcon(obj.type, coords.x, coords.y, objColor, 0.7 + (obj.position.ring / NUM_RINGS) * 0.5)}
                </g>

                {(shouldGateSelection || isHazard) && (
                  <title>
                    {`${labelTitle} ${labelSubtitle}` +
                      (isRangeKnown ? `\nDistance: ${rangeDistance} (range ${rangePreview?.maxRange})` : '') +
                      (isInRange ? '\nIn range' : '\nOut of range') +
                      (isHazard
                        ? `\nRadiation: -${HAZARD_CONFIG.damage} hull, -${HAZARD_CONFIG.lifeSupportReduction} life support (within ${HAZARD_CONFIG.range} spaces)`
                        : '')}
                  </title>
                )}

                {hasReconData && (
                  <g pointerEvents="auto">
                    <circle
                      cx={coords.x + 10}
                      cy={coords.y - 10}
                      r={6}
                      fill="#0b1220"
                      stroke={discoveryRecord?.source === 'probe' ? '#f472b6' : '#38bdf8'}
                      strokeWidth={1.5}
                      opacity={0.95}
                    />
                    <text
                      x={coords.x + 10}
                      y={coords.y - 10}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={9}
                      fill={discoveryRecord?.source === 'probe' ? '#f472b6' : '#38bdf8'}
                    >
                      {discoveryRecord?.source === 'probe' ? 'P' : 'S'}
                    </text>
                    <title>{scanTooltip}</title>
                  </g>
                )}

                {showLabel && (
                  <g pointerEvents="none">
                    <rect
                      x={coords.x + 14}
                      y={coords.y - 24}
                      width={140}
                      height={34}
                      rx={6}
                      fill="#0b1220"
                      stroke={objColor}
                      strokeWidth={1}
                      opacity={0.92}
                    />
                    <text
                      x={coords.x + 22}
                      y={coords.y - 10}
                      fontSize={10}
                      fill="#e2e8f0"
                    >
                      <tspan x={coords.x + 22} dy={0} fontWeight={700}>
                        {labelTitle}
                      </tspan>
                      <tspan x={coords.x + 22} dy={12} fill="#94a3b8" fontWeight={500}>
                        {labelSubtitle}
                      </tspan>
                      {isHazard && (
                        <tspan x={coords.x + 22} dy={12} fill="#f5d0fe" fontWeight={600}>
                          Radiation: -{HAZARD_CONFIG.damage} hull / -{HAZARD_CONFIG.lifeSupportReduction} LS ≤{HAZARD_CONFIG.range} spaces
                        </tspan>
                      )}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      );
    });

    return elements;
  }, [
    game?.board,
    currentPlayer,
    hoveredObjectId,
    pinnedObjectIds,
    ringRotationAngles,
    isExecutionPhase,
    selectedCrewAction?.type,
    selectedCrewId,
    selectTarget,
    setExecutionConfirmed,
    targetedObjectIds,
    ui.selectedActionSlot,
    ui.selectedTargetId,
    updatePlannedActionTarget,
  ]);

  // Render player ships with rotation transforms
  const ships = useMemo(() => {
    if (!game?.players || !game?.board) return [];

    // Group ships by ring for rotation
    const shipsByRing: Map<number, { playerId: string; player: typeof game.players extends Map<string, infer V> ? V : never }[]> = new Map();

    game.players.forEach((player, playerId) => {
      if (player.status !== 'active') return;
      const ringIndex = player.ship.position.ring;
      if (!shipsByRing.has(ringIndex)) {
        shipsByRing.set(ringIndex, []);
      }
      shipsByRing.get(ringIndex)!.push({ playerId, player });
    });

    const elements: JSX.Element[] = [];

    shipsByRing.forEach((ringShips, ringIndex) => {
      const rotationAngle = ringRotationAngles[ringIndex - 1] ?? 0;

      elements.push(
        <g
          key={`ships-ring-${ringIndex}`}
          transform={`rotate(${rotationAngle} ${CENTER} ${CENTER})`}
        >
          {ringShips.map(({ playerId, player }) => {
            const coords = positionToCoords(player.ship.position, game.board);
            const isCurrentPlayer = playerId === currentPlayerId;
            const color = isCurrentPlayer ? '#3b82f6' : '#f97316';
            const hazardDamage = computeHazardDamageForPosition(player.ship.position, game.board);
            const hazardLifeSupportPenalty = hazardDamage.lifeSupportReduction;
            const hazardHullPenalty = hazardDamage.hull;
            const hazardActive = hazardLifeSupportPenalty > 0 || hazardHullPenalty > 0;

            const headingX = CENTER - coords.x;
            const headingY = CENTER - coords.y;
            const headingDeg = (Math.atan2(headingY, headingX) * 180) / Math.PI;
            // Ship art is authored pointing up (-Y). Convert to desired heading.
            const shipRotationDeg = headingDeg + 90;

            return (
              <g key={playerId} className="cursor-pointer">
                <g transform={`translate(${coords.x} ${coords.y}) rotate(${shipRotationDeg})`}>
                  {/* Engine glow */}
                  <ellipse
                    cx={0}
                    cy={11}
                    rx={4}
                    ry={6}
                    fill={isCurrentPlayer ? '#60a5fa' : '#fb923c'}
                    fillOpacity={0.5}
                  >
                    <animate attributeName="ry" values="5;8;5" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="fill-opacity" values="0.4;0.7;0.4" dur="1.2s" repeatCount="indefinite" />
                  </ellipse>
                  {/* Ship body – detailed silhouette */}
                  <polygon
                    points={`0,-16 4,-8 11,2 8,6 5,10 -5,10 -8,6 -11,2 -4,-8`}
                    fill={color}
                    fillOpacity={0.85}
                    stroke={isCurrentPlayer ? '#93c5fd' : '#fdba74'}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                  {/* Cockpit canopy */}
                  <ellipse
                    cx={0}
                    cy={-6}
                    rx={3}
                    ry={4}
                    fill={isCurrentPlayer ? '#93c5fd' : '#fdba74'}
                    fillOpacity={0.6}
                  />
                  {/* Wing accents */}
                  <line x1={-4} y1={-2} x2={-10} y2={3} stroke={isCurrentPlayer ? '#93c5fd' : '#fdba74'} strokeWidth={0.8} opacity={0.5} />
                  <line x1={4} y1={-2} x2={10} y2={3} stroke={isCurrentPlayer ? '#93c5fd' : '#fdba74'} strokeWidth={0.8} opacity={0.5} />
                  {/* Player indicator beacon */}
                  {isCurrentPlayer && (
                    <circle
                      cx={0}
                      cy={-20}
                      r={3}
                      fill="#4ade80"
                    >
                      <animate attributeName="r" values="2;4;2" dur="2s" repeatCount="indefinite" />
                      <animate attributeName="fill-opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
                {/* Shield indicator – animated hex ring */}
                {player.ship.shields > 0 && (
                  <g>
                    <circle
                      cx={coords.x}
                      cy={coords.y}
                      r={20}
                      fill="none"
                      stroke="#60a5fa"
                      strokeWidth={1.5}
                      strokeDasharray="6 3"
                      opacity={0.5}
                    >
                      <animateTransform attributeName="transform" type="rotate" from={`0 ${coords.x} ${coords.y}`} to={`360 ${coords.x} ${coords.y}`} dur="8s" repeatCount="indefinite" />
                    </circle>
                    <text
                      x={coords.x + 16}
                      y={coords.y - 14}
                      fontSize={8}
                      fill="#93c5fd"
                      fontWeight={700}
                      textAnchor="middle"
                    >
                      {player.ship.shields}
                    </text>
                  </g>
                )}
                {hazardActive && (
                  <g pointerEvents="none">
                    <circle
                      cx={coords.x}
                      cy={coords.y}
                      r={24}
                      fill="none"
                      stroke="#f472b6"
                      strokeWidth={1.5}
                      strokeDasharray="3 5"
                      opacity={0.85}
                    />
                    <text
                      x={coords.x}
                      y={coords.y + 32}
                      fontSize={9}
                      textAnchor="middle"
                      fill="#fbcfe8"
                      fontWeight={600}
                    >
                      −{hazardLifeSupportPenalty} LS
                    </text>
                  </g>
                )}
                {hazardActive && (
                  <title>
                    {`Hazard radiation: -${hazardHullPenalty} hull, -${hazardLifeSupportPenalty} life support at end of phase.`}
                  </title>
                )}
              </g>
            );
          })}
        </g>
      );
    });

    return elements;
  }, [game?.players, game?.board, currentPlayerId, ringRotationAngles]);

  if (!game) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-gravity-muted">No game loaded</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative flex items-center justify-start bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Zoom controls overlay */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
        <button
          type="button"
          className="btn-secondary w-8 h-8 flex items-center justify-center text-sm leading-none"
          onClick={() => setBoardZoom(ui.boardZoom + 0.1)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="btn-secondary w-8 h-8 flex items-center justify-center text-sm leading-none"
          onClick={() => setBoardZoom(ui.boardZoom - 0.1)}
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
          onClick={() => setBoardOffset({ x: 0, y: 0 })}
          aria-label="Center board"
          title="Center"
        >
          ◎
        </button>
        <div className="grid grid-cols-3 gap-1">
          <div />
          <button
            type="button"
            className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
            onClick={() => setBoardOffset({ x: ui.boardOffset.x, y: ui.boardOffset.y - PAN_STEP })}
            aria-label="Pan up"
            title="Pan up"
          >
            ↑
          </button>
          <div />
          <button
            type="button"
            className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
            onClick={() => setBoardOffset({ x: ui.boardOffset.x - PAN_STEP, y: ui.boardOffset.y })}
            aria-label="Pan left"
            title="Pan left"
          >
            ←
          </button>
          <button
            type="button"
            className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
            onClick={() => setBoardOffset({ x: 0, y: 0 })}
            aria-label="Pan center"
            title="Center"
          >
            •
          </button>
          <button
            type="button"
            className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
            onClick={() => setBoardOffset({ x: ui.boardOffset.x + PAN_STEP, y: ui.boardOffset.y })}
            aria-label="Pan right"
            title="Pan right"
          >
            →
          </button>
          <div />
          <button
            type="button"
            className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
            onClick={() => setBoardOffset({ x: ui.boardOffset.x, y: ui.boardOffset.y + PAN_STEP })}
            aria-label="Pan down"
            title="Pan down"
          >
            ↓
          </button>
          <div />
        </div>
        <button
          type="button"
          className="btn-secondary w-8 h-8 flex items-center justify-center text-xs leading-none"
          onClick={resetBoardView}
          aria-label="Reset board view"
        >
          ⟳
        </button>
      </div>
      {/*
       * Inner wrapper enforces a square aspect ratio so the circular board
       * is never clipped by the available height. The SVG uses a fixed
       * viewBox and scales to fill this square.
       */}
      <div
        className="relative aspect-square h-full max-w-full"
        style={{
          transform: `translate(${ui.boardOffset.x}px, ${ui.boardOffset.y}px) scale(${ui.boardZoom})`,
          transformOrigin: 'center center',
        }}
      >
        <svg
          viewBox={`${-VIEWBOX_PADDING} ${-VIEWBOX_PADDING} ${BOARD_SIZE + VIEWBOX_PADDING * 2} ${BOARD_SIZE + VIEWBOX_PADDING * 2}`}
          className="w-full h-full drop-shadow-2xl"
          preserveAspectRatio="xMidYMid meet"
          onClick={(e) => {
            const targetEl = e.target as unknown as { dataset?: Record<string, string> };
            const isBackgroundTarget = targetEl?.dataset?.boardBackground === 'true';

            if (e.target !== e.currentTarget && !isBackgroundTarget) {
              return;
            }
            clearHoverTimeout();
            setHoveredObjectId(null);
            setPinnedObjectIds(new Set());
          }}
        >
        {/* SVG Definitions: gradients, filters, patterns */}
        <defs>
          <radialGradient id="voidGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000" />
            <stop offset="15%" stopColor="#050510" />
            <stop offset="40%" stopColor="#0a0a1a" />
            <stop offset="100%" stopColor="#0f172a" />
          </radialGradient>
          <radialGradient id="blackHoleCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#000" />
            <stop offset="60%" stopColor="#0a001a" />
            <stop offset="100%" stopColor="#1a0030" />
          </radialGradient>
          <radialGradient id="accretionGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity={0} />
            <stop offset="40%" stopColor="#7c3aed" stopOpacity={0.08} />
            <stop offset="70%" stopColor="#a855f7" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#c084fc" stopOpacity={0} />
          </radialGradient>
          {/* Zone fill gradients between rings */}
          <radialGradient id="zoneRed" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity={0.02} />
          </radialGradient>
          <radialGradient id="zoneOrange" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f97316" stopOpacity={0.05} />
            <stop offset="100%" stopColor="#f97316" stopOpacity={0.015} />
          </radialGradient>
          <radialGradient id="zoneYellow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#eab308" stopOpacity={0.04} />
            <stop offset="100%" stopColor="#eab308" stopOpacity={0.01} />
          </radialGradient>
          <radialGradient id="zoneGreen" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.04} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0.01} />
          </radialGradient>
          <filter id="starGlow">
            <feGaussianBlur stdDeviation="0.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Glow filter for board objects – makes icons pop against dark space */}
          <filter id="objectGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Deep space background */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={CENTER + VIEWBOX_PADDING}
          fill="url(#voidGradient)"
          data-board-background="true"
        />

        {/* Star field – procedural dots for depth */}
        <g opacity={0.7} pointerEvents="none" filter="url(#starGlow)">
          {/* Layer 1: dim distant stars */}
          {Array.from({ length: 80 }, (_, i) => {
            const seed = i * 137.508;
            const sx = (seed * 7.3) % BOARD_SIZE;
            const sy = (seed * 13.7) % BOARD_SIZE;
            const dist = Math.sqrt((sx - CENTER) ** 2 + (sy - CENTER) ** 2);
            if (dist > CENTER - 4) return null;
            const brightness = 0.3 + (i % 5) * 0.1;
            return (
              <circle key={`s1-${i}`} cx={sx} cy={sy} r={0.6} fill="#e2e8f0" opacity={brightness} />
            );
          })}
          {/* Layer 2: brighter nearby stars */}
          {Array.from({ length: 30 }, (_, i) => {
            const seed = (i + 100) * 97.13;
            const sx = (seed * 11.1) % BOARD_SIZE;
            const sy = (seed * 5.9) % BOARD_SIZE;
            const dist = Math.sqrt((sx - CENTER) ** 2 + (sy - CENTER) ** 2);
            if (dist > CENTER - 4) return null;
            const hue = (i * 47) % 360;
            const color = hue < 120 ? '#bfdbfe' : hue < 240 ? '#fde68a' : '#fecaca';
            return (
              <circle key={`s2-${i}`} cx={sx} cy={sy} r={1} fill={color} opacity={0.5 + (i % 3) * 0.15}>
                {i % 4 === 0 && (
                  <animate attributeName="opacity" values={`${0.4 + (i % 3) * 0.1};${0.7};${0.4 + (i % 3) * 0.1}`} dur={`${3 + (i % 4)}s`} repeatCount="indefinite" />
                )}
              </circle>
            );
          })}
        </g>

        {/* Ring zone ambient fills */}
        {game.board.rings.map((_ring, idx) => {
          const outerR = Math.min(MIN_RADIUS + ((idx + 1) * RING_SPACING), MAX_RADIUS);
          const innerR = MIN_RADIUS + (idx * RING_SPACING);
          const zoneId = idx >= 6 ? 'zoneGreen' : idx >= 4 ? 'zoneYellow' : idx >= 2 ? 'zoneOrange' : 'zoneRed';
          return (
            <path
              key={`zone-fill-${idx}`}
              d={`M ${CENTER + outerR} ${CENTER} A ${outerR} ${outerR} 0 1 0 ${CENTER - outerR} ${CENTER} A ${outerR} ${outerR} 0 1 0 ${CENTER + outerR} ${CENTER} M ${CENTER + innerR} ${CENTER} A ${innerR} ${innerR} 0 1 1 ${CENTER - innerR} ${CENTER} A ${innerR} ${innerR} 0 1 1 ${CENTER + innerR} ${CENTER}`}
              fill={`url(#${zoneId})`}
              fillRule="evenodd"
              pointerEvents="none"
              data-board-background="true"
            />
          );
        })}

        {/* Black hole – accretion disk glow */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={MIN_RADIUS + 5}
          fill="url(#accretionGlow)"
          pointerEvents="none"
        />

        {/* Black hole – event horizon */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={MIN_RADIUS - 10}
          fill="url(#blackHoleCore)"
          data-board-background="true"
        />

        {/* Black hole – gravitational lensing rings */}
        <circle cx={CENTER} cy={CENTER} r={MIN_RADIUS - 3} fill="none" stroke="#7c3aed" strokeWidth={1.5} opacity={0.35}>
          <animateTransform attributeName="transform" type="rotate" from={`0 ${CENTER} ${CENTER}`} to={`360 ${CENTER} ${CENTER}`} dur="30s" repeatCount="indefinite" />
        </circle>
        <circle cx={CENTER} cy={CENTER} r={MIN_RADIUS + 2} fill="none" stroke="#a855f7" strokeWidth={0.8} opacity={0.2} strokeDasharray="4 6">
          <animateTransform attributeName="transform" type="rotate" from={`360 ${CENTER} ${CENTER}`} to={`0 ${CENTER} ${CENTER}`} dur="25s" repeatCount="indefinite" />
        </circle>
        <circle cx={CENTER} cy={CENTER} r={MIN_RADIUS - 7} fill="none" stroke="#c084fc" strokeWidth={0.5} opacity={0.25} strokeDasharray="2 4">
          <animateTransform attributeName="transform" type="rotate" from={`0 ${CENTER} ${CENTER}`} to={`360 ${CENTER} ${CENTER}`} dur="18s" repeatCount="indefinite" />
        </circle>

        {/* Rings */}
        {rings}

        {/* Space objects */}
        {objects}

        {/* Player ships */}
        {ships}

        {/* Maneuver preview */}
        {maneuverPreviewMarker}
        </svg>
      </div>
    </div>
  );
}
