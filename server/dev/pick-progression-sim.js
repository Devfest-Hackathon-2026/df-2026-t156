// Uses the normal 180s world, two native bots and ordinary input/tick, without funds or ore grants.
// Routes and aim read simulated positions: this is an economy sample, not a human usability trial.
import { simulate } from './balance-sim.js';

for (const seed of [7, 77, 777]) {
  for (const maxLevel of [2, 4, 8]) {
    console.log(JSON.stringify(simulate({ seed, precision: .35, strategies: [{
      name: 'copper-' + maxLevel, maxLevel, investBefore: 145, knowledge: true, initialCopper: true,
    }] })));
  }
}
