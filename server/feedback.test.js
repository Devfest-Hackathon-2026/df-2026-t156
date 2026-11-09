import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FeedbackBoard, FeedbackStorage, feedbackIdentity, feedbackVersion } from './feedback.js';
import { createGameServer } from './index.js';
import { World } from './game.js';

const winner = feedbackIdentity('a'.repeat(64)), loser = feedbackIdentity('b'.repeat(64));
const identities = new Map([['a', winner], ['b', loser], ['bot', 'not-a-human']]);
const rows = [{ id: 'a', name: '同名', rank: 1 }, { id: 'b', name: '同名', rank: 2 }, { id: 'bot', name: 'BOT', rank: 1, bot: true }];

test('only real round roles authorize one proposal or vote, and shared totals persist after restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'valley-feedback-'));
  const storage = new FeedbackStorage({ file: path.join(dir, 'board.json'), bucket: '' });
  try {
    let board = new FeedbackBoard(storage);
    assert.equal((await board.view(winner)).permission, null);
    await assert.rejects(async () => board.submit(loser, '未参加の投稿'), /勝者/);
    await board.recordRound('fixture:1', rows, identities);
    await board.recordRound('fixture:1', rows, identities);
    assert.equal((await board.view(winner)).permission.role, 'winner');
    assert.equal((await board.view(loser)).permission.role, 'voter');
    assert.equal((await board.view('not-a-human')).permission, null);
    assert.equal((await board.view(loser)).proposals.length, 0, 'losers wait for a real winning proposal, not seeded fake votes');
    await assert.rejects(async () => board.vote(winner, 'absent'), /敗者/);
    await board.submit(winner, '<b>岩の割れ方を見やすく</b>');
    let view = await board.view(loser);
    assert.equal(view.proposals[0].text, '<b>岩の割れ方を見やすく</b>', 'literal text; the Unity view disables rich text');
    await assert.rejects(async () => board.submit(winner, '二度目の投稿'), /勝者/);
    await board.vote(loser, view.proposals[0].id);
    await assert.rejects(async () => board.vote(loser, view.proposals[0].id), /敗者/);
    board = new FeedbackBoard(new FeedbackStorage({ file: storage.file, bucket: '' }));
    view = await board.view(loser);
    assert.equal(view.proposals[0].votes, 1); assert.equal(view.permission.used, true); assert.equal(view.storage, 'file');
    assert.equal(view.proposals[0].basedOnVersion, 'development');
    await board.recordRound('fixture:2', [{ id: 'b', name: '同名', rank: 1 }], identities);
    assert.equal((await board.view(loser)).permission.role, 'winner');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('tied humans may each propose; repeated browser connections and bot wins do not invent votes', async () => {
  const board = new FeedbackBoard(new FeedbackStorage({ file: '', bucket: '' }));
  const map = new Map([...identities, ['same-browser', winner]]);
  await board.recordRound('tie:1', [...rows.map(r => ({ ...r, rank: 1 })), { id: 'same-browser', rank: 1, name: '別名' }], map);
  assert.equal(board.data.grants.length, 2);
  await board.submit(winner, '明るい道具を作る'); await board.submit(loser, '近道を分かりやすく');
  assert.equal((await board.view(winner)).proposals.length, 2);
  assert.equal((await board.view(winner)).proposals.find(p => p.author === '同名' && p.text === '明るい道具を作る').isOwn, true);
  assert.equal(feedbackIdentity('wrong'), '');
  await assert.rejects(async () => board.submit('', '知らない人'), /改善案/);
});

test('a storage write retains its own read generation even when another read intervenes', async () => {
  const previous = globalThis.fetch;
  const storage = new FeedbackStorage({ bucket: 'fixture-bucket', file: '' });
  storage.headers = async () => ({});
  let generation = 0, requested;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { requested = new URL(url); return new Response('', { status: 412 }); }
    if (String(url).includes('alt=media')) return Response.json(emptyFixture());
    return Response.json({ generation: String(++generation) });
  };
  try {
    const first = await storage.load();
    await storage.load();
    await assert.rejects(storage.save(first.data, first.generation), error => error.conflict === true);
    assert.equal(requested.searchParams.get('ifGenerationMatch'), '1');
  } finally { globalThis.fetch = previous; }
});
function emptyFixture() { return { version: 1, proposals: [], grants: [] }; }
test('the target version comes from the actual Cloud Run revision, not a handwritten chapter number', () => {
  assert.equal(feedbackVersion({ K_REVISION: 'orbit-salvage-prototype-00045-abc' }), 'r45');
  assert.equal(feedbackVersion({}), 'development');
});

test('history HTTP API shares round rights and totals without joining a game socket', async () => {
  const board = new FeedbackBoard(new FeedbackStorage({ file: '', bucket: '' }));
  await board.recordRound('http:1', rows, identities);
  const app = createGameServer({ world: new World({ bots: false }), feedback: board });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}/api/feedback`;
  const post = (key, body, extra = {}) => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  try {
    const anonymous = await (await fetch(url)).json();
    assert.equal(anonymous.permission, null);
    assert.equal((await post('', { action: 'propose', text: '無権限の案' })).status, 401);
    assert.equal((await post('a'.repeat(64), { action: 'propose', text: '別サイト' }, { Origin: 'https://other.example' })).status, 403);
    let response = await post('a'.repeat(64), { action: 'propose', text: 'HTTPでも意見を送れるようにする' });
    assert.equal(response.status, 200);
    const submitted = await response.json();
    assert.equal(submitted.permission.used, true); assert.equal(submitted.proposals[0].isOwn, true);
    const id = submitted.proposals[0].id;
    response = await post('b'.repeat(64), { action: 'vote', proposalId: id });
    assert.equal(response.status, 200); assert.equal((await response.json()).proposals[0].votes, 1);
    assert.notEqual((await post('b'.repeat(64), { action: 'vote', proposalId: id })).status, 200);
    const shared = await (await fetch(url)).json();
    assert.equal(shared.permission, null); assert.equal(shared.proposals[0].votes, 1);
    assert.ok(!JSON.stringify(shared).includes(winner));
    assert.equal(app.world.players.size, 0, 'viewing history does not add an in-game human');
  } finally { await app.stop(); }
});
