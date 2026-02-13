# Gravity UI Implementation Roadmap

## Overview

This document defines the complete user interface implementation plan for the Gravity board game. The UI must support professional-level gameplay with intuitive controls, clear visual feedback, and responsive design suitable for both casual play and competitive sessions.

### Design Philosophy

1. **Spatial Clarity**: The circular board with 8 concentric rings is the heart of the game. Every UI decision must reinforce spatial awareness—where ships are, what's nearby, and what's dangerous.

2. **Information Hierarchy**: Players need to see:
   - **Immediate**: Their ship's critical status (hull, shields, crew alerts)
   - **Tactical**: The board state (nearby objects, hazards, hostiles)
   - **Strategic**: Long-term concerns (mission progress, escape path, other players)

3. **Action Flow**: Planning a turn involves multiple crew taking multiple actions. The UI must make this feel natural, not like filling out a form.

4. **Feedback Loops**: Every game event—damage, movement, collision, power generation—needs clear visual and audio feedback so players understand cause and effect.

---

## Tech Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | **React 18+** | Component model fits game UI well; large ecosystem |
| State | **Zustand** | Lightweight, works well with immutable game state from engine |
| Styling | **Tailwind CSS** | Rapid iteration, consistent design tokens |
| Components | **Radix UI** | Accessible primitives for dialogs, menus, tooltips |
| Board Rendering | **React + SVG** | Vector graphics scale perfectly for the circular board |
| Animations | **Framer Motion** | Declarative animations for movement, damage, transitions |
| Icons | **Lucide React** | Clean, consistent iconography |
| Sound | **Howler.js** | Cross-browser audio for game events |
| Testing | **Playwright** | E2E testing for game flows |

---

## Implementation Blocks

### Block F: Foundation & Board Visualization

**Goal**: Render the game board with all objects, establish the visual language, and prove out the rendering approach.

#### F.1: Project Scaffolding
- Create `packages/ui` with Vite + React + TypeScript
- Configure Tailwind with custom color palette matching game zones:
  - `gravity-green` (rings 7-8, safe)
  - `gravity-yellow` (rings 5-6, caution)
  - `gravity-orange` (rings 3-4, danger)
  - `gravity-red` (rings 1-2, critical)
  - `gravity-void` (center, black hole)
- Set up Zustand store that wraps `GameState` from `@gravity/core`
- Create layout shell: Board area (primary), Ship dashboard (sidebar), Action bar (bottom)

#### F.2: Board Renderer
- **Ring rendering**: 8 concentric circles with zone coloring
- **Space markers**: Subtle tick marks showing discrete spaces per ring
- **Rotation indicator**: Visual cue showing current ring rotation state
- **Center black hole**: Animated void effect at center
- **Coordinate system**: Internal utilities to convert `{ ring, space }` to `{ x, y }` for SVG placement

#### F.3: Space Object Rendering
- **Object sprites/icons** for each `ObjectType`:
  - `hazard`: Pulsing radiation symbol with glow effect
  - `asteroid_cluster`: Rocky mass icon
  - `debris`: Scattered fragments
  - `hostile_ship`: Aggressive ship silhouette with red accent
  - `wrecked_ship`: Damaged hull outline
  - `functional_station`: Station icon with activity lights
- **Hover tooltips**: Show object details (type, hull if applicable, distance from player)
- **Selection state**: Click to select object for targeting

#### F.4: Ship Tokens
- **Player ship token**: Distinctive ship icon with player color
- **Ship facing**: Optional directional indicator
- **Status badges**: Small icons for critical states (low hull, no power, shields up)
- **Other players**: Differentiated by color, slightly smaller or muted when not active turn
- **Bot indicator**: Subtle CPU icon overlay for bot players

#### F.5: Board Interaction
- **Pan & zoom**: Mouse wheel zoom, drag to pan (for detailed inspection)
- **Minimap**: Small overview in corner when zoomed in
- **Distance overlay**: When selecting an action target, show range rings from player ship
- **Path preview**: When planning maneuver, show projected path and final position

---

### Block G: Ship Dashboard

**Goal**: Give players complete awareness of their ship state with intuitive controls for crew and power management.

#### G.1: Ship Section Display
- **Six-section layout**: Visual representation of ship sections arranged logically:
  ```
       [Bridge]
    [Sci-Lab] [Defense]
   [Engineering] [Med-Lab]
       [Cargo]
  ```
- **Section cards** showing for each:
  - Section name and icon
  - Hull points (bar or numeric, color-coded by damage level)
  - Power dice (visual dice showing current values)
  - Conduit status (connection lines to adjacent sections)
  - Corridor status (crew movement paths, shown as connected/broken)
  - Crew currently in section (small portraits)

#### G.2: Section Interaction
- **Click section**: Select for repair target or power routing
- **Hover section**: Highlight connected corridors and conduits
- **Damage animation**: Flash red and shake when section takes damage
- **Power flow**: Animated particles showing power moving between sections

#### G.3: Crew Roster
- **Crew list panel**: All crew with:
  - Portrait/avatar
  - Name and role (Engineer, Pilot, Medic, etc.)
  - Current status (active, unconscious, dead)
  - Current location (section)
  - Action assignment this turn (if any)
- **Captain highlight**: Special styling for captain with bonus abilities shown
- **Drag-and-drop**: Drag crew between sections (if corridor intact)
- **Unconscious crew**: Grayed out with revive progress indicator

#### G.4: Resource & Status Bar
- **Shield counter**: Large, prominent shield count with +/- animation
- **Resource inventory**: Compact display of:
  - Spare parts
  - Power cells  
  - Medical kits
  - Torpedoes
  - Probes
- **Mission tracker**: Current mission objectives with completion status
- **Upgrade slots**: Installed upgrades with hover for details

#### G.5: Ship Alerts
- **Alert system**: Prominent warnings for:
  - "Hull Critical" (any section < 3 hull)
  - "No Power" (Engineering empty)
  - "Life Support Failing" (excess crew for life support)
  - "Collision Imminent" (object in same space after orbit)
  - "Hostile Adjacent" (hostile ship within attack range)
- **Alert styling**: Color-coded severity, dismissable but persistent until resolved

---

### Block H: Turn & Action System

**Goal**: Make planning and executing turns feel fluid and strategic, not tedious.

#### H.1: Turn Phase Indicator
- **Phase display**: Clear indicator of current phase:
  - Event (card reveal)
  - Action Planning (player input)
  - Action Execution (resolution)
  - Environment (damage, movement)
  - Resolution (cleanup)
- **Phase transitions**: Smooth animation between phases
- **Timer** (optional): For competitive play, configurable turn timer

#### H.2: Action Planning Interface
- **Crew action slots**: For each active crew, a slot to assign an action
- **Action type selector**: Visual menu of available actions:
  - Generate ⚡ (requires Engineering or special)
  - Repair 🔧 (requires adjacent to damage)
  - Revive 💊 (requires Med-Lab, unconscious target)
  - Maneuver 🚀 (requires Bridge)
  - Scan 🔍 (requires Sci-Lab or range)
  - Acquire 📦 (requires scanned object in range)
  - Attack ⚔️ (requires Defense, powered, target in range)
  - Launch 🎯 (requires resource: torpedo or probe)
  - Assemble 🔨 (craft resources)
  - Integrate ⚙️ (activate pending upgrade)
- **Action validation**: Real-time feedback on whether action is valid
  - Green highlight: Valid
  - Yellow highlight: Valid but suboptimal (warning)
  - Red highlight: Invalid (with reason on hover)

#### H.3: Target Selection
- **Context-sensitive targeting**: When action requires target:
  - Repair → highlight damaged sections
  - Attack → highlight valid hostile targets on board
  - Maneuver → show direction options with preview
  - Scan/Acquire → highlight objects in range
- **Target confirmation**: Click to select, click again or button to confirm
- **Cancel affordance**: Easy way to back out of target selection

#### H.4: Action Queue Display
- **Planned actions list**: Show all planned actions for this turn
- **Reorder capability**: Drag to reorder actions (if rules allow)
- **Remove action**: X button to unassign action from crew
- **Submit turn**: Prominent button to finalize and submit all actions

#### H.5: Action Resolution Display
- **Resolution log**: Step-by-step display of what happened:
  - "Engineer in Engineering generated 3 power"
  - "Pilot maneuvered ship outward 2 spaces to Ring 5"
  - "Hostile ship attacked! 8 damage to shields"
- **Resolution animation**: Brief visual for each action resolving
- **Damage numbers**: Floating damage numbers when damage dealt/received
- **Pause between actions**: Configurable speed or manual step-through

---

### Block I: Environment & Combat Visualization

**Goal**: Make environmental effects and combat feel impactful and understandable.

#### I.1: Environment Phase Visualization
- **Ring rotation animation**: Smooth rotation of ring contents
- **Environment damage overlay**: Brief flash on rings showing damage zones
- **Damage application**: Animated damage numbers on affected ships
- **Object movement**: Objects smoothly animate to new positions

#### I.2: Hazard Effects
- **Hazard range indicator**: When near hazard, show affected radius
- **Radiation animation**: Pulsing effect emanating from hazards
- **Damage connection**: Visual line from hazard to ship when damage applied

#### I.3: Collision Visualization
- **Collision prediction**: During planning, warn if move will cause collision
- **Collision animation**: Impact effect when collision occurs
- **Debris creation**: When hostile destroyed, show conversion to debris
- **Ship damage**: Visible damage effect on colliding ship

#### I.4: Combat Visualization
- **Attack animation**: Weapon fire from attacking ship to target
- **Dice roll display**: Show attack dice results (2d6 + bonuses)
- **Damage breakdown**: "Base: 7 + Tactician: +2 + Powered: +2 = 11 damage"
- **Shield absorption**: Visual shield flicker when absorbing damage
- **Hull damage**: Section damage indicator when hull hit
- **Hostile destruction**: Explosion effect, conversion to debris

#### I.5: Torpedo & Probe Launch
- **Launch animation**: Projectile traveling from ship to target
- **Torpedo impact**: Explosion effect at target
- **Probe scan**: Expanding ring effect revealing information

---

### Block J: Game Flow & Polish

**Goal**: Complete game experience from lobby to victory.

#### J.1: Game Lobby
- **Create game**: Configure player count, bot difficulty, optional rules
- **Join game**: Enter game code or select from available games
- **Player list**: Show joined players with ready status
- **Captain/crew draft**: If using draft rules, interface for selection
- **Start game**: Host can start when all ready

#### J.2: Game Setup Visualization
- **Initial placement**: Show starting positions being assigned
- **Mission deal**: Animate mission cards being dealt
- **First turn setup**: Transition smoothly into first turn

#### J.3: Victory & Defeat Screens
- **Escape victory**: Celebratory animation for escaped players
- **Wrecked defeat**: Somber animation for wrecked ships
- **Score breakdown**: 
  - Escape bonus
  - Surviving crew
  - Completed missions
  - Resources collected
  - Installed upgrades
- **Final rankings**: Multi-player comparison
- **Play again**: Quick restart option

#### J.4: Sound Design
- **Ambient**: Subtle space ambiance, varies by ring zone
- **UI sounds**: Click, hover, select, confirm, cancel
- **Action sounds**: Power generation hum, repair clang, engine thrust
- **Combat sounds**: Weapon fire, explosions, shield impacts
- **Alert sounds**: Warning klaxons for critical states
- **Music**: Optional background music (toggleable)
- **Volume controls**: Master, SFX, music, ambient sliders

#### J.5: Settings & Accessibility
- **Visual settings**:
  - Color blind modes (deuteranopia, protanopia, tritanopia)
  - High contrast mode
  - Reduced motion option
  - UI scale adjustment
- **Audio settings**: Individual volume controls
- **Gameplay settings**:
  - Animation speed (fast/normal/slow/step)
  - Auto-end turn when no actions
  - Confirm before dangerous actions
- **Keybindings**: Customizable keyboard shortcuts

#### J.6: Help & Tutorial
- **Interactive tutorial**: Guided first game teaching core mechanics
- **Help overlay**: Press ? to see available actions and shortcuts
- **Tooltips**: Comprehensive tooltips on all UI elements
- **Rules reference**: In-game rulebook access
- **Action glossary**: Quick reference for what each action does

---

### Block K: Multiplayer & Persistence

**Goal**: Support real multiplayer games with proper state management.

#### K.1: Real-time Sync
- **WebSocket connection**: Real-time game state updates
- **Optimistic UI**: Immediate feedback, reconcile with server
- **Reconnection handling**: Graceful reconnect if connection lost
- **Spectator mode**: Watch ongoing games without participating

#### K.2: Player Presence
- **Active player indicator**: Whose turn it is
- **Player status**: Online/offline/thinking indicators
- **Turn timer**: Visual countdown if timed turns enabled
- **Disconnect handling**: Pause or bot takeover options

#### K.3: Game Persistence
- **Save/load**: Save game state, resume later
- **Game history**: List of past games with results
- **Replay system**: Step through past game turn by turn
- **Export**: Download game log for analysis

---

## Implementation Order

### Phase 1: Core Playable (Blocks F, G, H)
**Duration**: 2-3 weeks
**Outcome**: Single-player game against bots is fully playable with basic visuals

1. F.1: Scaffolding (2 days)
2. F.2: Board renderer (3 days)
3. F.3: Object rendering (2 days)
4. F.4: Ship tokens (1 day)
5. G.1: Ship section display (2 days)
6. G.2-G.3: Section interaction & crew (3 days)
7. G.4: Resources & status (1 day)
8. H.1-H.2: Turn phases & action planning (3 days)
9. H.3-H.4: Target selection & queue (2 days)
10. H.5: Action resolution display (2 days)

### Phase 2: Visual Polish (Blocks I, J.4-J.5)
**Duration**: 1-2 weeks
**Outcome**: Game feels professional with animations and sound

1. I.1-I.2: Environment visualization (2 days)
2. I.3-I.5: Combat & effects (3 days)
3. F.5: Board interaction polish (2 days)
4. J.4: Sound design (2 days)
5. J.5: Settings & accessibility (2 days)

### Phase 3: Complete Experience (J.1-J.3, J.6)
**Duration**: 1 week
**Outcome**: Full game flow from start to finish

1. J.1-J.2: Lobby & setup (2 days)
2. J.3: Victory/defeat screens (1 day)
3. J.6: Help & tutorial (2 days)

### Phase 4: Multiplayer (Block K)
**Duration**: 1-2 weeks
**Outcome**: Real multiplayer support

1. K.1: Real-time sync (3 days)
2. K.2: Player presence (2 days)
3. K.3: Persistence & replay (3 days)

---

## Visual Reference

### Color Palette

```
Ring Zones:
- Rings 7-8 (Green):    #22c55e (safe, escape zone)
- Rings 5-6 (Yellow):   #eab308 (caution, mild damage)
- Rings 3-4 (Orange):   #f97316 (danger, moderate damage)
- Rings 1-2 (Red):      #ef4444 (critical, heavy damage)
- Center (Void):        #18181b (black hole, instant death)

Ship Sections:
- Bridge:       #3b82f6 (blue, command)
- Engineering:  #f59e0b (amber, power)
- Defense:      #ef4444 (red, weapons)
- Sci-Lab:      #8b5cf6 (purple, science)
- Med-Lab:      #22c55e (green, medical)
- Cargo:        #6b7280 (gray, storage)

UI Chrome:
- Background:   #0f172a (slate-900)
- Surface:      #1e293b (slate-800)
- Border:       #334155 (slate-700)
- Text:         #f8fafc (slate-50)
- Muted:        #94a3b8 (slate-400)
```

### Layout Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo]  Turn 5 | Phase: Action Planning | Player: You    [⚙️] │
├─────────────────────────────────────────────┬───────────────────┤
│                                             │                   │
│                                             │   SHIP DASHBOARD  │
│                                             │                   │
│              GAME BOARD                     │  ┌─────────────┐  │
│                                             │  │   Bridge    │  │
│         (Circular ring display)             │  ├──────┬──────┤  │
│                                             │  │Sci-  │Def-  │  │
│                                             │  │Lab   │ense  │  │
│                                             │  ├──────┼──────┤  │
│                                             │  │Engi- │Med-  │  │
│                                             │  │neer  │Lab   │  │
│                                             │  ├──────┴──────┤  │
│                                             │  │   Cargo     │  │
│                                             │  └─────────────┘  │
│                                             │                   │
│                                             │  Shields: ████ 6  │
│                                             │  Crew: 5 active   │
│                                             │  Resources: ...   │
├─────────────────────────────────────────────┴───────────────────┤
│  ACTION BAR                                                     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                   │
│  │Captain │ │Engineer│ │ Pilot  │ │ Medic  │    [Submit Turn]  │
│  │Generate│ │Repair  │ │Maneuver│ │  ---   │                   │
│  └────────┘ └────────┘ └────────┘ └────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

### Functional
- [ ] Can create and start a new game
- [ ] Can see all 8 rings with correct zone coloring
- [ ] Can see all space objects at correct positions
- [ ] Can see own ship and all ship sections
- [ ] Can assign actions to each active crew member
- [ ] Can select valid targets for actions requiring them
- [ ] Can submit turn and see resolution
- [ ] Can see environment phase effects (rotation, damage)
- [ ] Can win by escaping or lose by being wrecked
- [ ] Bot players take reasonable actions

### Visual
- [ ] Board is visually clear at default zoom
- [ ] Ship section status is immediately readable
- [ ] Action validity is obvious (green/red indicators)
- [ ] Animations enhance understanding, don't obstruct
- [ ] Works at 1280x720 minimum resolution
- [ ] Responsive up to 4K displays

### UX
- [ ] New player can understand basics within 5 minutes
- [ ] Experienced player can plan turn in under 30 seconds
- [ ] No action requires more than 3 clicks
- [ ] Keyboard shortcuts available for all common actions
- [ ] Error states have clear recovery paths

### Performance
- [ ] Initial load under 3 seconds
- [ ] Turn submission response under 500ms
- [ ] Animations run at 60fps
- [ ] No memory leaks over extended play sessions

---

## Next Steps

To begin implementation, start with **Block F.1: Project Scaffolding** to establish the `packages/ui` workspace with the tech stack configured.
