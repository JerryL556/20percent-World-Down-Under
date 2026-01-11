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
];

export function getAbilityById(id) {
  return abilityDefs.find((a) => a.id === id) || abilityDefs[0];
}
