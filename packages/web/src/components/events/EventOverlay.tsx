import { useGameStore } from '../../store/gameStore';
import { memo } from 'react';
import { shallow } from 'zustand/shallow';

/** Keep board camera updates out of event-dialog rendering. */
export const EventOverlay = memo(function EventOverlay() {
  const { game, eventOverlayVisible, setEventOverlayVisible } = useGameStore((state) => ({
    game: state.game,
    eventOverlayVisible: state.ui.eventOverlayVisible,
    setEventOverlayVisible: state.setEventOverlayVisible,
  }), shallow);

  if (!game || !eventOverlayVisible || !game.lastResolvedEvent) {
    return null;
  }

  const card = game.lastResolvedEvent;

  const handleDismiss = () => {
    setEventOverlayVisible(false);
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleDismiss}
    >
      <div
        className="max-w-md w-[360px] bg-gravity-surface/95 border border-gravity-border shadow-2xl rounded-lg px-6 py-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-[11px] tracking-[0.25em] uppercase text-gravity-muted mb-1">
          Event
        </div>
        <h2 className="text-2xl font-display font-semibold tracking-wide mb-3">
          {card.name}
        </h2>
        <p className="text-sm text-gravity-muted leading-relaxed mb-5 whitespace-pre-line">
          {card.description}
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          className="btn-primary w-full text-sm"
        >
          Acknowledge
        </button>
      </div>
    </div>
  );
});
