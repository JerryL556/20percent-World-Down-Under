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
    pathA: {
      name: 'Path A',
      minor: { name: 'Thermal Buffer', desc: 'Reduce heat buildup by 15% for laser beam and laser DMR.' },
      major: { name: 'Sparse Swarm', desc: 'Summon 4 BITs instead of 6, but BIT duration is doubled.' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Rapid Vent', desc: 'Laser overheat cooldown is 40% faster.' },
      major: { name: 'Dense Swarm', desc: 'Summon 9 BITs (no cooldown or duration change).' },
    },
  },
  repulse: {
    pathA: {
      name: 'Path A',
      minor: { name: 'Kinetic Step', desc: 'After taking enemy melee damage, gain +25% player speed for 1s.' },
      major: { name: 'Extended Impulse', desc: 'Repulsion Pulse keeps enemies pushed for longer.' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Counterforce', desc: 'Enemies that hit you with melee take 10 damage.' },
      major: { name: 'Crushing Wave', desc: 'Repulsion Pulse hit damage increases to 15.' },
    },
  },
  caustic_cluster: {
    pathA: {
      name: 'Path A',
      minor: { name: 'Toxic Potency', desc: 'Toxin effect is stronger: +25% duration and +50% enemy spread disruption.' },
      major: { name: 'Expanded Payload', desc: 'Caustic Cluster explosions gain +15px radius each.' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Corrosive Overload', desc: 'Increase toxin damage by 100%.' },
      major: { name: 'Volatile Charge', desc: 'Increase the explosion damage of the main Caustic grenade.' },
    },
  },
  landmine_dispenser: {
    pathA: {
      name: 'Path A',
      minor: { name: 'Blast Padding', desc: 'Reduce explosive damage from enemies by 20%.' },
      major: { name: 'Echo Concussion', desc: 'Landmine Dispenser mines apply two extra +10 stun pulses at +1s and +2s (three total stuns).' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Demo Payload', desc: 'Increase all player explosion damage by 20%.' },
      major: { name: 'Scorched Ground', desc: 'Landmine explosions leave an MGL-style fire field (same damage, VFX, and radius).' },
    },
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
    pathA: {
      name: 'Path A',
      minor: { name: 'Combat Harvest', desc: 'Heal 1 HP whenever you kill an enemy.' },
      major: { name: 'Servo Overdrive', desc: 'Vulcan Turret max rotation speed increases by 50%.' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Reserve Cycling', desc: 'Inactive equipped weapon auto-reloads after 5 seconds.' },
      major: { name: 'Heavy Caliber', desc: 'Vulcan Turret bullets deal +1 damage.' },
    },
  },
  energy_siphon: {
    pathA: {
      name: 'Path A',
      minor: { name: 'Shield Drip', desc: 'Gain 3 shield HP whenever you kill an enemy.' },
      major: { name: 'Overcharged Barrier', desc: 'During Energy Siphon, shield can overflow beyond max; overflow decays by 5 per second.' },
    },
    pathB: {
      name: 'Path B',
      minor: { name: 'Rapid Recharge', desc: 'Shield regeneration starts faster.' },
      major: { name: 'Extended Siphon', desc: 'Energy Siphon duration increases by 3s.' },
    },
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
