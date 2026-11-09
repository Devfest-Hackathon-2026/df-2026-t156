import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const empty = () => ({ version: 1, proposals: [], grants: [] });
export const feedbackIdentity = key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)
  ? createHash('sha256').update(key).digest('hex') : '';
export function feedbackVersion(environment = process.env) {
  const revision = /-(\d{5})-[^-]+$/.exec(environment.K_REVISION || '');
  return environment.GAME_VERSION || (revision ? 'r' + String(Number(revision[1])).padStart(2, '0') : 'development');
}
const plain = value => String(value ?? '').normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim();

// Local files and Cloud Storage both survive game rounds. Cloud generations
// prevent two revisions from overwriting each other's accepted submissions.
export class FeedbackStorage {
  constructor({ file = process.env.FEEDBACK_FILE, bucket = process.env.FEEDBACK_BUCKET,
    object = process.env.FEEDBACK_OBJECT || 'orbit-salvage/feedback/v1.json' } = {}) {
    Object.assign(this, { file, bucket, object }); this.memory = empty();
    this.mode = bucket ? 'cloud' : file ? 'file' : 'memory';
  }
  async headers() {
    if (!this.token || Date.now() > this.tokenUntil) {
      const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
        { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Storage identity unavailable');
      const data = await response.json(); this.token = data.access_token;
      this.tokenUntil = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    }
    return { Authorization: `Bearer ${this.token}` };
  }
  async load() {
    if (this.bucket) {
      const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.object)}`;
      const headers = await this.headers();
      const response = await fetch(base, { headers, signal: AbortSignal.timeout(8000) });
      if (response.status === 404) return { data: empty(), generation: '0' };
      if (!response.ok) throw new Error('Storage read unavailable');
      const metadata = await response.json(), generation = metadata.generation;
      const content = await fetch(`${base}?alt=media&generation=${generation}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!content.ok) throw new Error('Storage content unavailable');
      return { data: await content.json(), generation };
    }
    if (this.file) {
      try { return { data: JSON.parse(await readFile(this.file, 'utf8')) }; }
      catch (error) { if (error.code !== 'ENOENT') throw error; return { data: empty() }; }
    }
    return { data: structuredClone(this.memory) };
  }
  async save(data, generation) {
    if (this.bucket) {
      const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o`);
      url.search = new URLSearchParams({ uploadType: 'media', name: this.object, ifGenerationMatch: generation });
      const response = await fetch(url, { method: 'POST', headers: { ...await this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(data), signal: AbortSignal.timeout(8000) });
      if (response.status === 412) { const conflict = new Error('Storage changed'); conflict.conflict = true; throw conflict; }
      if (!response.ok) throw new Error('Storage write unavailable');
      await response.json(); return;
    }
    if (this.file) {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(data), 'utf8');
      await rename(`${this.file}.tmp`, this.file); return;
    }
    this.memory = structuredClone(data);
  }
}

export class FeedbackBoard {
  constructor(storage = new FeedbackStorage()) { this.storage = storage; this.versionId = feedbackVersion(); this.queue = Promise.resolve(); this.cachedAt = 0; this.httpRequests = new Map(); this.pendingGrants = new Map(); }
  pendingRound(round, failed = false) {
    for (const row of round.standings) {
      const owner = round.identities.get(row.id), previous = this.pendingGrants.get(owner);
      if (row.bot || !owner || previous?.completedAt > round.completedAt) continue;
      this.pendingGrants.set(owner, { roundKey: round.roundKey, completedAt: round.completedAt, failed });
    }
    while (this.pendingGrants.size > 64) this.pendingGrants.delete(this.pendingGrants.keys().next().value);
  }
  savedRound(round) {
    for (const owner of round.identities.values()) if (this.pendingGrants.get(owner)?.roundKey === round.roundKey) this.pendingGrants.delete(owner);
  }
  pendingNotice(owner, data) {
    const pending = this.pendingGrants.get(owner), grant = data.grants.findLast(g => g.owner === owner);
    if (!pending || grant?.roundKey === pending.roundKey || grant?.createdAt > pending.completedAt) return '';
    return pending.failed ? 'この試合の参加権を保存できませんでした。次の試合から再度参加できます。' : 'この試合の参加権を保存中です。少し待ってください。';
  }
  async http(req, res) {
    const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    const owner = feedbackIdentity(/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1]);
    try {
      if (req.method === 'GET') { reply(200, await this.view(owner)); return; }
      if (req.method !== 'POST') { reply(405, { error: 'この操作は使えません' }); return; }
      if (req.headers.origin) {
        let originHost = '';
        try { originHost = new URL(req.headers.origin).host; } catch { /* Reject opaque or malformed origins. */ }
        if (originHost !== req.headers.host) { reply(403, { error: 'ゲームと同じページから操作してください' }); return; }
      }
      if (!owner) { reply(401, { error: 'ゲームを終えてから投稿・投票できます' }); return; }
      const now = Date.now();
      if (now - (this.httpRequests.get(owner) || 0) < 700) { reply(429, { error: '少し待ってからもう一度お試しください' }); return; }
      this.httpRequests.set(owner, now);
      if (this.httpRequests.size > 1000) this.httpRequests.delete(this.httpRequests.keys().next().value);
      let bytes = 0; const chunks = [];
      await new Promise((resolve, reject) => {
        req.on('data', chunk => { bytes += chunk.length; if (bytes <= 2048) chunks.push(chunk); });
        req.on('end', resolve); req.on('error', reject);
      });
      if (bytes > 2048) { reply(413, { error: '入力が長すぎます。180文字以内にしてください' }); return; }
      let packet;
      try { packet = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(400, { error: '入力を読み取れませんでした' }); return; }
      if (packet?.action === 'propose') await this.submit(owner, packet.text);
      else if (packet?.action === 'vote') await this.vote(owner, packet.proposalId);
      else { reply(400, { error: 'この操作は使えません' }); return; }
      reply(200, await this.view(owner));
    } catch (error) {
      const expected = /^[改善案勝敗同こ提]/.test(error.message);
      reply(expected ? 400 : 503, { error: expected ? error.message : '保存できませんでした。少し待って再度お試しください' });
    }
  }
  transaction(change) {
    const operation = this.queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, generation } = await this.storage.load();
        const result = change(data);
        try { await this.storage.save(data, generation); this.data = data; this.cachedAt = Date.now(); return result; }
        catch (error) { if (!error.conflict || attempt === 2) throw error; }
      }
    });
    this.queue = operation.catch(() => {}); return operation;
  }
  recordRound(roundKey, standings, identities, { completedAt = Date.now(), versionId = this.versionId } = {}) {
    return this.transaction(data => {
      for (const row of standings) {
        const owner = identities.get(row.id);
        if (row.bot || !owner || data.grants.some(g => g.roundKey === roundKey && g.owner === owner)) continue;
        data.grants.push({ id: randomUUID(), roundKey, owner, name: plain(row.name).slice(0, 24),
          role: row.rank === 1 ? 'winner' : 'voter', versionId, used: false, createdAt: completedAt });
      }
      // Retain the latest permissions per browser; old votes are already in totals.
      data.grants.sort((a, b) => a.createdAt - b.createdAt);
      if (data.grants.length > 2000) data.grants = data.grants.slice(-2000);
    });
  }
  async view(owner) {
    // Report a locally known pending result immediately, even while a cloud request is timing out.
    if (!this.pendingNotice(owner, this.data || empty()) && (!this.data || Date.now() - this.cachedAt > 3000)) {
      await this.queue;
      try { this.data = (await this.storage.load()).data; this.cachedAt = Date.now(); }
      catch (error) { if (!this.pendingGrants.has(owner)) throw error; }
    }
    const data = this.data || empty(), notice = this.pendingNotice(owner, data);
    const grant = notice ? null : data.grants.findLast(g => g.owner === owner);
    return { storage: this.storage.mode, versionId: this.versionId, pending: !!notice, notice, permission: grant ? { role: grant.role, used: grant.used, roundKey: grant.roundKey, versionId: grant.versionId } : null,
      proposals: data.proposals.map(p => ({ id: p.id, text: p.text, author: p.author, votes: p.votes,
        status: p.status, basedOnVersion: p.basedOnVersion, isOwn: p.owner === owner, createdAt: new Date(p.createdAt).toISOString() })).reverse() };
  }
  submit(owner, text) {
    const cleaned = plain(text);
    if (!owner || typeof text !== 'string' || [...cleaned].length < 3 || [...cleaned].length > 180) throw new Error('改善案は3〜180文字で入力してください');
    return this.transaction(data => {
      const notice = this.pendingNotice(owner, data); if (notice) throw new Error(notice);
      const grant = data.grants.findLast(g => g.owner === owner);
      if (!grant || grant.role !== 'winner' || grant.used) throw new Error('勝者は一試合につき1案を投稿できます');
      if (data.proposals.length >= 500) throw new Error('提案の受付上限に達しました');
      if (data.proposals.some(p => p.text === cleaned)) throw new Error('同じ改善案が既にあります');
      data.proposals.push({ id: randomUUID(), text: cleaned, author: grant.name, owner, basedOnVersion: grant.versionId,
        votes: 0, status: 'proposed', createdAt: Date.now() });
      grant.used = true;
    });
  }
  vote(owner, proposalId) {
    return this.transaction(data => {
      const notice = this.pendingNotice(owner, data); if (notice) throw new Error(notice);
      const grant = data.grants.findLast(g => g.owner === owner);
      const proposal = data.proposals.find(p => p.id === proposalId);
      if (!grant || grant.role !== 'voter' || grant.used) throw new Error('敗者は一試合につき1票を投じられます');
      if (!proposal || proposal.status !== 'proposed' || proposal.owner === owner) throw new Error('この案には投票できません');
      proposal.votes++; grant.used = true;
    });
  }
}
