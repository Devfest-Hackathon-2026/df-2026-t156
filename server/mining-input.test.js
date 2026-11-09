import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from './game.js';
import { Valley, VALLEY } from './valley.js';

function fixture() {
  const source = VALLEY.deposits.find(d => d.kind === 'silver');
  const valley = new Valley({ ...VALLEY, heights: VALLEY.heights.map(() => 0), colliders: [],
    deposits: [{ ...VALLEY.deposits[0], id: 'start', x: -30, z: 0 },
      { ...source, id: 'rock', x: 0, z: 0 }] });
  const world = new World({ bots: false, valley }), player = world.addPlayer('p', 'P');
  Object.assign(player, { x: -2, y: 0, z: 0 });
  const rock = world.deposits.find(d => d.id === 'rock');
  const eye = world.eyes(player), delta = { x: rock.x - eye.x, y: rock.y + rock.height * .6 - eye.y, z: rock.z - eye.z };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const aim = { ax: delta.x / length, ay: delta.y / length, az: delta.z / length };
  return { world, player, rock, aim };
}

function press(world, player, aim, id = 1) {
  world.input(player.id, { ...aim, miningOnly: true, attackId: id, attackTime: world.time,
    attackAx: aim.ax, attackAy: aim.ay, attackAz: aim.az });
}

test('a released mining press keeps its original eyes and aim through later movement/look packets', () => {
  const { world, player, rock, aim } = fixture();
  press(world, player, aim);
  player.z += .45;
  world.input(player.id, { ax: -1, ay: 0, az: 0, miningOnly: true });
  world.tick(.05);
  assert.equal(rock.hp, rock.ore.hp - world.picks[0].damage);
  assert.equal(world.events.filter(e => e.type === 'mine' || e.type === 'weak').length, 1);
  for (let i = 0; i < 20; i++) world.tick(.05);
  assert.equal(rock.hp, rock.ore.hp - world.picks[0].damage, 'release does not manufacture a delayed extra strike');
});

test('a mining-only pulse into empty air does not spend the next rock hit cooldown', () => {
  const { world, player, rock, aim } = fixture();
  world.input(player.id, { ax: -1, ay: 0, az: 0, fire: true, miningOnly: true });
  world.tick(.05);
  assert.equal(player.nextStrike, 0);
  world.input(player.id, { ...aim, fire: true, miningOnly: true });
  world.tick(.05);
  assert.equal(rock.hp, rock.ore.hp - world.picks[0].damage);
  assert.ok(player.nextStrike > world.time);
  world.tick(.05);
  assert.equal(rock.hp, rock.ore.hp - world.picks[0].damage, 'a real hit still spends the whole pick cooldown');
});

test('a real rock press after an air miss is accepted immediately while repeat empty presses remain limited', () => {
  const { world, player, rock, aim } = fixture();
  press(world, player, { ax: -1, ay: 0, az: 0 }); world.tick(.05);
  assert.ok(player.missAttackUntil > world.time);
  const deadline = player.missAttackUntil;
  press(world, player, { ax: -1, ay: 0, az: 0 }, 2); world.tick(.05);
  assert.equal(player.missAttackUntil, deadline, 'empty spam cannot keep extending the miss state');
  press(world, player, aim, 3); world.tick(.05);
  assert.equal(rock.hp, rock.ore.hp - world.picks[0].damage);
  assert.ok(player.nextStrike > world.time);
});

test('preserved click eyes do not grant a hit through an actual foreground trunk', () => {
  const { world, player, rock, aim } = fixture();
  world.valley.cover.push({ id: 'cover', kind: 'trunk', x: -1, z: 0, base: 0, radius: .2, height: 4 });
  press(world, player, aim);
  world.tick(.05);
  assert.equal(rock.hp, rock.ore.hp);
  assert.equal(player.bag.length, 0);
});
