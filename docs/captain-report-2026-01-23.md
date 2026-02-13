# Captain Ability Implementation Report — 2026-01-23

## Legend
- **Card Benefit**: Rules text copied from `CardConfig`.
- **Mechanical Effect**: Summary of where the rule is realized in code.
- **Status**: ✅ implemented, ⚠️ partial / needs work, ❌ missing.
- **Coverage Notes**: Tests or TODOs worth tracking.

---

### Merchant
- **Card Benefit**: “Any time you perform the Acquire action to gain a resource you will also gain a random basic resource. Your ship starts with 2 random upgrades.” @packages/core/src/constants/CardConfig.ts#595-606
- **Mechanical Effect(s)**:
  1. Successful Acquire actions add one deterministic bonus basic resource via `pickDeterministicBasicResource`. @packages/core/src/engine/index.ts#5704-5755
  2. Start-of-game routine adds two pending upgrades to the player before the first turn resolves. @packages/core/src/engine/index.ts#1004-1023
- **Status**: ✅
- **Coverage Notes**: `captainAbilities.test.ts` asserts both the delayed upgrade draw and the Acquire bonus. @packages/core/src/engine/captainAbilities.test.ts#143-289

### Imperialist
- **Card Benefit**: “Any of your crew can perform the Attack action and gain +1 damage. Defense auto-generates +3 shields when powered. Ship starts with 3 random resources.” @packages/core/src/constants/CardConfig.ts#607-617
- **Mechanical Effect(s)**:
  1. Start-of-game hook grants three deterministic starting resources. @packages/core/src/engine/index.ts#948-1028
  2. Auto-generate step raises shield output to +3 when Defense is fully powered. @packages/core/src/engine/index.ts#8405-8417
  3. Attack resolver always applies +1 damage bonus while this captain is active. @packages/core/src/engine/index.ts#5938-5947
- **Status**: ✅
- **Coverage Notes**: Shield boost behavior is regression-tested in `captainAbilities.test.ts`. @packages/core/src/engine/captainAbilities.test.ts#464-527

### Space Pirate
- **Card Benefit**: “May play an Action card for a basic crewmember alongside an officer using the officer’s skills in the same section. Ship starts with one additional upgrade of your choice before other players receive upgrades.” @packages/core/src/constants/CardConfig.ts#618-627
- **Mechanical Effect(s)**:
  1. Start-of-game effect deals three upgrade options into `spacePirateStartingUpgradeOptions`, and the chosen upgrade is moved into pending upgrades. @packages/core/src/engine/index.ts#999-1040 @packages/core/src/engine/index.ts#1429-1475
- **Status**: ⚠️ (partial)
- **Coverage Notes**: Extra starting-upgrade flow is complete, but the simultaneous action-card / officer cross-training ability has not been implemented anywhere in the engine or UI yet.

### Technologist
- **Card Benefit**: “Prototype systems grant basic crew +1 on any action where they already receive a role bonus; Sci-Lab reaches +3 range when fully powered.” @packages/core/src/constants/CardConfig.ts#629-639
- **Mechanical Effect(s)**:
  1. Scan/Aquire range calculations swap the Sci-Lab bonus to +3 and layer +1 on any basic-crew range bonus. @packages/core/src/engine/index.ts#5325-5337 @packages/core/src/engine/index.ts#5637-5647
  2. All crew bonus helpers (revive, repair, restore, shields, maneuver, attack, assemble) add an extra +1 when the acting crew is basic and already receives a positive modifier. @packages/core/src/engine/index.ts#2170-2193 @packages/core/src/engine/index.ts#2588-2640 @packages/core/src/engine/index.ts#3134-3153 @packages/core/src/engine/index.ts#4924-4930 @packages/core/src/engine/index.ts#5938-5944 @packages/core/src/engine/index.ts#6516-6521
- **Status**: ✅
- **Coverage Notes**: Attack and scan bonuses have explicit regression tests. @packages/core/src/engine/captainAbilities.test.ts#291-779

### Emissary
- **Card Benefit**: “Score 1.5× mission VP at the end of the game.” @packages/core/src/constants/CardConfig.ts#640-649
- **Mechanical Effect(s)**:
  1. Victory point calculator applies a 1.5× multiplier whenever the captain type is `emissary`. @packages/core/src/engine/index.ts#6959-7004
- **Status**: ✅
- **Coverage Notes**: Mission scoring multiplier is parity-tested against the Mission Specialist officer bonus. @packages/core/src/engine/captainAbilities.test.ts#591-679

### Explorer
- **Card Benefit**: “Bridge provides +5 life support. Crew revives need only 8 tokens. After the game starts, place a repair kit on a damaged section; one repair action there restores 2 hull, 1 conduit, 1 corridor.” @packages/core/src/constants/CardConfig.ts#651-661
- **Mechanical Effect(s)**:
  1. Start-of-game state seeds a reusable `explorerRepairKit` object that must be assigned to a damaged section. @packages/core/src/engine/index.ts#1004-1011 @packages/core/src/engine/index.ts#1049-1129
  2. Life-support calculations always add +5 capacity for Explorer captains. @packages/core/src/engine/index.ts#8388-8451
  3. Revive actions drop their threshold from 10 to 8 revive points, and the special repair kit replaces one repair action with the multi-resource restore. @packages/core/src/engine/index.ts#2170-2199 @packages/core/src/engine/index.ts#2483-2657
- **Status**: ✅
- **Coverage Notes**: Tests cover repair-kit availability and life-support effects. @packages/core/src/engine/captainAbilities.test.ts#191-590
