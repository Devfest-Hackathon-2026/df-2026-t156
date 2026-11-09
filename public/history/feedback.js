const $ = id => document.getElementById(id);
const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
let board = null, pending = false, loading = false, lastLoaded = 0, votedId = null, boardRevision = 0;
const proposalNodes = new Map();
function identityHeader() {
  try { const key = localStorage.getItem('valley-improvement-key'); return /^[a-f0-9]{64}$/.test(key || '') ? { Authorization: `Bearer ${key}` } : {}; } catch { return {}; }
}
async function requestBoard(body) {
  let response;
  try { response = await fetch('/api/feedback', { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { ...identityHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(body ? 20000 : 12000) }); }
  catch { throw new Error(body ? '結果を確認できませんでした。更新してご確認ください。' : '接続できませんでした。更新してもう一度お試しください。'); }
  let data; try { data = await response.json(); } catch { throw new Error('改善案を読み込めませんでした。'); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '操作できませんでした。もう一度お試しください。');
  if (!Array.isArray(data.proposals)) throw new Error('改善案を読み込めませんでした。');
  return data;
}
function message(text, error = false) { $('board-message').textContent = text; $('board-message').classList.toggle('is-error', error); }
async function loadBoard(quiet = false) {
  if (loading || pending) return;
  loading = true; const revision = boardRevision; $('refresh-board').disabled = true;
  if (!quiet && !board) message('改善案を読み込んでいます。');
  try { const next = await requestBoard(); if (revision !== boardRevision) return; if (board?.permission?.roundKey !== next.permission?.roundKey) votedId = null; board = next; lastLoaded = Date.now(); renderBoard(); if (!quiet) message(''); }
  catch (error) { if (!board) $('proposal-count').textContent = '改善案'; if (!quiet || !board) message(error.message || '改善案を読み込めませんでした。少し待って再度お試しください。', true); }
  finally { loading = false; $('refresh-board').disabled = pending; $('board').setAttribute('aria-busy', String(pending)); }
}
function permissionText(permission) {
  if (!permission) return '試合を終えると、勝者は改善案を投稿、ほかの参加者は投票で参加できます。';
  if (permission.role === 'winner') return permission.used ? 'この試合の改善案は投稿済みです。' : 'この試合の勝者です。改善案を1件投稿できます。';
  if (permission.role === 'voter') return permission.used ? 'この試合の投票は済んでいます。' : 'この試合から、改善案に1票投じられます。';
  return '新しい試合を終えてから参加できます。';
}
function proposalNode(id) {
  if (proposalNodes.has(id)) return proposalNodes.get(id);
  const node = make('article', 'proposal'); node.tabIndex = -1;
  const content = make('div'), text = make('p', 'proposal-text'), meta = make('p', 'proposal-meta');
  const author = make('span'), own = make('span', 'own', '自分の案'), status = make('span');
  meta.append(author, own, status); content.append(text, meta);
  const side = make('div', 'proposal-vote'), total = make('span', 'vote-total'), button = make('button', 'vote-button', '投票する');
  button.type = 'button'; button.addEventListener('click', () => vote(id)); side.append(total, button); node.append(content, side);
  const view = { node, text, author, own, status, total, button }; proposalNodes.set(id, view); return view;
}
function renderBoard() {
  if (!board) return;
  $('refresh-board').disabled = pending || loading; $('board').setAttribute('aria-busy', String(pending || loading));
  const permission = board.permission, canPropose = permission?.role === 'winner' && !permission.used;
  $('participation').hidden = false; $('permission-message').textContent = board.pending ? board.notice : permissionText(permission);
  $('proposal-form').hidden = !canPropose;
  $('proposal-count').textContent = `${board.proposals.length}件の改善案`;
  $('proposal-empty').hidden = board.proposals.length !== 0;
  const rows = [...board.proposals];
  if ($('proposal-sort').value === 'votes') rows.sort((a, b) => Number(b.votes) - Number(a.votes));
  const existing = new Set(rows.map(row => String(row.id)));
  for (const [id, view] of proposalNodes) if (!existing.has(id)) { view.node.remove(); proposalNodes.delete(id); }
  rows.forEach((proposal, position) => {
    const id = String(proposal.id), view = proposalNode(id);
    view.text.textContent = String(proposal.text || ''); view.author.textContent = proposal.author || '参加者';
    view.own.hidden = !proposal.isOwn; view.node.dataset.own = proposal.isOwn ? 'true' : 'false';
    view.status.textContent = proposal.status === 'proposed' ? '' : proposal.status === 'adopted' ? '反映済み' : proposal.status === 'closed' ? '受付終了' : '';
    view.status.hidden = !view.status.textContent;
    const validVotes = Number.isSafeInteger(proposal.votes) && proposal.votes >= 0;
    view.total.replaceChildren(document.createTextNode(validVotes ? String(proposal.votes) : '—'), make('small', '', '票'));
    const canVote = permission?.role === 'voter' && !permission.used && !proposal.isOwn && proposal.status === 'proposed';
    view.button.hidden = !canVote && votedId !== id;
    view.button.disabled = pending || !canVote;
    view.button.textContent = votedId === id ? '投票済み' : '投票する';
    view.button.setAttribute('aria-label', `${proposal.text}：${votedId === id ? '投票済み' : '投票する'}`);
    const current = $('proposal-list').children[position]; if (current !== view.node) $('proposal-list').insertBefore(view.node, current || null);
  });
  updateInput();
}
function updateInput() {
  const value = $('proposal-text').value.trim(), length = [...value].length;
  $('character-count').textContent = `${length} / 180`;
  $('character-count').style.color = length > 180 ? 'var(--error)' : '';
  $('submit-proposal').disabled = pending || length < 3 || length > 180;
  $('proposal-text').disabled = pending;
}
async function mutate(body) {
  if (pending) return null;
  pending = true; boardRevision++; message(body.action === 'vote' ? '投票を送っています。' : '改善案を保存しています。'); renderBoard();
  try { const next = await requestBoard(body); board = next; lastLoaded = Date.now(); return next; }
  catch (error) { try { board = await requestBoard(); lastLoaded = Date.now(); } catch {} message(error.message || '結果を確認できませんでした。更新してご確認ください。', true); return null; }
  finally { pending = false; }
}
async function vote(id) {
  const row = board?.proposals.find(proposal => String(proposal.id) === id);
  if (pending || board?.permission?.role !== 'voter' || board.permission.used || !row || row.isOwn || row.status !== 'proposed') return;
  const next = await mutate({ action: 'vote', proposalId: id });
  if (next) { votedId = id; message('投票しました。'); }
  renderBoard();
}
export function initFeedback() {
  $('proposal-text').addEventListener('input', () => { $('proposal-error').textContent = ''; updateInput(); });
  $('proposal-form').addEventListener('submit', async event => {
    event.preventDefault(); const text = $('proposal-text').value.trim(), length = [...text].length;
    if (pending || board?.permission?.role !== 'winner' || board.permission.used) return;
    if (length < 3 || length > 180) { $('proposal-error').textContent = '改善案は3〜180文字で入力してください。'; return; }
    const next = await mutate({ action: 'propose', text });
    if (next) { $('proposal-text').value = ''; message('改善案を投稿しました。'); }
    renderBoard();
  });
  $('proposal-sort').addEventListener('change', renderBoard);
  $('refresh-board').addEventListener('click', () => loadBoard());
  const refreshOnReturn = () => { if (document.visibilityState === 'visible' && Date.now() - lastLoaded > 1000) loadBoard(true); };
  window.addEventListener('focus', refreshOnReturn); window.addEventListener('pageshow', refreshOnReturn);
  window.addEventListener('history-game-closed', refreshOnReturn);
  window.addEventListener('storage', event => { if (event.key === 'valley-improvement-key') loadBoard(); });
  document.addEventListener('visibilitychange', refreshOnReturn);
  window.setInterval(() => { if (document.visibilityState === 'visible') loadBoard(true); }, 20000);
  loadBoard();
}
