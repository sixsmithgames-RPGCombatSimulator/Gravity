import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { PlayerActionType, AnyCrew, Captain, PlayerAction } from '@gravity/core';
import { getUpgradePowerStatus } from '../../utils/upgradePower';

/**
 * ActionBar component
 * Purpose: Display action planning interface for crew members
 *
 * Shows:
 * - One slot per active crew member
 * - Action type selector for each slot
 * - Submit turn button
 * - Clear actions button
 */

/** Action type display config with SVG icon paths */
const ACTION_CONFIG: Record<PlayerActionType, { icon: string; label: string; color: string; svgPath: string }> = {
  restore:   { icon: '⚡', label: 'Restore',   color: 'text-yellow-400',  svgPath: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  route:     { icon: '⚡', label: 'Route',      color: 'text-cyan-300',    svgPath: 'M12 2v6m0 8v6m-6-6H2m20 0h-4M7.8 7.8L4.6 4.6m14.8 14.8l-3.2-3.2m0-9.2l3.2-3.2M7.8 16.2l-3.2 3.2' },
  repair:    { icon: '⚡', label: 'Repair',     color: 'text-blue-400',    svgPath: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' },
  revive:    { icon: '⚡', label: 'Revive',     color: 'text-green-400',   svgPath: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  maneuver:  { icon: '⚡', label: 'Maneuver',   color: 'text-cyan-400',    svgPath: 'M12 2L4.5 20.3l.7.7L12 18l6.8 3 .7-.7z' },
  scan:      { icon: '⚡', label: 'Scan',       color: 'text-purple-400',  svgPath: 'M12 2a10 10 0 1 0 10 10M12 2v10l6.93 4' },
  acquire:   { icon: '⚡', label: 'Acquire',    color: 'text-orange-400',  svgPath: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z' },
  attack:    { icon: '⚡', label: 'Attack',     color: 'text-red-400',     svgPath: 'M12 2l3 7h7l-5.5 4.5L18 21l-6-4.5L6 21l1.5-7.5L2 9h7z' },
  launch:    { icon: '⚡', label: 'Launch',     color: 'text-red-500',     svgPath: 'M22 2L11 13M22 2l-7 20-4-9-9-4z' },
  retaliate: { icon: '⚡', label: 'Retaliate',  color: 'text-blue-500',    svgPath: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
  assemble:  { icon: '⚡', label: 'Assemble',   color: 'text-amber-400',   svgPath: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  integrate: { icon: '⚡', label: 'Integrate',  color: 'text-slate-400',   svgPath: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
};

/**
 * Inline SVG icon component for action types.
 * Renders the action's SVG path at a small size with the action's color.
 */
function ActionIcon({ actionType, size = 14 }: { actionType: PlayerActionType; size?: number }) {
  const config = ACTION_CONFIG[actionType];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block ${config.color} shrink-0`}
    >
      <path d={config.svgPath} />
    </svg>
  );
}

const ACTION_TYPES: PlayerActionType[] = [
  'restore',
  'repair',
  'revive',
  'maneuver',
  'scan',
  'acquire',
  'attack',
  'launch',
  'retaliate',
  'assemble',
  'integrate',
];

// All action types with parameter UIs implemented
const UI_ACTION_TYPES: PlayerActionType[] = ACTION_TYPES.filter((type) =>
  type === 'restore' ||
  type === 'repair' ||
  type === 'revive' ||
  type === 'maneuver' ||
  type === 'scan' ||
  type === 'acquire' ||
  type === 'attack' ||
  type === 'launch' ||
  type === 'assemble' ||
  type === 'integrate',
);

/**
 * Crew action slot component
 */
function CrewActionSlot({
  crew,
  assignedAction,
  isPlanning,
  onActionSelect,
  onClear,
  slotLabel,
}: {
  crew: AnyCrew | Captain;
  assignedAction: PlayerActionType | null;
  isPlanning: boolean;
  onActionSelect: (actionType: PlayerActionType) => void;
  onClear: () => void;
  slotLabel?: string;
}) {
  const isDisabled = crew.status !== 'active' || !isPlanning;
  const roleLabel = 'captainType' in crew ? 'Captain' : ('role' in crew ? crew.role : 'Crew');

  return (
    <div
      className={`panel p-2.5 min-w-[130px] ${
        isDisabled ? 'opacity-40' : ''
      } ${assignedAction ? 'border-l-2' : ''}`}
      style={assignedAction ? {
        borderLeftColor: assignedAction === 'attack' || assignedAction === 'launch' ? '#ef4444'
          : assignedAction === 'repair' ? '#3b82f6'
          : assignedAction === 'revive' ? '#22c55e'
          : assignedAction === 'restore' ? '#eab308'
          : assignedAction === 'maneuver' ? '#22d3ee'
          : assignedAction === 'scan' ? '#a855f7'
          : assignedAction === 'acquire' ? '#f97316'
          : '#64748b',
      } : undefined}
    >
      {/* Crew name and role */}
      <div className="text-xs font-bold truncate text-slate-100">{crew.name}</div>
      <div className="text-[10px] text-gravity-muted capitalize mb-2">
        {roleLabel.replace(/_/g, ' ')}
      </div>
      {slotLabel && (
        <div className="text-[10px] text-blue-400/70 font-medium mb-2">
          {slotLabel}
        </div>
      )}

      {/* Action selector */}
      {!isDisabled && (
        <div className="relative">
          <select
            value={assignedAction ?? ''}
            onChange={(e) => {
              if (e.target.value) {
                onActionSelect(e.target.value as PlayerActionType);
              }
            }}
            className="w-full px-2 py-1.5 text-xs bg-gravity-bg/80 border border-gravity-border/50 rounded-md appearance-none cursor-pointer hover:border-gravity-muted transition-colors"
          >
            <option value="">Select action...</option>
            {UI_ACTION_TYPES.map((actionType) => {
              const config = ACTION_CONFIG[actionType];
              return (
                <option key={actionType} value={actionType}>
                  {config.label}
                </option>
              );
            })}
          </select>
        </div>
      )}

      {/* Show assigned action */}
      {assignedAction && (
        <div className="mt-2 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            <ActionIcon actionType={assignedAction} size={13} />
            <span className={`text-xs font-medium ${ACTION_CONFIG[assignedAction].color}`}>
              {ACTION_CONFIG[assignedAction].label}
            </span>
          </div>
          <button
            onClick={onClear}
            className="text-xs text-gravity-muted hover:text-red-400 transition-colors w-5 h-5 flex items-center justify-center rounded hover:bg-red-500/10"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* Disabled state */}
      {isDisabled && (
        <div className="text-[10px] text-red-400/80 italic flex items-center gap-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          {crew.status === 'unconscious' ? 'Unconscious' : 'Unavailable'}
        </div>
      )}
    </div>
  );
}

export function ActionBar() {
  const {
    game,
    currentPlayerId,
    ui,
    addPlannedAction,
    removePlannedAction,
    playTurn,
    selectCrew,
    selectActionSlot,
    setExecutionConfirmed,
  } = useGameStore();

  const player = currentPlayerId ? game?.players.get(currentPlayerId) : null;

  if (!player || !game) {
    return null;
  }

  // Phase helpers
  const isPlanning = game.turnPhase === 'action_planning';
  const isExecution = game.turnPhase === 'action_execution';

  // All crew including captain
  const allCrew = [player.captain, ...player.crew];

  // Only active crew are required to have actions assigned
  const assignableCrew = allCrew.filter((c) => c.status === 'active');

  const getPlannedActionSlot = (action: { parameters?: Record<string, unknown> } | null | undefined): 'primary' | 'bonus' => {
    const slotRaw = action?.parameters?.uiSlot as unknown;
    return slotRaw === 'bonus' ? 'bonus' : 'primary';
  };

  const assignedPrimaryCrewIds = new Set(
    ui.plannedActions
      .filter((a) => getPlannedActionSlot(a) === 'primary')
      .map((a) => a.crewId),
  );
  const allActionsAssigned = assignableCrew.every((c) => assignedPrimaryCrewIds.has(c.id));

  const phaseLabelMap: Record<string, string> = {
    event: 'Event',
    action_planning: 'Planning',
    action_execution: 'Action Execution',
    environment: 'Environment',
    resolution: 'Resolution',
  };

  const phaseLabel = phaseLabelMap[game.turnPhase] ?? game.turnPhase;
  const submitLabel = 'Advance Phase';

  // Get assigned action for a crew member
  const getAssignedAction = (crewId: string, slot: 'primary' | 'bonus'): PlayerActionType | null => {
    const action = ui.plannedActions.find(
      (a) => a.crewId === crewId && getPlannedActionSlot(a) === slot,
    );
    return action?.type ?? null;
  };

  // Handle action selection
  const handleActionSelect = (crew: AnyCrew | Captain, actionType: PlayerActionType, slot: 'primary' | 'bonus') => {
    if (!currentPlayerId) {
      return;
    }

    selectCrew(crew.id);
    selectActionSlot(slot);

    const baseAction: PlayerAction = {
      playerId: currentPlayerId,
      crewId: crew.id,
      type: actionType,
    };

    // For actions that require parameters (e.g., revive), we now
    // collect them via dedicated UI instead of auto-targeting.
    if (actionType === 'revive') {
      // Mark this crew as the one performing the revive so the
      // dashboard can prompt for a target selection.
      selectCrew(crew.id);
    } else if (ui.selectedCrewId === crew.id && ui.selectedActionSlot === slot) {
      // If we switch away from revive for this crew, clear selection.
      selectCrew(null);
    }

    if (actionType === 'launch') {
      // Default to torpedo launch; user can change in execution phase
      baseAction.parameters = {
        launchType: 'torpedo',
      };
    }

    if (actionType === 'maneuver') {
      // Default to forward 1; user can change in execution phase
      baseAction.parameters = {
        direction: 'forward',
        powerSpent: 1,
      };
    }

    if (actionType === 'assemble') {
      // Default to spare_parts; user can change in execution phase
      baseAction.parameters = {
        itemType: 'spare_parts',
      };
    }

    if (actionType === 'integrate') {
      // upgradeId will be selected in execution phase
      baseAction.parameters = {};
    }

    if (actionType === 'route') {
      // sourceSection, targetSection, amount will be selected in execution phase
      baseAction.parameters = {
        sourceSection: null,
        targetSection: null,
        amount: 1,
      };
    }

    baseAction.parameters = {
      uiSlot: slot,
      ...(baseAction.parameters ?? {}),
    };

    addPlannedAction(baseAction);
  };

  const plannedBonusAction = ui.plannedActions.find((a) => getPlannedActionSlot(a) === 'bonus');
  const plannedBonusCrewId = plannedBonusAction?.crewId ?? null;

  const bonusUpgrade = useMemo(() => {
    const eligibleIds = new Set(['cybernetics', 'temporal_shift']);
    return (player.installedUpgrades ?? []).find((upgrade) => {
      if (!eligibleIds.has(upgrade.id)) {
        return false;
      }
      return getUpgradePowerStatus(upgrade, player.ship).isPowered;
    });
  }, [player.installedUpgrades, player.ship]);

  const canPlanBonusAction = !!bonusUpgrade;
  const shouldShowBonusActionControls = canPlanBonusAction || !!plannedBonusAction;

  const [bonusCrewId, setBonusCrewId] = useState<string>(plannedBonusCrewId ?? '');
  const [showValidationMessage, setShowValidationMessage] = useState(false);

  useEffect(() => {
    if (plannedBonusCrewId) {
      setBonusCrewId(plannedBonusCrewId);
    }
  }, [plannedBonusCrewId]);

  useEffect(() => {
    if (bonusCrewId || assignableCrew.length === 0) {
      return;
    }
    setBonusCrewId(assignableCrew[0].id);
  }, [assignableCrew, bonusCrewId]);

  // Validation for execution phase
  const reviveActions = ui.plannedActions.filter((a) => a.type === 'revive');
  const allRevivesTargeted = reviveActions.every((a) => {
    const targetCrewId = (a.parameters as any)?.targetCrewId;
    return typeof targetCrewId === 'string' && targetCrewId.length > 0;
  });

  const repairActions = ui.plannedActions.filter((a) => a.type === 'repair');
  const allRepairsTargeted = repairActions.every(
    (a) => !!a.target?.section && !!(a.parameters as any)?.repairType,
  );

  const stimActions = ui.plannedActions.filter((a) => (a.parameters as any)?.stimmed === true);
  const allStimsConfigured = stimActions.every((a) => {
    const stimDoctorId = (a.parameters as any)?.stimDoctorId;
    return typeof stimDoctorId === 'string' && stimDoctorId.length > 0 && stimDoctorId !== a.crewId;
  });

  const maneuverActions = ui.plannedActions.filter((a) => a.type === 'maneuver');
  const isManeuverCountValid = maneuverActions.length <= 1;

  const allManeuversConfigured = maneuverActions.every((a) => {
    const params = a.parameters as any;
    return params?.direction && typeof params?.powerSpent === 'number';
  });

  const boardTargetActions = ui.plannedActions.filter(
    (a) => a.type === 'scan' || a.type === 'acquire' || a.type === 'attack',
  );
  const allBoardTargetsSelected = boardTargetActions.every((a) => !!a.target?.objectId);

  const assembleActions = ui.plannedActions.filter((a) => a.type === 'assemble');
  const allAssemblesConfigured = assembleActions.every((a) => !!(a.parameters as any)?.itemType);

  const integrateActions = ui.plannedActions.filter((a) => a.type === 'integrate');
  const allIntegratesConfigured = integrateActions.every((a) => !!(a.parameters as any)?.upgradeId);

  const launchActions = ui.plannedActions.filter((a) => a.type === 'launch');
  const allLaunchesConfigured = launchActions.every((a) => !!(a.parameters as any)?.launchType);

  const routeActions = ui.plannedActions.filter((a) => a.type === 'route');
  const allRoutesConfigured = routeActions.every((a) => {
    const params = a.parameters as any;
    return params?.sourceSection && params?.targetSection && typeof params?.amount === 'number';
  });

  const allExecutionChoicesComplete = 
    allRevivesTargeted && 
    allRepairsTargeted && 
    allStimsConfigured && 
    isManeuverCountValid && 
    allManeuversConfigured && 
    allBoardTargetsSelected && 
    allAssemblesConfigured && 
    allIntegratesConfigured && 
    allLaunchesConfigured && 
    allRoutesConfigured;

  const getValidationMessage = (): string | null => {
    if (!isExecution) return null;
    if (!isManeuverCountValid) return 'Only one Maneuver action allowed per turn';
    if (!allRevivesTargeted) return 'Select revive target';
    if (!allRepairsTargeted) return 'Configure repair actions';
    if (!allStimsConfigured) return 'Assign Doctor for stim packs';
    if (!allManeuversConfigured) return 'Configure maneuver direction/power';
    if (!allBoardTargetsSelected) return 'Select targets for scan/acquire/attack';
    if (!allAssemblesConfigured) return 'Select item type for assemble';
    if (!allIntegratesConfigured) return 'Select upgrade for integrate';
    if (!allLaunchesConfigured) return 'Select launch type';
    if (!allRoutesConfigured) return 'Configure power routing';
    return null;
  };

  // Handle submit turn
  const handleSubmitTurn = () => {
    if (isExecution && !allExecutionChoicesComplete) {
      setShowValidationMessage(true);
      setTimeout(() => setShowValidationMessage(false), 3000);
      return;
    }
    if (isExecution && allExecutionChoicesComplete) {
      setExecutionConfirmed(true);
    }
    playTurn();
  };

  return (
    <div className="px-3 py-2" style={{ background: 'linear-gradient(180deg, rgba(30,41,59,0.6), rgba(15,23,42,0.8))' }}>
      <div className="flex items-center gap-3">
        {/* Phase indicator */}
        <div className="text-xs flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${
            isPlanning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
          }`} />
          <span className={isPlanning ? 'text-emerald-300 font-medium' : 'text-gravity-muted'}>
            {phaseLabel}
          </span>
        </div>

        {/* Crew action slots */}
        <div className="flex-1 flex gap-2 overflow-x-auto pb-1">
          {assignableCrew.map((crew) => {
            return (
              <CrewActionSlot
                key={crew.id}
                crew={crew}
                assignedAction={getAssignedAction(crew.id, 'primary')}
                isPlanning={isPlanning}
                onActionSelect={(actionType) => handleActionSelect(crew, actionType, 'primary')}
                onClear={() => removePlannedAction(crew.id, 'primary')}
              />
            );
          })}

          {shouldShowBonusActionControls && (
            <div className="panel p-2 min-w-[160px]">
              <div className="text-xs font-bold truncate">Bonus Action</div>
              <div className="text-xs text-gravity-muted mb-2">
                {canPlanBonusAction
                  ? `${bonusUpgrade?.name ?? 'Upgrade'} powered`
                  : 'Unavailable (upgrade not powered)'}
              </div>

              <select
                value={bonusCrewId}
                disabled={!isPlanning || assignableCrew.length === 0}
                onChange={(e) => {
                  const nextCrewId = e.target.value;
                  setBonusCrewId(nextCrewId);
                  if (plannedBonusCrewId && plannedBonusCrewId !== nextCrewId) {
                    removePlannedAction(plannedBonusCrewId, 'bonus');
                  }
                  if (nextCrewId) {
                    selectCrew(nextCrewId);
                    selectActionSlot('bonus');
                  }
                }}
                className="w-full px-2 py-1 text-sm bg-gravity-bg border border-gravity-border rounded"
              >
                {assignableCrew.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))}
              </select>

              {(() => {
                const beneficiary = bonusCrewId ? assignableCrew.find((c) => c.id === bonusCrewId) : null;
                if (!beneficiary) {
                  return null;
                }
                return (
                  <div className="mt-2">
                    <CrewActionSlot
                      crew={beneficiary}
                      slotLabel="Bonus slot"
                      assignedAction={getAssignedAction(beneficiary.id, 'bonus')}
                      isPlanning={isPlanning && canPlanBonusAction}
                      onActionSelect={(actionType) => handleActionSelect(beneficiary, actionType, 'bonus')}
                      onClear={() => removePlannedAction(beneficiary.id, 'bonus')}
                    />
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-1 items-end">
          <div className="flex gap-2">
            <button
              onClick={handleSubmitTurn}
              disabled={
                game.status !== 'in_progress' ||
                (isPlanning && !allActionsAssigned)
              }
              className="btn-primary text-xs disabled:opacity-30"
            >
              <span className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                {submitLabel}
              </span>
            </button>
          </div>
          {showValidationMessage && getValidationMessage() && (
            <div className="text-[10px] text-amber-300 bg-amber-950/30 px-2 py-1 rounded border border-amber-500/30">
              {getValidationMessage()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
