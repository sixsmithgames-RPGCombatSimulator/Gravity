// @vitest-environment jsdom
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../store/gameStore';
import { createMockGame } from '../utils/mockGame';
import { GameBoard } from './board/GameBoard';
import { Header } from './layout/Header';
import { ShipDashboard } from './ship/ShipDashboard';
import { RosterOverlay } from './game/RosterOverlay';
import { GameEndOverlay } from './game/GameEndOverlay';
import { HelpOverlay } from './game/HelpOverlay';

const initialState = useGameStore.getState();
let reducedMotion = false;
const motionListeners = new Set<() => void>();
const pauseAnimations = vi.fn();
const unpauseAnimations = vi.fn();
// jsdom has no native top layer. Stub only the lifecycle and initial focus;
// genuine inertness, Tab containment and native Escape are browser-test gates.
const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
  this.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
});
const closeModal = vi.fn(function (this: HTMLDialogElement) {
  this.removeAttribute('open');
});

/** Use a committed-looking fixture for UI assertions without calling any network mutation. */
function installMissionFixture() {
  useGameStore.setState({
    ...initialState,
    game: { ...createMockGame('hard'), turnPhase: 'action_planning' },
    currentPlayerId: 'player-1',
    networkSessionId: 'shared-mission',
    ui: { ...initialState.ui },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  motionListeners.clear();
  pauseAnimations.mockClear();
  unpauseAnimations.mockClear();
  showModal.mockClear();
  closeModal.mockClear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reducedMotion; },
    addEventListener: (_event: string, callback: () => void) => motionListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) => motionListeners.delete(callback),
  }));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(SVGSVGElement.prototype, 'pauseAnimations', { configurable: true, value: pauseAnimations });
  Object.defineProperty(SVGSVGElement.prototype, 'unpauseAnimations', { configurable: true, value: unpauseAnimations });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: closeModal });
  installMissionFixture();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useGameStore.setState(initialState, true);
});

describe('shared mission presentation', () => {
  it('does not expose local simulation controls in the shared command header', () => {
    render(<Header />);
    expect(screen.queryByRole('button', { name: 'New Game' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Opponent AI/ })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Hard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open developer settings' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Roster' })).toBeTruthy();
    const mobilePlanning = screen.getByRole('button', { name: /Plan actions · 0\/3 ready/ });
    expect(mobilePlanning.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mobilePlanning);
    expect(mobilePlanning.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(mobilePlanning);
    expect(mobilePlanning.getAttribute('aria-expanded')).toBe('false');
  });

  it('inspects committed crew without editable controls or an Apply mutation', () => {
    useGameStore.setState((state) => ({ ui: { ...state.ui, rosterOpen: true } }));
    const authoritativeGame = useGameStore.getState().game;
    render(<RosterOverlay />);
    expect(screen.getByRole('heading', { name: 'Your mission crew' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    expect(useGameStore.getState().game).toBe(authoritativeGame);
  });

  it('explains actual shared turns and returns results through the session lifecycle', () => {
    useGameStore.setState((state) => ({ ui: { ...state.ui, helpOpen: true } }));
    const help = render(<HelpOverlay />);
    expect(screen.getByText(/the turn resolves after every human player/)).toBeTruthy();
    expect(screen.getByText(/Attacks, scans, probes, and torpedoes spend the assigned crew action/)).toHaveProperty('textContent', 'Attacks, scans, probes, and torpedoes spend the assigned crew action and their usual power or ammunition even if another crew clears the shared target first. The later action adds no effect or reward.');
    expect(screen.queryByText(/Network sessions and reconnect support are the next/)).toBeNull();
    help.unmount();
    useGameStore.setState((state) => ({ game: { ...state.game!, status: 'completed' } }));
    const authoritativeGame = useGameStore.getState().game;
    const returnHome = vi.fn();
    render(<GameEndOverlay onReturnHome={returnHome} />);
    fireEvent.click(screen.getByRole('button', { name: 'Return to mission home' }));
    expect(returnHome).toHaveBeenCalledOnce();
    expect(useGameStore.getState().game).toBe(authoritativeGame);
  });

  it('settles ship measurements and excludes camera/animation updates from command and ship rendering', () => {
    const headerCommits = vi.fn();
    const shipCommits = vi.fn();
    render(<>
      <Profiler id="header" onRender={headerCommits}><Header /></Profiler>
      <Profiler id="ship" onRender={shipCommits}><ShipDashboard /></Profiler>
    </>);
    act(() => { vi.advanceTimersByTime(100); });
    const settledHeaderCommits = headerCommits.mock.calls.length;
    const settledShipCommits = shipCommits.mock.calls.length;
    act(() => {
      useGameStore.getState().setBoardZoom(1.2);
      useGameStore.getState().setBoardOffset({ x: 40, y: 20 });
      useGameStore.getState().setRingAnimationProgress(0.5);
      vi.advanceTimersByTime(500);
    });
    expect(headerCommits).toHaveBeenCalledTimes(settledHeaderCommits);
    expect(shipCommits).toHaveBeenCalledTimes(settledShipCommits);
  });

  it('uses native modal lifecycle and restores focus after Close, Escape and outside dismissal', () => {
    render(<>
      <button type="button" onClick={() => useGameStore.getState().toggleHelp()}>Read mission help</button>
      <HelpOverlay />
    </>);
    const opener = screen.getByRole('button', { name: 'Read mission help' });
    for (let opening = 0; opening < 3; opening += 1) {
      act(() => opener.focus());
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog');
      const backdrop = screen.getByTestId('modal-backdrop');
      expect(dialog.tagName).toBe('DIALOG');
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(showModal).toHaveBeenCalledTimes(opening + 1);
      expect(document.body.style.pointerEvents).toBe('');
      expect(fireEvent.wheel(backdrop, { deltaY: 120, cancelable: true })).toBe(false);
      expect(fireEvent.wheel(opener, { deltaY: 120, cancelable: true })).toBe(false);
      expect(fireEvent.wheel(screen.getByTestId('modal-surface'), { deltaY: 120, cancelable: true })).toBe(true);
      if (opening === 0) {
        fireEvent.click(screen.getByRole('button', { name: 'Close Game help' }));
      } else if (opening === 1) {
        fireEvent(dialog, new Event('cancel', { cancelable: true }));
      } else {
        // A secondary click and a content-to-backdrop drag must not dismiss.
        fireEvent.pointerDown(backdrop, { button: 2 });
        fireEvent.click(backdrop, { button: 2 });
        expect(screen.getByRole('dialog')).toBe(dialog);
        fireEvent.pointerDown(screen.getByTestId('modal-surface'), { button: 0 });
        fireEvent.click(backdrop, { button: 0 });
        expect(screen.getByRole('dialog')).toBe(dialog);
        fireEvent.pointerDown(backdrop, { button: 0 });
        fireEvent.click(backdrop, { button: 0 });
      }
      act(() => { vi.advanceTimersByTime(0); });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(closeModal).toHaveBeenCalledTimes(opening + 1);
      expect(document.activeElement).toBe(opener);
      expect(fireEvent.wheel(opener, { deltaY: 120, cancelable: true })).toBe(true);
    }
  });

  it('offers keyboard inspection in a readable HTML card and pauses SMIL when motion is reduced', () => {
    render(<GameBoard />);
    // Keep the bounded rendering surface distinct from its camera transform;
    // browser visual tests verify the actual containment and unclipped controls.
    expect(screen.getByTestId('game-board-viewport').classList.contains('tactical-board-viewport')).toBe(true);
    const object = screen.getAllByRole('button', { name: /^Inspect / })[0];
    act(() => object.focus());
    fireEvent.keyDown(object, { key: 'Enter' });
    expect(object.getAttribute('aria-pressed')).toBe('true');
    const inspection = screen.getByRole('region', { name: 'Board object inspection' });
    expect(inspection.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
    expect(screen.getByRole('button', { name: 'Close object inspection' })).toBeTruthy();
    act(() => {
      reducedMotion = true;
      motionListeners.forEach((listener) => listener());
    });
    expect(pauseAnimations).toHaveBeenCalled();
    act(() => {
      reducedMotion = false;
      motionListeners.forEach((listener) => listener());
    });
    expect(unpauseAnimations).toHaveBeenCalled();
  });
});
