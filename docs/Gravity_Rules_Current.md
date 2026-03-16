# Gravity Current Rules

## Status
This document is the authoritative rules source for the current Gravity playtest.

Use this document when:

- Running tabletop playtests
- Aligning the digital rules engine
- Writing UI rules text, onboarding, and reference material
- Resolving rules disputes during play

This document supersedes `Gravity_Rules_Draft.txt` for current play. The draft file remains useful as historical source material, but if the draft and this document disagree, this document wins.

## Change Policy
Gravity is still in active playtest.

Use these rules as the current baseline.

When a rule changes:

- Update this document first
- Then update engine behavior
- Then update tests
- Then update player-facing UI text

Do not use undocumented house rulings as permanent rules. If a recurring ruling is needed, add it here.

## Rules Writing Conventions
To reduce ambiguity:

- "Must" means required.
- "May" means optional.
- "Velocity" means the ship's signed orbital stat. Positive velocity is forward. Negative velocity is backward. Older draft references to "speed" mean velocity.
- "Board distance" means the shortest number of legal board-adjacency steps between two spaces.
- "Adjacent" means board distance `1`.
- "In range" means within the stated maximum board distance.
- "Functional section" means a section with at least `1` hull and at least `1` power.
- "Usable section" means a section that is functional and not disabled.
- "Fully powered section" means a functional section whose current power equals or exceeds its section power requirement.
- "Damaged section" means a section at `0` hull.
- "Disabled section" means a section that cannot route or receive power because all conduits leading into it are overloaded or destroyed.
- "Active ship" means a ship whose player status is `active`.
- "Occupied space" means a board space containing at least one ship or object.
- If a rule grants a bonus, apply that bonus only to the action being resolved.
- If two rules conflict, apply them in this priority order:
  1. This document
  2. Card text reproduced in this document
  3. Scenario or event text
  4. Any older draft wording

## Game Summary
Each player commands a damaged ship trapped in a gravity well.

You must:

- Keep your ship functional
- Restore crew and systems
- Gather resources and upgrades
- Complete mission objectives when possible
- Escape before your ship is wrecked

Gravity is a competitive simultaneous-turn strategy game. The winner is the player with the most victory points when the game ends.

## Player Count
Gravity supports:

- Minimum players: `2`
- Maximum players: `6`

## Core Concepts
### Ships
Each player has one ship with six sections:

- Bridge
- Engineering
- Drives
- Med-Lab
- Sci-Lab
- Defense

### Crew
Each player has:

- `1` Captain
- `2` Officers
- `5` Basic crew

### Board
The board has `8` orbit rings.

- Ring `1` is the innermost ring.
- Ring `8` is the outermost ring.
- Rings rotate every turn.
- Ships and objects can move around rings and between rings.

### Life Support
Life support is tracked as a power pool, not a headcount track.

- Your ship starts with `6` life support power.
- Every active crew member that requires life support consumes `2` life support power.
- Capacity is `floor(total life support power / 2)`.
- The Android does not require life support.

### Shields
Shields absorb incoming weapon damage before hull damage unless a rule says the damage bypasses shields.

Collision damage, hazard damage, and environment damage bypass shields.

## Objective and End of Game
### Primary objective
Finish the game with the highest victory point total.

### The game ends at the end of a turn when either condition is met
- Half or more ships have escaped.
- All remaining ships are wrecked.

### If a ship escapes or is wrecked
That ship remains in the game only for scoring and effects that specifically refer to escaped or wrecked ships.

## Victory Points
Use this scoring table at the end of the game.

### Escape points
- First player to escape: `50` points
- Any other escaped player: `25` points
- If multiple players escape on the same turn and no one escaped earlier, each of those players receives `50` points.

### Mission points
For each mission card:

- Complete the primary objective: gain the listed primary points
- Complete the secondary objective: gain the listed secondary points

The standard core mission values are:

- Primary objective: `10` points
- Secondary objective: `15` points

### Mission multipliers
Apply the following after totaling mission points:

- Emissary captain: `1.5x` mission VP
- Mission Specialist officer: `1.5x` mission VP

If both are present, apply the multiplier only once.
After applying mission multipliers, round down.

### Ship state points
Score ship points at the end of the game:

- Each functional section: `5` points
- Each fully powered section: `+5` points
- Each installed upgrade: `+5` points
- Each fully powered upgrade that requires power: `+5` points

### Crew points
- Each active basic crew: `5` points
- Each active officer: `10` points
- Active captain: `10` points

### Remaining ship resource points
Score `1` point each for:

- Each remaining hull point on the ship
- Each current shield point
- Each stored power point currently in ship sections or powered upgrades

### Wrecked ships
A wrecked ship gains no bonus merely for being wrecked.

### Tiebreakers
If two or more players tie on total victory points, break ties in this order:

- Highest mission points
- Most installed upgrades
- Most fully powered sections
- Most active crew
- Most stored power

If still tied, share the win.

## Components and Decks
A core game uses:

- `1` game board
- `1` ship console per player
- `1` ship token per player
- `1` captain card per player
- `2` officer cards per player
- `5` basic crew per player
- Mission deck
- Event deck
- Upgrade deck
- Resource supply
- Hull, power, conduit, corridor, and other status markers

## Board Structure
### Ring colors
- Rings `7-8`: Green
- Rings `5-6`: Yellow
- Rings `3-4`: Orange
- Rings `1-2`: Red

### Ring space counts
Use this board structure:

| Ring | Spaces | Color |
| --- | ---: | --- |
| 1 | 9 | Red |
| 2 | 9 | Red |
| 3 | 12 | Orange |
| 4 | 12 | Orange |
| 5 | 14 | Yellow |
| 6 | 14 | Yellow |
| 7 | 18 | Green |
| 8 | 18 | Green |

### Orbit velocity requirements
Use this current playtest velocity table:

| Ring | Minimum velocity to hold orbit |
| --- | ---: |
| 1 | 4 |
| 2 | 3 |
| 3 | 3 |
| 4 | 2 |
| 5 | 2 |
| 6 | 1 |
| 7 | 1 |
| 8 | 1 |

### Rotation direction
At setup, choose one rotation direction for the game:

- Clockwise
- Counter-clockwise

That direction does not change during the game.

### Ring rotation per turn
In the current rules, each ring rotates exactly `1` space per turn in the chosen direction.

### Cross-ring adjacency and board distance
Use these rules whenever movement, range, or adjacency crosses from one ring to another:

- Two spaces on the same ring are adjacent if they share a border, counting wraparound at the ends of the ring.
- A space on one ring is adjacent to the overlapping space or spaces on the next inner or outer ring.
- When mapping a space between rings with different space counts, use proportional overlap.
- If a deterministic single space must be chosen while moving inward or outward, choose the lower-index overlapping space.

### Board occupancy
- A setup, spawn, or placement effect may not place a ship or object into an occupied space.
- A maneuver or end-of-turn movement effect may move a ship into an occupied space.
- If a ship ends movement in an occupied space, resolve any resulting collision rules after movement is complete.

### Full orbit
A ship completes one full orbit when it returns to the same board-relative space on the same ring after traversing at least that ring's full circumference by any combination of maneuver and ring rotation.

## Ship Sections
### Bridge
- Max hull: `12`
- Full power required: `6`
- Fully powered benefit: `+1` acceleration on Maneuver
- Life support contribution when fully powered: `3`

### Engineering
- Max hull: `18`
- Full power required: `12`
- Power storage: `12`
- Fully powered benefit: `+2` power on Restore Power
- Life support contribution when fully powered: `4`

### Drives
- Max hull: `12`
- Full power required: `0`
- Power storage: `18`
- Purpose: stores and spends power for Maneuver

### Med-Lab
- Max hull: `6`
- Full power required: `6`
- Fully powered benefit: `+2` revive bonus
- Life support contribution when fully powered: `4`

### Sci-Lab
- Max hull: `6`
- Full power required: `6`
- Fully powered benefit: `+2` scan/acquire range
- Life support contribution when fully powered: `2`

### Defense
- Max hull: `6`
- Full power required: `6`
- Power storage: `12`
- Fully powered benefit: `+2` shields during auto-generate
- Life support contribution when fully powered: `1`

## Damage States
### Functional
A section is functional when it has:

- At least `1` hull
- At least `1` power

### Usable
A section is usable when it is both:

- Functional
- Not disabled

### Fully powered
A section is fully powered when it is functional and its total power equals or exceeds its section power requirement.

A section with a full power requirement of `0` is not fully powered unless it is also functional.

### Damaged
A section is damaged when its hull is reduced to `0`.

When a section becomes damaged:

- Any crew in that section becomes unconscious.
- A damaged section cannot be used.
- You cannot route power into a damaged section until its hull is restored.

### Disabled
A section is disabled when all conduits leading into it are gone or overloaded.

A disabled section:

- Cannot receive routed power
- Cannot be used
- Loses access to its current functionality until at least one conduit is restored and the section has power again

An intact but unpowered section is not disabled unless its conduit network is also gone or overloaded.

### Corridors
A corridor is either:

- Intact (`1`)
- Damaged (`0`)

Normal crew may not move through a damaged corridor.

### Conduits
Conduits carry routed power between sections.

If too much power passes through a conduit edge in one action, one conduit on that edge overloads.

## Starting Setup
### 1. Create the board
- Place the board.
- Choose rotation direction.
- Shuffle the mission, event, and upgrade decks.
- Place the resource supply nearby.

### 2. Build each player ship
Use the following current setup state.

#### Starting section state
| Section | Hull | Starting power | Starting notes |
| --- | ---: | --- | --- |
| Bridge | 6 | one die at 6 | corridor + conduit to Med-Lab, Sci-Lab, and Engineering intact |
| Engineering | 9 | two dice at 1 | corridor to Bridge intact; one conduit to Bridge intact |
| Drives | 0 | none | damaged at start |
| Med-Lab | 2 | none | unpowered at start |
| Sci-Lab | 0 | none | damaged at start |
| Defense | 0 | none | damaged at start |

#### Starting global ship state
- Velocity: `0`
- Shields: `0`
- Life support power: `6`

### 3. Ship connections at start
Use these starting intact routes:

- Bridge <-> Med-Lab: `1` corridor, `1` conduit
- Bridge <-> Sci-Lab: `1` corridor, `1` conduit
- Bridge <-> Engineering: `1` corridor, `1` conduit

All other corridors start damaged.

All other conduits start damaged.

### 4. Crew setup
Each player starts with:

- Captain active on the Bridge
- Two officers active
- Five basic crew unconscious

If a scenario does not specify officer locations, use this default:

- One officer on the Bridge
- One officer in Engineering

### 5. Captains and officers
- Give each player one captain.
- Give each player two officers.
- Apply any start-of-game captain effect immediately.

### 6. Missions
- Deal two mission cards to each player.
- Each player keeps one mission.
- Return or discard unused mission cards as needed.

### 7. Starting board positions
- Place all player ships evenly around the outermost ring.
- Ships must be equally spaced.
- No ship may start in an occupied space.

### 8. Starting board objects
Place the following objects during standard setup:

- Hazards: `2` on ring `4`
- Asteroid Clusters: `3` on ring `5`, and `2` on ring `7`
- Debris: `2` on ring `4`, and `2` on ring `6`
- Hostile Ships: a number equal to the number of players on ring `3`
- Wrecked Ships: a number equal to the number of players on ring `5`
- Functional Stations: none at standard setup unless added by scenario or event

When placing multiple objects on a ring:

- Spread them as evenly as possible.
- Do not place an object on the same space as a ship or another object.
- Avoid adjacent placement when possible.

## Turn Structure
All players plan and resolve their turns simultaneously.

### Turn order
Resolve each turn in this order:

1. Event Phase
2. Restore Power actions
3. Route/transfer power effects created by Restore Power
4. Revive actions
5. Repair actions
6. Maneuver actions
7. Scan actions
8. Acquire actions
9. Attack actions
10. Launch actions
11. Retaliate actions
12. Assemble actions
13. Integrate actions
14. Auto-generate step
15. Environment damage
16. Hazard damage
17. Orbit and object movement
18. Collision resolution
19. Hostile attacks and torpedoes
20. Escape / wreck / game-end checks

## Simultaneous Resolution and Conflict Rules
### General rule
Players choose actions simultaneously, but the game resolves action types in the listed phase order.

Within a single action type, treat actions as simultaneous unless they compete for a unique target, a unique reward, or a single board space outcome that cannot be shared.

### Conflict priority
When a same-phase conflict must be broken, resolve it in this order:

- Lowest player order first
- If the same player created the conflict with multiple actions, resolve them in the order that player declared them
- If a final deterministic tiebreaker is needed, use ascending crew id

### Shared objects and claimed rewards
- A board object may be scanned by multiple players in the same turn.
- A board object's resource or upgrade may be claimed only once.
- If an earlier same-phase action already removed or exhausted the target, a later conflicting action fizzles.
- A fizzled action has no effect. Any costs already paid for that action remain paid.

### Shared spaces
- Two player ships may end the same phase in the same board space.
- Sharing a board space does not by itself cause ship-to-ship collision or combat in the current core rules.
- If a ship shares a space with an object, resolve the collision rules for that ship after movement is complete.

### Escaping during a turn
A ship that escapes is removed from later active-ship checks for the rest of that turn and does not suffer later end-of-turn damage, collision, hostile, or orbit effects.

## Action Economy
### Standard rule
Each active crew member may perform `1` action per turn.

This includes the captain.

### Bonus-action rule
A crew member may perform a second action only if a rule explicitly allows it.

Current core sources of extra actions are:

- Cybernetics
- Temporal Shift

### Maneuver limit
A player may resolve at most `1` Maneuver action per turn.

## Movement Inside the Ship
- A crew member may move through intact corridors.
- Normal crew may not move through damaged corridors.
- Normal crew may not enter a damaged section.
- The Android may move through damaged corridors and may occupy damaged sections.

## Restore Power
This action replaces the older draft wording "Generate Power."

### Requirements
- The acting crew must be in a section that is allowed to generate power.
- Engineering is the standard power source.
- Certain crew may restore from other sections as listed in their abilities.

### Base output
A Restore Power action generates:

- Base: `1` power
- Engineering fully powered: `+2` power

### Crew bonuses
- Engineer: `+2` power
- Chief Engineer: `+3` power
- Android: `+2` power
- Captain: `+2` power
- First Officer: `+2` power

### Extra restore effects
- Tactician: `+1` shield when restoring in Defense
- Master Tactician: `+2` shields when restoring in Defense
- Imperialist captain: Defense auto-generate becomes `+3` shields instead of `+2`
- Coolant upgrade: `+1` power when restoring in Engineering

### Routing
You may route generated power during the same action.

Generated power may be routed to:

- Ship sections
- Installed upgrades
- Life support power

### Conduit overload rule
Each conduit edge safely carries up to `3` power per intact conduit during a single action.

If you exceed that limit across an edge:

- All routed power still arrives
- Exactly one conduit on that edge overloads
- Reduce conduit count on that edge by `1`
- That conduit loss remains until repaired
- A single action can overload at most one conduit on a given edge

If `Power Coils` is powered, ignore the first conduit overload you would suffer each turn.

### Life support routing
Life support power may be transferred to or from sections only if a rule or action specifically allows it.

## Repair
### Requirements
- The acting crew must be in the target section or an adjacent valid section, as required by the repair target.
- The acting section must be usable.
- Unless a rule says otherwise, repairing costs `1` power from the acting section.

### Standard repair output
One repair action restores one of the following:

- `1` hull
- `1` conduit
- `1` corridor

### Repair multipliers
- Engineer: `2x`
- Chief Engineer: `3x`
- Android: `3x`
- Captain: `2x`
- First Officer: `2x`

### Explorer repair kit
The Explorer begins the game with one repair kit that must be assigned to one damaged section after setup.

When used, that repair kit restores all of the following with a single repair action:

- `2` hull
- `1` conduit
- `1` corridor

Then the repair kit is spent.

### Droid Station
If the Med-Lab upgrade `Droid Station` is powered, one repair action each turn may be doubled again.

### Spare Parts
Spare Parts are valid repair resources and may be consumed when an effect instructs you to do so.

## Revive
### Requirements
- The acting crew must be in the Med-Lab.
- The Med-Lab must be functional.
- Revive costs `1` power from the Med-Lab.
- Choose one unconscious crew member or unconscious captain as the target.

### Base revive values
Revive uses fixed values, not random rolls.

- Medic: base `6`
- Doctor: base `6`
- First Officer: base `6`
- Captain: base `6`
- Any other crew: base `3`

### Revive bonuses
- Fully powered Med-Lab: `+2`
- Medic: `+1`
- Doctor: `+2`
- Captain: `+1`
- First Officer: `+1`
- Technologist: if a basic crew member already has a revive bonus, add `+1` more

### Thresholds
- Standard revive threshold: `12`
- Explorer revive threshold: `8`

### Nano-Bots
If `Nano-Bots` is powered, double total revive points from the action.

### Result
If the target reaches the threshold:

- The target becomes active
- Revive progress resets to `0`
- The target returns to the Bridge unless a scenario says otherwise

If the threshold is not reached:

- Keep the accumulated revive progress on that crew member

## Maneuver
### Requirements
- The acting crew must act from the Bridge.
- The Bridge must be usable.
- A player may resolve at most `1` Maneuver action per turn.
- Restore and Route effects resolve before Maneuver, so any power they place into Drives is available when Maneuver resolves.

### Cost
Spend the declared amount of power from Drives.

If Drives are short by exactly `1` power when Maneuver resolves, a Pilot-family crew may reroute `1` power from another powered section into Drives for that Maneuver.

Pilot-family crews are:

- Pilot
- Ace Pilot
- First Officer
- Captain

The reroute source must be a different section than Drives, must contain at least `1` power, and must have an intact conduit path to Drives.

If Drives still do not have enough power after all prior Restore/Route effects and any eligible Pilot-family reroute, the Maneuver action is lost. The action does not move the ship and does not spend the declared Drives cost.

### Acceleration
Base acceleration equals power spent.

Add the following bonuses:

- Fully powered Bridge: `+1`
- Pilot: `+1`
- Ace Pilot: `+2`
- Captain: `+1`
- First Officer: `+1`
- Inertia Control: `+1`
- Ion Engine: `+1`
- Technologist: if a basic crew member already has a maneuver bonus, add `+1` more

### Directions
A maneuver may move:

- Forward
- Backward
- Inward
- Outward

### Distance
A ship may move up to its total acceleration in spaces and/or ring steps, following legal board adjacency.

### Plasma Engine
If `Plasma Engine` is powered, gain `+1` power to Drives after a Maneuver action.

## Scan
### Requirements
- The acting section must be usable.
- Spend `1` power from the acting section.
- Choose a target object in range.

### Base range
Base scan range is `1`.

### Range bonuses
- Fully powered Sci-Lab: `+2`
- Fully powered Sci-Lab with Technologist captain: `+3`
- Scientist in Sci-Lab: `+1`
- Senior Scientist from Bridge or Sci-Lab: `+2`
- Captain in Sci-Lab: `+1`
- First Officer in Sci-Lab: `+1`
- Neutron Calibrator from Bridge: `+1`
- Technologist: if a basic crew member already has a scan-range bonus, add `+1` more

### Scan outcome
Scan has no separate roll or scan-value total in the current rules.

A successful Scan only does the following:

- Confirms that the target is in range
- Records the target as scanned for a later Acquire attempt
- Applies any scan-specific effect on the target or upgrade

If the scanned target is a Hostile Ship, mark that hostile as scanned. The next attack against that hostile gains `+2` damage.

### Tachyon Beam
If `Tachyon Beam` is powered, a scan from the Sci-Lab may remove one adjacent Hazard instead of performing a normal scan.

## Acquire
### Requirements
- The acting section must be usable.
- Choose a previously revealed target in range.
- Spend `1` power from the acting section unless a rule removes that cost.

### Range
Acquire uses the same range calculation as Scan.

### Discovery thresholds
Acquire resolves the scanned target's stored discovery against the current object thresholds.

- Hazard: no normal Acquire reward
- Asteroid Cluster: resource on `6+`
- Debris: resource on `4+`
- Wrecked Ship: resource on `2+`, upgrade on `5+`
- Functional Station: automatic resource, upgrade on `4+`
- Hostile Ship: no Acquire reward unless a scenario says otherwise

### Result
Acquire takes the revealed reward from the target object.

- Resources go into your inventory.
- Upgrades go into `pending` status until integrated.
- An object that has been fully acquired is removed from the board if appropriate to the acquisition result.
- Acquire cannot be attempted against an object that was not successfully scanned earlier.

### Merchant bonus
When the Merchant gains a resource through Acquire, also gain one additional random basic resource.

### Teleporter
If `Teleporter` is powered, Acquire costs `0` power.

## Attack
### Requirements
- The acting crew must attack from Defense.
- If `Tactical Bridge` is powered, the acting crew may instead attack from Bridge.
- The acting section must be usable.
- Spend `1` power from the acting section.
- The target must be attackable and in range.

### Current core attackable target types
In the current core rules, direct Attack targets hostile ships only.

Player-to-player combat is outside the current core rules unless a scenario explicitly adds it.

### Base attack damage
Base damage: `6`

### Damage bonuses
- Tactician: `+2`
- Master Tactician: `+4`
- First Officer: `+1`
- Captain: `+1`
- Fully powered attack section: `+2`
- Imperialist captain: `+1`
- Scanned hostile: `+2` on the next attack against that hostile
- Technologist: if a basic crew member already has an attack bonus, add `+1` more

### Destroying hostile ships
A hostile ship has `8` hull.

When reduced to `0` hull:

- It becomes Debris in the same space.

## Launch
### Requirements
- The acting crew must launch from the Bridge.
- The Bridge must be usable.
- Spend `1` power from the Bridge.
- The acting player must have the launched resource.

### Torpedo
- Costs `1` Torpedo resource
- Deals `6` damage to the target

### Probe
- Costs `1` Probe resource
- Reveals the target’s hidden loot without acquiring it

## Retaliate
If a rule grants a Retaliate attack, resolve it using the standard Attack rules unless the triggering effect says otherwise.

## Assemble
### Requirements
- The acting section must be usable.
- Spend `1` power from the acting section.
- Choose one item type:
  - Spare Parts
  - Medical Kit
  - Probe
  - Torpedo

### Threshold
Assembly uses progress.

- Threshold to craft one item: `6`

### Base fixed values
- Medical Kit with Medic, Doctor, First Officer, or Captain: base `6`
- Probe with Scientist, Senior Scientist, First Officer, or Captain: base `6`
- All other assembly actions: base `3`

### Assembly bonuses
- Medic on Medical Kit: `+1`
- Doctor on Medical Kit: `+2`
- Scientist on Probe: `+1`
- Senior Scientist on Probe: `+1`
- First Officer on Medical Kit or Probe: `+1`
- Captain on Medical Kit or Probe: `+1`
- Technologist: if a basic crew member already has an assembly bonus, add `+1` more

### Completion
If progress reaches the threshold:

- Craft `1` item
- If total points from that action are `8` or more, craft `1` additional item
- Reset progress for that item type to `0`

If progress does not reach the threshold:

- Store the progress on that crew member for that item type

## Integrate
### Requirements
- The acting crew must be active and in a usable section.
- Spend `1` power from the acting section.
- Choose one pending upgrade.
- The acting crew must be in the required section for that upgrade.

### Result
- Move the upgrade from pending to installed.
- An `any`-section upgrade is installed into the acting section.
- Newly installed upgrades start with `0` stored power unless a rule says otherwise.

## Upgrade Power
### Host section
Every installed upgrade has exactly one host section.

- A section-specific upgrade is installed into its printed section.
- An `any`-section upgrade is installed into the acting section that performed Integrate.

### Stored power
- Newly installed upgrades start with `0` stored power.
- An upgrade with a power requirement may store power up to its power requirement.
- Route power into an installed upgrade by tracing a valid conduit path to its host section.

### Powered upgrade
An upgrade is powered only if all of the following are true:

- Its host section is not damaged
- Its host section is fully powered
- Its host section still has at least one intact conduit connection
- The upgrade's stored power meets or exceeds its power requirement

If an installed upgrade has no power requirement, it is active while installed unless a rule says otherwise.

### Depowering
If a host section becomes damaged, unpowered, or disconnected, the upgrade becomes unpowered but keeps its stored power unless a rule says otherwise.

## Auto-Generate Step
At the end of action resolution, resolve auto-generate effects.

### Defense auto-generate
If Defense is fully powered:

- Gain `+2` shields
- Imperialist captain changes this to `+3`

### Upgrade auto-generate
If powered, these upgrades auto-generate as follows:

- Bio-Filters: `+3` life support power
- Bio-Engine: `+1` life support power
- Living Metal: restore up to `2` hull each turn in this priority order: Engineering, Drives, Bridge, Defense, Sci-Lab, Med-Lab
- Energy Hull: restore `1` hull per turn on its installed section

### Life support check
After all auto-generate effects:

- Count all active crew who require life support
- Count the captain if active
- Compare that total to life support capacity
- If capacity is exceeded, excess crew become unconscious
- Knock out basic crew first, then officers, then captain last

## Environment Damage
Environment damage is based on the color of the ring your ship occupies at the end of the turn.

### Green
- No environment damage

### Yellow
- `2` hull damage

### Orange
- `4` hull damage
- `1` conduit damage

### Red
- `8` hull damage
- `2` conduit damage
- `1` corridor damage

### High Density Plates
If `High Density Plates` is powered, halve hull damage from environment effects.

Round down.

## Hazards
Hazards are range-based threats, not collision-only threats.

### Hazard effect
A ship within range `2` of a Hazard suffers:

- `3` hull damage
- `2` life support power loss

Multiple hazards stack.

## Collisions and Object Damage
If your ship ends in the same space as an object, resolve collision damage.

Collision damage bypasses shields.

### Collision values
- Asteroid Cluster: `12` hull damage
- Debris: `6` hull damage
- Hostile Ship: `8` hull damage
- Wrecked Ship: `9` hull damage
- Functional Station: `12` hull damage

### Collision check damage
If a rule calls for a collision-check roll, use:

- `1-2`: `2` hull damage
- `3-4`: `4` hull damage
- `5-6`: `6` hull damage

## Damage Allocation
### Hull damage to ship sections
When a ship suffers hull damage, assign that damage to exactly one section unless the effect says otherwise.

- In tabletop play, the ship owner chooses the damaged section.
- If no player choice is available and a deterministic fallback is required, damage the section with the highest current hull.
- If there is a tie, use this priority order: Engineering, Bridge, Drives, Defense, Med-Lab, Sci-Lab.
- Hull damage does not split across multiple sections unless a rule explicitly says it does.
- Overflow damage beyond `0` hull is lost.

### Conduit and corridor damage
- For each point of conduit damage, choose one intact conduit and reduce it by `1`.
- For each point of corridor damage, choose one intact corridor and reduce it by `1`.
- If there is no legal intact target remaining for that damage type, ignore the excess damage.

## Orbit, Velocity, and Falling
### Velocity
Velocity is the ship's signed orbital stat.

- A forward Maneuver sets velocity to a positive value equal to the distance moved.
- A backward Maneuver sets velocity to a negative value equal to the distance moved.
- An inward or outward Maneuver keeps the ship's current velocity.

### End-of-turn orbit procedure
Resolve end-of-turn orbit in this order:

1. Rotate each ring `1` space in the chosen direction.
2. Move each object with its ring.
3. On every `4th` turn, move each object inward by `1` ring. If an object would move inside ring `1`, remove it from the game.
4. Move each active ship with its ring unless it is in geo-sync.
5. On every `4th` turn, check whether each active ship maintains orbit.

### Orbit stability
Compare `abs(velocity)` to the current ring's minimum velocity requirement.

- If `abs(velocity)` is less than the ring requirement, the ship falls inward by `1` ring.
- If `abs(velocity)` is equal to or greater than the ring requirement, the ship holds orbit.
- Falling does not add free velocity.

### Geo-sync rule
If a ship has negative velocity and `abs(velocity)` exactly equals the current ring requirement, the ship is in geo-sync orbit for that turn.

A geo-sync ship does not rotate with the ring and remains fixed relative to the board while the ring rotates under it.

Any other negative velocity still rotates with the ring normally.

### Radial movement
When a ship or object moves inward or outward between rings with different space counts, map it to the lower-index overlapping space on the destination ring.

## Object Infall and Events
### Event frequency
An event occurs every `4` turns.

### Infall spawn rule
On every event turn, add new objects equal to:

- `number of players + 3`

### Infall placement
- Start from the outermost ring and work inward only if needed.
- Never place a new object on an occupied space.
- Spread new objects around a ring when possible.
- Avoid adjacent placement when possible.

### Infall composition
- Add exactly `1` Hazard in the spawned set.
- For each remaining spawned object, use this weighted table:
  - `35%` Asteroid Cluster
  - `40%` Debris
  - `25%` Wrecked Ship

### Event deck
After infall placement, resolve the drawn event card.

## Object Movement
### General object movement
At the end of each turn:

- Each object rotates `1` space with its ring
- Every `4` turns, each object descends inward by `1` ring
- An object that would move inside ring `1` is removed from the game

## Hostile Ships
### Timing
Resolve Hostile Ships after orbit movement and collision resolution.

### Movement
A Hostile Ship first rotates and falls like any other object.

Then it checks the nearest active player ship.

- If the nearest active ship is on the same ring, the hostile moves `1` space along the shortest path toward that ship.
- If both same-ring paths are equally short, move clockwise.
- If the nearest active ship is on a different ring, the hostile makes no extra chase step.

### Current hostile profile
- Hull: `8`
- Torpedo: `1`
- Adjacent attack: `2d6 + 4`
- Torpedo damage: `6`
- Torpedo range: `2-3`

### Targeting
A hostile ship always targets the nearest active player ship.

### Attack behavior
- If adjacent, it attacks.
- If at range `2-3` and it still has a torpedo, it launches the torpedo.
- Each hostile may fire its torpedo only once.

### Cloaking Device interaction
If a target has a powered `Cloaking Device`, the first hostile attack against that ship each game is blocked and instead marks that hostile as having acquired target lock on that ship.

The next hostile attack from that same hostile against that same ship may land normally.

### Decoys interaction
If a target has powered `Decoys`, one incoming hostile torpedo each turn is negated.

### Shield Modulator interaction
If a target has powered `Shield Modulator`, shield loss from hostile weapon damage is halved.

## Escape
A ship escapes only after moving beyond the outermost ring.

### Escape state
- Reaching ring `8` is not enough by itself.
- A ship escapes when it moves beyond ring `8` and is no longer on the board.

## Wrecked Ships
A ship is wrecked if any of the following is true:

- It has fewer than `2` functional sections remaining
- It has no intact conduit network remaining
- It has no intact corridor network remaining
- It is pulled into ring `0` or lower

## Missions
For current authoritative play, use only the missions whose objective language is fully supported by this document.

| Mission | Primary Objective | Secondary Objective |
| --- | --- | --- |
| The Reinhardt | Reach ring `1` at least once | Be the only player who reached ring `1` during the game |
| Magellan | Complete `5` full orbits | Acquire `5` objects |
| Empire | Resolve `6` Attack actions against hostile ships | Destroy `2` hostile ships |
| Technology | Install `1` upgrade | Install `3` upgrades |

Do not use the following mission cards in current authoritative play until their dependent systems are fully specified:

- Distress Call
- Espionage
- Diplomatic
- Trader
- Sling Shot
- Saboteur

## Captains
### Merchant
Any time you perform Acquire to gain a resource, also gain one additional random basic resource.

Start of game: gain `2` random pending upgrades.

### Imperialist
Any crew member may perform Attack and gains `+1` damage.

Defense auto-generate becomes `+3` shields instead of `+2`.

Start of game: gain `3` random basic resources.

### Space Pirate
You may play an action for a basic crew member alongside an officer performing the same action in the same section, using the officer’s skills.

Start of game: choose `1` additional pending upgrade from `3` offered options.

### Technologist
Whenever a basic crew member would receive a role bonus on an action, that crew member gains `+1` more.

Sci-Lab fully powered range becomes `+3` instead of `+2`.

### Emissary
Mission victory points are multiplied by `1.5` at end of game.

### Explorer
Bridge provides `+5` life support power.

Revive threshold becomes `8` instead of `12`.

After setup, assign one special repair kit to one damaged section.

## Officers
### Ace Pilot
- `+2` acceleration on Maneuver

### Chief Engineer
- `3x` repairs
- `+3` restore power

### Doctor
- `+2` revive
- `+2` Medical Kit assembly

### Senior Scientist
- `+2` Scan/Acquire range from Bridge or Sci-Lab
- `+1` Probe assembly
- May restore power from Bridge or Sci-Lab if Engineering is functional

### Master Tactician
- `+4` attack damage
- `+2` shields when restoring in Defense
- May restore power from Defense if Engineering is functional

### Android
- Does not require life support
- May move through damaged areas
- `3x` repairs
- `+2` restore power

### Mission Specialist
- `1.5x` mission victory points at end of game

### First Officer
Counts as any basic role while in a legal section.

Also gains:

- `+1` maneuver acceleration
- `2x` repairs
- `+2` restore power
- `+1` revive
- `+1` scan/acquire range in Sci-Lab
- `+1` attack damage
- `+1` Medical Kit / Probe assembly

## Basic Crew
### Pilot
- `+1` acceleration on Maneuver

### Engineer
- `+2` restore power
- `2x` repairs

### Medic
- `+1` revive
- `+1` Medical Kit assembly

### Scientist
- `+1` scan/acquire range from Sci-Lab
- `+1` Probe assembly
- May restore power from Bridge or Sci-Lab if Engineering is functional and fully powered

### Tactician
- `+2` attack damage
- `+1` shield when restoring in Defense
- May restore power from Defense if Engineering is functional and fully powered

## Upgrades
### Med-Lab upgrades
- `Droid Station`: once per turn, double one repair action again
- `Bio-Filters`: `+3` life support power during auto-generate when powered
- `Cybernetics`: one crew member may take one extra action each turn
- `Nano-Bots`: double total revive points when powered

### Bridge upgrades
- `Tactical Bridge`: may Attack from Bridge
- `Inertia Control`: `+1` acceleration on Maneuver
- `Neutron Calibrator`: `+1` range from Bridge

### Sci-Lab upgrades
- `Cloaking Device`: the first hostile attack from each hostile ship is blocked and instead grants that hostile a target lock on you
- `Tachyon Beam`: remove one adjacent Hazard by scanning from Sci-Lab
- `Temporal Shift`: one crew member may take one extra action each turn
- `Teleporter`: Acquire costs `0` power

### Engineering upgrades
- `Repair Droids`: double Engineering-based repairs
- `Power Coils`: ignore the first conduit overload each turn
- `Coolant`: `+1` power on Restore Power in Engineering
- `Living Metal`: restore up to `2` hull each turn in this priority order: Engineering, Drives, Bridge, Defense, Sci-Lab, Med-Lab

### Defense upgrades
- `Decoys`: evade one hostile torpedo each turn
- `Shield Modulator`: halve shield loss from hostile weapon damage
- `A.I. Defense`: free scan of attack target when attacking

### Drives upgrades
- `Plasma Engine`: gain `+1` power on Maneuver
- `Bio-Engine`: `+1` life support power during auto-generate when powered
- `Ion Engine`: `+1` acceleration on Maneuver

### Any-section upgrades
- `High Density Plates`: halve hull damage from environment
- `Energy Hull`: installed section restores `1` hull each turn

## Optional Modes
### Fast Play Start
Use standard setup, then apply all of the following:

- Add `6` hull anywhere on your ship
- Set shields to `6`
- Med-Lab starts fully powered

### Long Play Start
Use standard setup, then apply all of the following:

- Med-Lab starts damaged
- Remove one officer of your choice from the game

### Cooperative
Players win together only if all mission goals are completed and all ships escape.

### Alliances
If teams are used, agree on team structure before setup. Team members may coordinate under the alliance rules used for that playtest.

## Current Design Decisions Resolved From Prior Draft Conflicts
These decisions are explicit so future edits have one source to follow.

- The initial draft file is historical only; this document is current authority.
- Standard player count is `2-6`.
- Standard starting ship velocity is `0`.
- Standard starting Med-Lab hull is `2`.
- Hazard damage is `3` hull plus `-2` life support power within range `2`.
- Environment damage is `2 / 4 / 8` hull by Yellow / Orange / Red, with conduit and corridor penalties in Orange and Red.
- Event infall occurs every `4` turns using the current `player count + 3` spawn model.
- Current action economy is `1` action per active crew member unless a rule explicitly grants an extra action.
- Scan has no separate roll in the current rules; object thresholds are applied during Acquire.
- Player-to-player combat is outside the current core rules.
- Only missions explicitly listed in the Missions section are in the current authoritative mission pool.

## Implementation Alignment Notes
This rules document is the target source of truth. The engine and UI must be aligned to it.

When a future discrepancy is found:

- Fix the discrepancy in code if this document is correct
- Or update this document first if the design changed intentionally
Do not leave a known difference undocumented.
