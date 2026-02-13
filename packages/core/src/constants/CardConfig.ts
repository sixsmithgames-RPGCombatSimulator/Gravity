export const CORE_EVENT_CARDS = [
  {
    id: 'event_distress_call',
    name: 'Distress Call',
    description:
      'Place a new intact space station randomly on the board. The first player to scan this station immediately draws an upgrade card.',
    effects: {
      kind: 'distress_call',
    },
  },
  {
    id: 'event_hazards',
    name: 'Hazards',
    description: 'Add d3 new hazards randomly on the board.',
    effects: {
      kind: 'hazards_add_d3',
    },
  },
  {
    id: 'event_gravity_flux_objects_forward',
    name: 'Gravity Flux',
    description:
      'The gravity has fluctuated. Move all objects forward 1 space and then resolve any collisions.',
    effects: {
      kind: 'gravity_flux_objects_forward',
    },
  },
  {
    id: 'event_gravity_flux_objects_backward',
    name: 'Gravity Flux',
    description:
      'The gravity has fluctuated. Move all objects backward 1 space and then resolve any collisions.',
    effects: {
      kind: 'gravity_flux_objects_backward',
    },
  },
  {
    id: 'event_gravity_flux_players_forward',
    name: 'Gravity Flux',
    description:
      'The gravity has fluctuated. Move all player ships forward 1 space and then resolve any collisions.',
    effects: {
      kind: 'gravity_flux_players_forward',
    },
  },
  {
    id: 'event_gravity_flux_players_backward',
    name: 'Gravity Flux',
    description:
      'The gravity has fluctuated. Move all player ships backward 1 space and then resolve any collisions.',
    effects: {
      kind: 'gravity_flux_players_backward',
    },
  },
] as const;

export const CORE_MISSION_CARDS = [
  {
    id: 'distress_call',
    name: 'Distress Call',
    description:
      "You are receiving a distress call. The signal is faint but still there, and now it is clear why. It's up to you to find and rescue anyone along with yourself.",
    objectives: {
      primary: {
        description: 'Tractor 3 Debris fields',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Find Life Pod',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'the_reinhardt',
    name: 'The Reinhardt',
    description:
      "Crazy! That's what they called you. They simply cannot recognize genius. Your mission is to successfully navigate closer to the black hole than anyone else.. Ever.",
    objectives: {
      primary: {
        description: 'Get to inner most ring',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Be the only one',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'espionage',
    name: 'Espionage',
    description:
      'You must gather information on the other ships capabilities. Since information is the way to gain real power. Gain as much as you can.',
    objectives: {
      primary: {
        description: 'Scan 2 ships',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Scan 4 ships',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'diplomatic',
    name: 'Diplomatic',
    description:
      'Fighting is for fools. Your pacifism will be rewarded if you can talk everyone out of fighting – no matter the cost.',
    objectives: {
      primary: {
        description: 'No ships wrecked from combat',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'No player to player combat',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'trader',
    name: 'Trader',
    description:
      'Where there is a problem, there is a profit to be made. When people are desperate there is all to be gained.',
    objectives: {
      primary: {
        description: 'Trade with 2 ships',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Trade with 4 ships',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'magellan',
    name: 'Magellan',
    description:
      "Exploring for explorations sake. This isn't a catastrophe. It's a great opportunity! Navigate the circumference and gather as much data as you can.",
    objectives: {
      primary: {
        description: 'Make 5 full orbits',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Acquire 5 objects',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'empire',
    name: 'Empire',
    description:
      'Other ships? You mean targets. Teach these other captains exactly why they should fear and respect your might. Show them the power of the empire!',
    objectives: {
      primary: {
        description: 'Attack 6 times',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Wreck 2 ships',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'technology',
    name: 'Technology',
    description:
      'The potential advances in technology available here are vast and too good to pass up.',
    objectives: {
      primary: {
        description: 'Install 1 upgrade',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Install 3 upgrades',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'sling_shot',
    name: 'Sling Shot',
    description:
      'Sometimes the only way out is thru. A sling shot is done by taking your ship from the outer most ring to the inner most and back again in 4 turns or less. Do it for the whales.',
    objectives: {
      primary: {
        description: 'Use all your speed once',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Perform escape without collision',
        points: 15,
        completed: false,
      },
    },
  },
  {
    id: 'saboteur',
    name: 'Saboteur',
    description:
      'There is at least one among your crew. They are the ones that got you into this mess. Find out who and blow them out the nearest airlock!',
    objectives: {
      primary: {
        description: 'Eliminate 1 crew',
        points: 10,
        completed: false,
      },
      secondary: {
        description: 'Eliminate 3 crew',
        points: 15,
        completed: false,
      },
    },
  },
] as const;

export const CORE_ACTION_CARDS = [
  {
    id: 'generate_assemble',
    name: 'GENERATE / ASSEMBLE',
    description:
      'Use power to generate or convert power to shields, or assemble Spare-Parts for later use.',
    actionType: 'generate_assemble',
    section: 'engineering',
    effects: {
      rulesText:
        'Generate 1 Power or convert Power to Shields 1:1. You may route power between sections, but more than 3 power per conduit will overload the conduit. Or assemble Spare-Parts: add 1 token to the Spare-Parts pool; 6 tokens = 1 Spare-Part.',
    },
  },
  {
    id: 'repair',
    name: 'REPAIR',
    description:
      'Use power and spare parts to repair hull, conduits, and corridors on your ship.',
    actionType: 'repair',
    section: 'engineering',
    effects: {
      rulesText:
        'Spend Power to repair damages: hull restores section ability; a corridor restores an adjacent area; damaged sections become functional when hull is restored to 1. May use Spare-Parts pool to increase repair effect.',
    },
  },
  {
    id: 'revive_assemble',
    name: 'REVIVE / ASSEMBLE',
    description:
      'Use power to revive crew from the dossier, or assemble Med-Kits for future revives.',
    actionType: 'revive_assemble',
    section: 'med_lab',
    effects: {
      rulesText:
        'Use 2 Power to revive a crew member by spending Med-Lab revive tokens; or assemble Med-Kits by adding tokens to the Med-Kit pool and converting 6 tokens into 1 Med-Kit.',
    },
  },
  {
    id: 'scan_assemble',
    name: 'SCAN / ASSEMBLE',
    description:
      'Use power from the Sci-Lab to scan objects or assemble probes from spare parts.',
    actionType: 'scan_assemble',
    section: 'sci_lab',
    effects: {
      rulesText:
        'Use Power to Scan enemies, asteroids, debris, wrecks, and stations for resources, or spend 1 Power and 1 Spare-Part to add tokens to the Probe pool (2 tokens = 1 Probe).',
    },
  },
  {
    id: 'attack_assemble',
    name: 'ATTACK / ASSEMBLE',
    description:
      'Use power from Defenses to attack objects or assemble torpedoes from spare parts.',
    actionType: 'attack_assemble',
    section: 'defense',
    effects: {
      rulesText:
        'Use Power to attack and destroy objects with damage values based on target type, or spend 1 Power and 1 Spare-Part to add tokens to the Torp pool (2 tokens = 1 Torp).',
    },
  },
  {
    id: 'acquire_integrate',
    name: 'ACQUIRE / INTEGRATE',
    description:
      'Use power to acquire objects along a path or integrate upgrades into ship sections.',
    actionType: 'acquire_integrate',
    section: 'sci_lab',
    effects: {
      rulesText:
        'Use 1 Power per space to acquire objects or upgrades between your ship and the target, bringing them onboard face down. Use additional Power to integrate an upgrade into a section and supply it with the required power.',
    },
  },
  {
    id: 'maneuver',
    name: 'MANEUVER',
    description:
      'Use power from the Bridge and Drives to change speed, move inward or outward, or reverse orbit direction.',
    actionType: 'maneuver',
    section: 'bridge',
    effects: {
      rulesText:
        'Spend Power on Maneuver: each acceleration step changes speed and may move the ship inward or outward. Use acceleration in the opposite direction to reverse orbit direction while maintaining speed.',
    },
  },
  {
    id: 'launch',
    name: 'LAUNCH',
    description:
      'Use power from the Bridge to launch probes or torpedoes away from your ship to interact with distant objects.',
    actionType: 'launch',
    section: 'bridge',
    effects: {
      rulesText:
        'Launch Probes or Torps a number of spaces away from your ship, then move them and resolve interactions with objects or enemies according to probe/torpedo rules.',
    },
  },
] as const;

export const CORE_UPGRADE_CARDS = [
  {
    id: 'droid_station',
    name: 'Droid Station',
    description:
      'Repurposing part of the Med Lab for droid repairs has your medic a little flustered. But he will get used to it in time.',
    powerRequired: 6,
    section: 'med_lab',
    effects: {
      rulesText: 'Med-Lab 2X on Repair all sections',
    },
  },
  {
    id: 'bio_filters',
    name: 'Bio-Filters',
    description:
      'These efficient devices make it much easier to keep the life support system functioning.',
    powerRequired: 6,
    section: 'med_lab',
    effects: {
      rulesText: 'Med-Lab 3 Life Support',
    },
  },
  {
    id: 'cybernetics',
    name: 'Cybernetics',
    description:
      'The black market tech seems to be finding its way into the organic systems of the ship.',
    powerRequired: 6,
    section: 'med_lab',
    effects: {
      rulesText: 'Med-Lab +1 Action for one crew',
    },
  },
  {
    id: 'tactical_bridge',
    name: 'Tactical Bridge',
    description:
      'With these extra components the bridge can be modified to function independent of defenses with similar capabilities.',
    powerRequired: 0,
    section: 'bridge',
    effects: {
      rulesText: 'Bridge: You may Attack from the Bridge (including while charging)',
    },
  },
  {
    id: 'inertia_control',
    name: 'Inertia Control',
    description:
      'This ship was never meant to navigate this environment. Using what you found to improve the inertial controls will help.',
    powerRequired: 6,
    section: 'bridge',
    effects: {
      rulesText: 'Bridge: +1 Acceleration on Maneuver',
    },
  },
  {
    id: 'neutron_calibrator',
    name: 'Neutron Calibrator',
    description:
      'Accurate sensor readings can actually save your life one day. Keeping them finely tuned will help you avoid collisions.',
    powerRequired: 6,
    section: 'bridge',
    effects: {
      rulesText: 'Bridge: +1 on Range',
    },
  },
  {
    id: 'cloaking_device',
    name: 'Cloaking Device',
    description:
      'A very expensive black market item, but unusual circumstances justify its use. Enemies may target your sections but must scan to attack you.',
    powerRequired: 6,
    section: 'sci_lab',
    effects: {
      rulesText: 'Sci-Lab: Enemies must Scan to attack you but gain nothing',
    },
  },
  {
    id: 'tachyon_beam',
    name: 'Tachyon Beam',
    description:
      'A strange transmitter with an unstable alien technology, but the scientists have figured out how to use it to stabilize spatial rifts.',
    powerRequired: 6,
    section: 'sci_lab',
    effects: {
      rulesText: 'Sci-Lab: Remove 1 adjacent hazard',
    },
  },
  {
    id: 'high_density_plates',
    name: 'High Density Plates',
    description:
      'Welding on some additional protection to your hull sounds like a great idea right about now.',
    powerRequired: 6,
    section: 'any',
    effects: {
      rulesText: 'Any: Half Hull damage from environment',
    },
  },
  {
    id: 'temporal_shift',
    name: 'Temporal Shift',
    description:
      'The full power is not accessible, maybe if we had a century to study this object. But for now it can be directed to shift time in a small area.',
    powerRequired: 6,
    section: 'sci_lab',
    effects: {
      rulesText: 'Sci-Lab: +1 Action for one crew',
    },
  },
  {
    id: 'repair_droids',
    name: 'Repair Droids',
    description:
      'Handy, although not entirely reliable, droids specially equipped to make fast repairs.',
    powerRequired: 6,
    section: 'engineering',
    effects: {
      rulesText: 'Engineering: 2X on Repair all sections',
    },
  },
  {
    id: 'decoys',
    name: 'Decoys',
    description:
      'A combination of signal emitters, and hull scrapes, and a temporary chemical reaction makes an effective torpedo decoy.',
    powerRequired: 6,
    section: 'defense',
    effects: {
      rulesText: 'Defense: Evade 1 Torpedo per turn',
    },
  },
  {
    id: 'power_coils',
    name: 'Power Coils',
    description:
      'Normally there would be nothing more than spare parts but now the parts are tuned well beyond spec for your ship.',
    powerRequired: 6,
    section: 'engineering',
    effects: {
      rulesText: 'Engineering: 1 Conduit overload per turn',
    },
  },
  {
    id: 'coolant',
    name: 'Coolant',
    description:
      'Installing this cooling unit will go a long way toward restoring your power cores capability.',
    powerRequired: 6,
    section: 'engineering',
    effects: {
      rulesText: 'Engineering: +1 Power on Generate',
    },
  },
  {
    id: 'nano_bots',
    name: 'Nano-Bots',
    description:
      'This alien technology seems to be aggressive, but it appears capable of rapid organic tissue repair. Put them in the Med-Lab right away.',
    powerRequired: 4,
    section: 'med_lab',
    effects: {
      rulesText: 'Med-Lab: 2X Revive all sections',
    },
  },
  {
    id: 'energy_hull',
    name: 'Energy Hull',
    description:
      'Based on force field technology this will reinforce your hull energetically until it can be repaired.',
    powerRequired: 6,
    section: 'any',
    effects: {
      rulesText: 'Any: This section only: Add 1 Hull per turn',
    },
  },
  {
    id: 'plasma_engine',
    name: 'Plasma Engine',
    description:
      'Installing this plasma converter to your engine will recoup a little power from your maneuvering.',
    powerRequired: 6,
    section: 'drives',
    effects: {
      rulesText: 'Drive: Gain 1 Power on Maneuver',
    },
  },
  {
    id: 'bio_engine',
    name: 'Bio-Engine',
    description:
      "This new alien hybrid engine has been nicknamed 'bio-engine'. While you haven't figured out how it works, it will help with life support.",
    powerRequired: 6,
    section: 'drives',
    effects: {
      rulesText: 'Drive: +1 Life Support each turn',
    },
  },
  {
    id: 'living_metal',
    name: 'Living Metal',
    description:
      "Similar to nano bots this has been nicknamed 'living metal' and can be observed to mend itself back together.",
    powerRequired: 6,
    section: 'engineering',
    effects: {
      rulesText: 'Engineering: Add 2 Hull per turn anywhere',
    },
  },
  {
    id: 'ion_engine',
    name: 'Ion Engine',
    description:
      'This little marvel is adaptable to your engines and will provide a nice acceleration boost.',
    powerRequired: 6,
    section: 'drives',
    effects: {
      rulesText: 'Drive: +1 Acceleration on Maneuver',
    },
  },
  {
    id: 'teleporter',
    name: 'Teleporter',
    description:
      'A technological trophy from any ship. The teleporter can be powered from your Sci-Lab to bring resources aboard.',
    powerRequired: 6,
    section: 'sci_lab',
    effects: {
      rulesText: 'Sci-Lab: No Power cost for Acquire',
    },
  },
  {
    id: 'shield_modulator',
    name: 'Shield Modulator',
    description:
      'The scientists and engineers are still trying to explain exactly how this works. But it will be obvious the next time you get shot at.',
    powerRequired: 6,
    section: 'defense',
    effects: {
      rulesText: 'Defenses: Half Shield damage',
    },
  },
  {
    id: 'ai_defense',
    name: 'A.I. Defense',
    description:
      'Advanced military Artificial Intelligence can come in handy. This improves your targeting speed and accuracy.',
    powerRequired: 6,
    section: 'defense',
    effects: {
      rulesText: 'Defenses: Free Scan of target on Attack',
    },
  },
] as const;

export const CORE_CAPTAIN_CARDS = [
  {
    id: 'captain_merchant',
    name: 'Merchant',
    description:
      'With a superior intuition garnered from many years of space trading the Merchant captain has an easier time of finding the resources needed.',
    captainType: 'merchant',
    effects: {
      rulesText:
        'Any time you perform the Acquire action to gain a resource you will also gain a random basic resource. Your ship starts with 2 random upgrades.',
    },
  },
  {
    id: 'captain_imperialist',
    name: 'Imperialist',
    description:
      'With great discipline comes greater firepower. The long list of battles the Imperialist captain has fought helps when trying to find the weak spots.',
    captainType: 'imperialist',
    effects: {
      rulesText:
        'Any of your crew can perform the Attack action and gain +1 to the damage. Your Defense improves to +3 shield generation instead of the normal +2 when powered. Your ship starts with 3 random resources.',
    },
  },
  {
    id: 'captain_space_pirate',
    name: 'Space Pirate',
    description:
      'With cunning and guile learned from fighting the best pirates in the universe the Space Pirate captain can easily utilize any circumstance to their advantage.',
    captainType: 'space_pirate',
    effects: {
      rulesText:
        'Additionally you may play an Action card for a basic crewmember to perform along with an officer performing the same Action in the same Section, using the officer’s skills. Your ship starts with one additional upgrade of your choice before other players receive upgrades.',
    },
  },
  {
    id: 'captain_technologist',
    name: 'Technologist',
    description:
      'With plenty of funding and the cutting edge tech from thousands of planets the Technologist captain runs an advanced ship and an educated crew.',
    captainType: 'technologist',
    effects: {
      rulesText:
        'Your ship runs on prototype systems: whenever a basic crewmember would receive a role bonus on an Action, they gain +1 more. Your Science Lab gains +3 range instead of +2 when fully powered.',
    },
  },
  {
    id: 'captain_emissary',
    name: 'Emissary',
    description:
      'With a zeal rarely matched by even the most fanatical faithful followers, the Emissary captain’s crew are so convinced of their abilities they sometimes manifest in extraordinary feats when the captain inspires them.',
    captainType: 'emissary',
    effects: {
      rulesText:
        'Completing your mission will win the recognition you know you deserve – you score 1.5× mission VP at the end of the game.',
    },
  },
  {
    id: 'captain_explorer',
    name: 'Explorer',
    description:
      'With insatiable wanderlust and inexhaustible courage backed by competence, quick thinking, and a bit of luck the Explorer captain has a tough ship and a tougher crew.',
    captainType: 'explorer',
    effects: {
      rulesText:
        'The bridge provides 5 life support in addition to any powered sections. Your crew are easier to revive and get back to their stations requiring only 8 revive tokens. After the start of the game, select one of your damaged systems and place a repair kit there; using that repair kit will restore 2 hull points, 1 power conduit, and 1 corridor with a single repair action.',
    },
  },
] as const;

export const CORE_OFFICER_CARDS = [
  {
    id: 'officer_ace_pilot',
    name: 'Ace Pilot',
    description:
      'Expert pilot with unparalleled maneuvering skills and torpedo evasion.',
    role: 'ace_pilot',
    effects: {
      rulesText:
        'Expert Maneuvers: +2 acceleration on Maneuver.',
    },
  },
  {
    id: 'officer_chief_engineer',
    name: 'Chief Engineer',
    description:
      'Ingenious engineer who can coordinate repairs across the ship.',
    role: 'chief_engineer',
    effects: {
      rulesText:
        'Miracle Repairs: 3× the Repairs done for the cost of 1.\n' +
        'Power Surge: +3 on Restore Power.\n' +
        'Portable Power: Repair does not consume power.\n' +
        'Restore & Patch: When restoring, you may also Repair 1 hull/conduit/corridor on an adjacent section.',
    },
  },
  {
    id: 'officer_doctor',
    name: 'Doctor',
    description:
      'Medical specialist capable of pushing crew beyond normal limits.',
    role: 'doctor',
    effects: {
      rulesText:
        'Medicine: +2 on Reviving. +2 on assembling Med-Kit.',
    },
  },
  {
    id: 'officer_senior_scientist',
    name: 'Senior Scientist',
    description:
      'Lead scientist who radically improves sensor and upgrade efficiency.',
    role: 'senior_scientist',
    effects: {
      rulesText:
        'Intelligent: +2 range on Scan / Acquire (from Bridge or Sci-Lab).\n' +
        'Calibration: +1 on assembling Probe.\n' +
        'Restoration Protocols: may Restore Power from Bridge or Sci-Lab if Engineering is functional.',
    },
  },
  {
    id: 'officer_master_tactician',
    name: 'Master Tactician',
    description:
      'Veteran strategist specializing in weapons and shield coordination.',
    role: 'master_tactician',
    effects: {
      rulesText:
        'Strategy: +4 damage when attacking.\n' +
        'Shield Discipline: +2 shields when restoring in Defense.\n' +
        'May Restore Power from Defense if Engineering is functional.',
    },
  },
  {
    id: 'officer_android',
    name: 'Android',
    description:
      'Robotic officer not limited by life support or damaged corridors.',
    role: 'android',
    effects: {
      rulesText:
        'Robotic: can move through and occupy damaged areas and does not require life support.\n' +
        'Robust Repairs: 3× the Repairs done for the cost of 1.\n' +
        'Power Surge: +3 on Restore Power.',
    },
  },
  {
    id: 'officer_mission_specialist',
    name: 'Mission Specialist',
    description:
      'Officer dedicated to maximizing mission-related assembly and scoring.',
    role: 'mission_specialist',
    effects: {
      rulesText:
        '1.5× Mission Victory points at the end of the game.',
    },
  },
  {
    id: 'officer_first_officer',
    name: 'First Officer',
    description:
      'Highly competent second-in-command able to stand in for any basic crew.',
    role: 'first_officer',
    effects: {
      rulesText:
        'Competence: stands in for any basic role (as long as they are in the correct section).\n' +
        'Maneuver: +2 acceleration.\n' +
        'Repair: 2× repairs.\n' +
        'Restore: +3 power; +2 shields when restoring in Defense.\n' +
        'Scan/Acquire: +2 range when scanning from the Sci-Lab.\n' +
        'Revive: +2.\n' +
        'Attack: +3 damage.\n' +
        'Assemble: +2 on Med-Kit / Probe.',
    },
  },
] as const;
