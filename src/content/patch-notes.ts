/** Player-facing history of features included in this build, newest first.
 * Keep unreleased plans, operational details, and player data out of these entries.
 * Add an entry in the same reviewed PR as each player-visible change.
 */
export interface PatchNote {
  id: string;
  title: string;
  summary: string;
  changes: readonly string[];
  compatibility: string;
}

export const PATCH_NOTES: readonly PatchNote[] = [
  {
    id: 'workshop-journal',
    title: 'News from the workshop',
    summary: 'Read recent changes without leaving your expedition.',
    changes: [
      'Open What’s new from expedition setup, the main menu, or Settings. Expand earlier updates for gameplay details and save compatibility.',
      'Move, resize, dock, or minimize the journal like other information windows. Combat continues while you read; pending game decisions still wait for you.',
    ],
    compatibility:
      'No changes to combat, save format, progression, or rewards. Notes are bundled with this build and require no account.',
  },
  {
    id: 'tower-evolution',
    title: 'The spire awakens',
    summary: 'Seven towers. Fourteen evolution paths. One path to shape each expedition.',
    changes: [
      'Choose between two paths for your tower, with three cumulative evolution tiers. Preview every tier before committing to a path.',
      'Evolve for free after waves 25, 50, and 75 in Normal and Endless, or 12, 25, and 37 in Quick. Upgrade and shop choices resolve first.',
      'Your starting core, signature skill, and tower machinery develop together. Compatible fusions retain the starting core’s evolution; replacing it makes core-specific benefits dormant.',
      'Evolution decisions wait for you. Close or minimize the window and return through the highlighted Evolution control.',
    ],
    compatibility:
      'Evolution applies to newly started expeditions. Older active runs keep their original rules until settlement. Progress, credits, and unlocks are preserved.',
  },
  {
    id: 'arsenal-combinations',
    title: 'New engines of destruction',
    summary:
      'Eight alternative fusions and twelve support card families expand offensive, defensive, and mixed builds.',
    changes: [
      'Experiment with burning gravitational vortices, electrical pulses, reflection-powered lances, repair-linked drones, frost ricochets, and more.',
      'New support cards reward growing projectiles, returning shots, absorption, effective healing, reflected critical hits, lingering thorns, and coordinated attacks.',
      'Fusion remains free and requires mastery six on both ingredients. A fused core cannot fuse again; inspect the preview for inheritance and effect limits.',
    ],
    compatibility:
      'New arsenal content applies to new expeditions. Existing runs retain their saved content rules and investments.',
  },
  {
    id: 'endless-comfort',
    title: 'A calmer battle',
    summary: 'Less interruption during demanding Endless battles.',
    changes: [
      'Catch-up status uses a quiet notice instead of an interrupting window, with a delay and minimum display time to prevent flickering.',
      'Foreground combat load and catching up after time away have distinct messages.',
    ],
    compatibility:
      'Presentation changes apply to current expeditions without changing combat or rewards. Cloud sync requires a compatible account service.',
  },
  {
    id: 'stage-bestiary',
    title: 'Know your enemy',
    summary: 'Distinct stage encounters, final bosses, and a field bestiary.',
    changes: [
      'Nine exclusive enemies join the shared roster across Verdant Wilds, Ember Foundry, and Void Ruins.',
      'Face The Elder Root, Forge Colossus, and The Last Eclipse, each with distinct telegraphs and vulnerable phases.',
      'Inspect upcoming threats and open the Bestiary for attack patterns, strengths, weaknesses, and scaled stat previews. Encounters and defeats build your discovery record.',
    ],
    compatibility:
      'New encounters apply to new expeditions. Recovered runs retain their original encounter rules.',
  },
  {
    id: 'stage-progression',
    title: 'Choose your challenge',
    summary:
      'Each stage has its own difficulty progression, with more recovery choices between battles.',
    changes: [
      'Clearing a difficulty unlocks the next difficulty only for that stage. Previously available difficulties are preserved on stages you already unlocked.',
      'Milestone shops offer repairs worth 25%, 50%, 75%, or 100% of maximum health, at increasing scrap prices. Choose one repair per shop; excess healing is lost.',
      'Panel controls stay still on hover, and weapon cards show potential fusion partners while you choose upgrades.',
    ],
    compatibility:
      'Existing credits, clears, tower unlocks, and grandfathered stage difficulty access are preserved. Newly unlocked stages begin at Normal.',
  },
  {
    id: 'expedition-and-fusion',
    title: 'Prepare. Fuse. Endure.',
    summary: 'A clearer expedition setup and easier access to eligible fusions.',
    changes: [
      'Choose tower, equipped runes, pace, stage, and difficulty together. Start expedition stays visible; an active run makes Resume expedition primary.',
      'Newly eligible fusions are offered at a cleared-wave boundary after pending upgrades. Choose Later to keep access through the Fusion control and its eligible count.',
      'An open but unfocused game tab keeps progressing and pauses at decisions. Closing the tab does not grant offline progress; browser suspension can delay catch-up until you return.',
    ],
    compatibility:
      'Fusion dismissals and pending choices survive reloads. Starting a different expedition requires retiring the active one first.',
  },
];
