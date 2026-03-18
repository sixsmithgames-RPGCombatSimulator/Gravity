import type {
  ManeuverActionParameters,
  ManeuverDirection,
  ManeuverMotionPlan,
  RadialManeuverDirection,
  TangentialManeuverDirection,
  ShipSection,
} from '@gravity/core';

export type DraftManeuverActionParameters = Partial<ManeuverActionParameters> & {
  draftTangentialDirection?: TangentialManeuverDirection | null;
  draftTangentialDistance?: number | null;
  draftRadialDirection?: RadialManeuverDirection | null;
  draftRadialDistance?: number | null;
  draftPowerSpent?: number;
  draftRerouteSourceSection?: ShipSection | null;
  draftDirection?: ManeuverDirection;
  draftDistance?: number | null;
};

export type ResolvedManeuverEditorState = {
  committedPlan: ManeuverMotionPlan;
  committedPowerSpent: number | null;
  committedRerouteSourceSection: ShipSection | null;
  draftPlan: ManeuverMotionPlan | null;
  draftPowerSpent: number | undefined;
  draftRerouteSourceSection: ShipSection | null | undefined;
  workingPlan: ManeuverMotionPlan;
  workingPowerSpent: number | null;
  workingRerouteSourceSection: ShipSection | null;
  isEditing: boolean;
};

function isTangentialDirection(value: unknown): value is TangentialManeuverDirection {
  return value === 'forward' || value === 'backward';
}

function isRadialDirection(value: unknown): value is RadialManeuverDirection {
  return value === 'inward' || value === 'outward';
}

function parseOptionalDistance(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
}

function normalizeCommittedPlan(parameters: DraftManeuverActionParameters | undefined): ManeuverMotionPlan {
  const tangentialDirection = isTangentialDirection(parameters?.tangentialDirection)
    ? parameters.tangentialDirection
    : isTangentialDirection(parameters?.direction)
      ? parameters.direction
      : null;
  const radialDirection = isRadialDirection(parameters?.radialDirection)
    ? parameters.radialDirection
    : isRadialDirection(parameters?.direction)
      ? parameters.direction
      : null;
  const tangentialDistance =
    parseOptionalDistance(parameters?.tangentialDistance) ??
    (tangentialDirection && !parameters?.radialDirection ? parseOptionalDistance(parameters?.distance) ?? null : null);
  const radialDistance =
    parseOptionalDistance(parameters?.radialDistance) ??
    (radialDirection && !parameters?.tangentialDirection ? parseOptionalDistance(parameters?.distance) ?? null : null);

  return {
    tangentialDirection,
    tangentialDistance,
    radialDirection,
    radialDistance,
    direction:
      tangentialDirection && !radialDirection
        ? tangentialDirection
        : radialDirection && !tangentialDirection
          ? radialDirection
          : undefined,
    distance:
      tangentialDirection && !radialDirection
        ? tangentialDistance
        : radialDirection && !tangentialDirection
          ? radialDistance
          : undefined,
  };
}

function normalizeDraftPlan(parameters: DraftManeuverActionParameters | undefined): ManeuverMotionPlan | null {
  const hasDraftFields =
    parameters?.draftTangentialDirection !== undefined ||
    parameters?.draftTangentialDistance !== undefined ||
    parameters?.draftRadialDirection !== undefined ||
    parameters?.draftRadialDistance !== undefined ||
    parameters?.draftDirection !== undefined ||
    parameters?.draftDistance !== undefined;

  if (!hasDraftFields) {
    return null;
  }

  const tangentialDirection = isTangentialDirection(parameters?.draftTangentialDirection)
    ? parameters.draftTangentialDirection
    : isTangentialDirection(parameters?.draftDirection)
      ? parameters.draftDirection
      : parameters?.draftTangentialDirection === null
        ? null
        : undefined;
  const radialDirection = isRadialDirection(parameters?.draftRadialDirection)
    ? parameters.draftRadialDirection
    : isRadialDirection(parameters?.draftDirection)
      ? parameters.draftDirection
      : parameters?.draftRadialDirection === null
        ? null
        : undefined;
  const tangentialDistance =
    parseOptionalDistance(parameters?.draftTangentialDistance) ??
    (parameters?.draftTangentialDistance === null
      ? null
      : tangentialDirection && radialDirection === undefined
        ? parseOptionalDistance(parameters?.draftDistance) ?? (parameters?.draftDistance === null ? null : undefined)
        : undefined);
  const radialDistance =
    parseOptionalDistance(parameters?.draftRadialDistance) ??
    (parameters?.draftRadialDistance === null
      ? null
      : radialDirection && tangentialDirection === undefined
        ? parseOptionalDistance(parameters?.draftDistance) ?? (parameters?.draftDistance === null ? null : undefined)
        : undefined);

  return {
    tangentialDirection,
    tangentialDistance,
    radialDirection,
    radialDistance,
    direction:
      tangentialDirection && !radialDirection
        ? tangentialDirection
        : radialDirection && !tangentialDirection
          ? radialDirection
          : undefined,
    distance:
      tangentialDirection && !radialDirection
        ? tangentialDistance
        : radialDirection && !tangentialDirection
          ? radialDistance
          : undefined,
  };
}

export function resolveManeuverEditorState(
  parameters: DraftManeuverActionParameters | undefined,
  isValidSection: (value: unknown) => value is ShipSection,
): ResolvedManeuverEditorState {
  const committedPlan = normalizeCommittedPlan(parameters);
  const committedPowerSpent =
    typeof parameters?.powerSpent === 'number' && Number.isFinite(parameters.powerSpent)
      ? parameters.powerSpent
      : null;
  const committedRerouteSourceSection = isValidSection(parameters?.rerouteSourceSection)
    ? parameters.rerouteSourceSection
    : null;
  const draftPlan = normalizeDraftPlan(parameters);
  const draftPowerSpent =
    typeof parameters?.draftPowerSpent === 'number' && Number.isFinite(parameters.draftPowerSpent)
      ? parameters.draftPowerSpent
      : undefined;
  const draftRerouteSourceSection =
    parameters?.draftRerouteSourceSection === null
      ? null
      : isValidSection(parameters?.draftRerouteSourceSection)
        ? parameters.draftRerouteSourceSection
        : undefined;
  const isEditing = draftPlan !== null || draftPowerSpent !== undefined || draftRerouteSourceSection !== undefined;
  const workingPlan = draftPlan ?? committedPlan;
  const workingPowerSpent = draftPowerSpent ?? committedPowerSpent;
  const workingRerouteSourceSection =
    draftRerouteSourceSection !== undefined ? draftRerouteSourceSection : committedRerouteSourceSection;

  return {
    committedPlan,
    committedPowerSpent,
    committedRerouteSourceSection,
    draftPlan,
    draftPowerSpent,
    draftRerouteSourceSection,
    workingPlan,
    workingPowerSpent,
    workingRerouteSourceSection,
    isEditing,
  };
}

export function hasConfiguredManeuverPlan(plan: ManeuverMotionPlan): boolean {
  return !!plan.tangentialDirection || !!plan.radialDirection;
}

export function hasManeuverDraftChanges(parameters: DraftManeuverActionParameters | undefined): boolean {
  return (
    parameters?.draftTangentialDirection !== undefined ||
    parameters?.draftTangentialDistance !== undefined ||
    parameters?.draftRadialDirection !== undefined ||
    parameters?.draftRadialDistance !== undefined ||
    parameters?.draftPowerSpent !== undefined ||
    parameters?.draftRerouteSourceSection !== undefined ||
    parameters?.draftDirection !== undefined ||
    parameters?.draftDistance !== undefined
  );
}

export function buildCommittedManeuverParameters(
  plan: ManeuverMotionPlan,
  powerSpent: number,
  rerouteSourceSection: ShipSection | null,
): ManeuverActionParameters {
  const parameters: ManeuverActionParameters = {
    powerSpent,
    tangentialDirection: plan.tangentialDirection ?? null,
    tangentialDistance: plan.tangentialDistance ?? null,
    radialDirection: plan.radialDirection ?? null,
    radialDistance: plan.radialDistance ?? null,
    rerouteSourceSection,
    direction: undefined,
    distance: undefined,
  };

  if (plan.tangentialDirection && !plan.radialDirection) {
    parameters.direction = plan.tangentialDirection;
    parameters.distance = plan.tangentialDistance ?? null;
  }

  if (plan.radialDirection && !plan.tangentialDirection) {
    parameters.direction = plan.radialDirection;
    parameters.distance = plan.radialDistance ?? null;
  }

  return parameters;
}

export function buildDraftManeuverParameters(plan: ManeuverMotionPlan): Partial<DraftManeuverActionParameters> {
  const parameters: Partial<DraftManeuverActionParameters> = {
    draftTangentialDirection: plan.tangentialDirection ?? null,
    draftTangentialDistance: plan.tangentialDistance ?? null,
    draftRadialDirection: plan.radialDirection ?? null,
    draftRadialDistance: plan.radialDistance ?? null,
  };

  if (plan.tangentialDirection && !plan.radialDirection) {
    parameters.draftDirection = plan.tangentialDirection;
    parameters.draftDistance = plan.tangentialDistance ?? null;
  } else if (plan.radialDirection && !plan.tangentialDirection) {
    parameters.draftDirection = plan.radialDirection;
    parameters.draftDistance = plan.radialDistance ?? null;
  } else {
    parameters.draftDirection = undefined;
    parameters.draftDistance = undefined;
  }

  return parameters;
}
