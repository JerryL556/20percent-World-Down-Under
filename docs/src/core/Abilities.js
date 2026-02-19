// Simple ability registry. Extend with more abilities as needed.
export const abilityDefs = [
  {
    id: 'ads',
    name: 'ADS',
    desc: 'Deploy a stationary triangle that zaps enemy projectiles within range (5/s).',
  },
  {
    id: 'bits',
    name: 'BITs',
    desc: 'Deploy 6 remote bits that strafe targets and fire blue lasers for 7s.',
  },
  {
    id: 'repulse',
    name: 'Repulsion Pulse',
    desc: 'Release an expanding orange ring that blocks enemy projectiles and pushes enemies away.',
  },
  {
    id: 'caustic_cluster',
    name: 'Caustic Grenade',
    desc: [
      'Throw a caustic grenade to the cursor that explodes,',
      'spawning 5 cluster bomblets that spread out and explode.',
      'Each detonation leaves a green toxin field (6s). Enemies inside become disoriented and less accurate.',
    ].join('\n'),
  },
  {
    id: 'landmine_dispenser',
    name: 'Landmine Dispenser',
    desc: [
      'Deploys a dispenser that releases 10 landmines around itself in a circle.',
      'Mines are green blocks, persist until triggered, and detonate for 30 dmg and 20 stun (60px radius) when an enemy enters 40px.',
    ].join('\n'),
  },
  {
    id: 'stealth_decoy',
    name: 'Stealth Decoy',
    desc: [
      'Enter stealth for 4s and leave a decoy where you stand.',
      'Enemies target the decoy while you are invisible.',
      'Firing or melee ends stealth; the decoy explodes for 30 dmg (100px).',
      'The melee that breaks stealth deals 10x damage.',
    ].join('\n'),
  },
  {
    id: 'directional_shield',
    name: 'Directional Shield',
    desc: [
      'Project a 90° yellow arc that follows the cursor and blocks ranged attacks.',
      'Shield HP: 1000. Decays 100/s and breaks when depleted.',
      'Cooldown: 15s.',
    ].join('\n'),
  },
  {
    id: 'vulcan_turret',
    name: 'Vulcan Turret',
    desc: [
      'Deploy a turret that targets the closest enemy and fires 2000 RPM bullets.',
      'Warmup: 1s. Duration: 9s. Despawns when the room is clear.',
      'Deals 1 dmg per bullet to bosses.',
      'Cooldown: 20s.',
    ].join('\n'),
  },
  {
    id: 'energy_siphon',
    name: 'Energy Siphon',
    desc: [
      'For 8s, convert 25% of damage you deal into shield.',
      'Also heal 5 HP whenever an enemy dies during the effect.',
      'Cooldown: 14s.',
    ].join('\n'),
  },
];

// Placeholder upgrade definitions. You can replace names/descriptions/effects later.
// Each ability has two paths and each path has a minor + major tier.
export const abilityUpgradeDefs = Object.freeze({
  ads: {
    pathA: {
      name: 'Path A',
      minor: { name: 'Projectile Dampening', desc: 'Reduce enemy projectile damage to player by 15%.' },
      major: { name: 'Overclocked Intercept', desc: 'ADS destroys enemy projectiles 50% faster.' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Brace Impact', desc: 'Reduce enemy melee damage to player by 20%.' },
      major: { name: 'Gravity Well', desc: 'ADS slows enemies by 50% within a visible 100px radius.' },
    },
  },
  bits: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  repulse: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  caustic_cluster: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  landmine_dispenser: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  stealth_decoy: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  directional_shield: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  vulcan_turret: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
  energy_siphon: {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  },
});

export function getAbilityUpgradeDef(id) {
  const def = abilityUpgradeDefs[id];
  if (def) return def;
  // Generic fallback so newly added abilities remain upgradeable before defs are authored.
  return {
    pathA: { name: 'Path A', minor: { name: 'Minor A', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major A', desc: 'Placeholder passive (ability-focused).' } },
    pathB: { name: 'Path B', minor: { name: 'Minor B', desc: 'Placeholder passive (player-focused).' }, major: { name: 'Major B', desc: 'Placeholder passive (ability-focused).' } },
  };
}

export function getAbilityById(id) {
  return abilityDefs.find((a) => a.id === id) || abilityDefs[0];
}
