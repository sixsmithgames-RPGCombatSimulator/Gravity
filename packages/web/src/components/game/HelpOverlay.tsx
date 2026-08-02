import { useGameStore } from '../../store/gameStore';
import { AccessibleDialog } from './AccessibleDialog';

const TURN_STEPS = [
  ['1', 'Event', 'Every fourth turn, new objects fall in and an Event card resolves.'],
  ['2', 'Plan', 'Select active crew, choose their actions, and configure targets or resources.'],
  ['3', 'Execute', 'Confirm the plan. Actions resolve in the rules-defined action order.'],
  ['4', 'Environment', 'Rings and objects move, orbit stability is checked, then collisions and hazards resolve.'],
] as const;

export function HelpOverlay() {
  const { ui, toggleHelp } = useGameStore();

  if (!ui.helpOpen) {
    return null;
  }

  return (
    <AccessibleDialog
      open={ui.helpOpen}
      onClose={toggleHelp}
      eyebrow="Game help"
      title="Survive the well. Complete your mission. Escape."
      description="A quick guide to the controls and the rules you need during play."
      size="large"
    >
      <div className="space-y-6 text-sm text-slate-200">
        <section aria-labelledby="help-objective">
          <h3 id="help-objective" className="font-display text-base font-semibold text-blue-200">Objective</h3>
          <p className="mt-2 leading-6 text-gravity-muted">
            Keep your ship and crew operational while climbing from the gravity well toward ring 8. Escaping,
            completing your mission, maintaining ship systems, and keeping crew active all contribute to final score.
          </p>
        </section>

        <section aria-labelledby="help-turn">
          <h3 id="help-turn" className="font-display text-base font-semibold text-blue-200">Turn loop</h3>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {TURN_STEPS.map(([number, label, detail]) => (
              <li key={label} className="rounded-md border border-gravity-border/70 bg-slate-950/35 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs font-bold text-blue-200">
                    {number}
                  </span>
                  <span className="font-semibold text-slate-100">{label}</span>
                </div>
                <p className="mt-2 leading-5 text-gravity-muted">{detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="help-controls">
          <h3 id="help-controls" className="font-display text-base font-semibold text-blue-200">Using this screen</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 leading-6 text-gravity-muted">
            <li>Select a crew card in the ship dashboard, then choose an available action.</li>
            <li>Configure the action in the action bar; required targets and resources must be set before execution.</li>
            <li>Use the board controls to zoom or reset the view. Select objects to inspect their state.</li>
            <li>Use Roster to review or change your Captain and two advanced crew during the current beta setup flow.</li>
          </ul>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section aria-labelledby="help-survival" className="rounded-md border border-gravity-border/70 bg-slate-950/35 p-4">
            <h3 id="help-survival" className="font-display text-base font-semibold text-blue-200">Survival essentials</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 leading-5 text-gravity-muted">
              <li>Life support starts at 6 power and supports one non-Android crew per 2 power.</li>
              <li>A section needs hull and power to function. Damaged corridors can block crew movement.</li>
              <li>Match your absolute velocity to the current ring requirement or fall inward on the orbit check.</li>
              <li>Collision, hazard, and environment damage bypass shields.</li>
            </ul>
          </section>

          <section aria-labelledby="help-board" className="rounded-md border border-gravity-border/70 bg-slate-950/35 p-4">
            <h3 id="help-board" className="font-display text-base font-semibold text-blue-200">Board danger</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-gravity-muted">
              <dt className="font-semibold text-emerald-300">Green</dt><dd>Rings 7–8; safest environment.</dd>
              <dt className="font-semibold text-yellow-300">Yellow</dt><dd>Rings 5–6; 2 hull environment damage.</dd>
              <dt className="font-semibold text-orange-300">Orange</dt><dd>Rings 3–4; 4 hull and 1 conduit damage.</dd>
              <dt className="font-semibold text-red-300">Red</dt><dd>Rings 1–2; 8 hull, 2 conduit, and 1 corridor damage.</dd>
            </dl>
          </section>
        </div>

        <p className="rounded-md border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-xs leading-5 text-blue-100">
          Beta note: this build currently runs a local game with one AI opponent. Network sessions and reconnect support are the next product slice.
        </p>
      </div>
    </AccessibleDialog>
  );
}
