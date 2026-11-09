import { initFeedback } from './feedback.js';

const $ = id => document.getElementById(id);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
const safeUrl = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
};
let comparisonVersion = null;
let generations = [], versions = [], pastProposals = new Map(), mode = 'versions', index = 0, selected = null, nextImage;
const list = () => mode === 'versions' ? versions : generations;
const recordName = record => String(record.title || record.id || 'ゲーム');
function versionLabel(record) {
  const ids = Array.isArray(record.versionIds) ? record.versionIds : [];
  if (ids.length) return ids.length === 1 ? String(ids[0]) : `${ids[0]} – ${ids.at(-1)}`;
  return String(record.version || record.id || '');
}
const optionName = record => [versionLabel(record), recordName(record)].filter(Boolean).join('　');
const examples = record => (Array.isArray(record?.examples) ? record.examples : []).filter(row => row && (row.idea || row.change));
const announcement = element('p', 'sr-only'); announcement.setAttribute('role', 'status'); $('story').before(announcement);

function retryState(message) {
  const state = $('history-state'); state.replaceChildren(element('p', '', message));
  const button = element('button', 'button button-primary', '記録を読み直す'); button.type = 'button'; button.addEventListener('click', loadHistory); state.append(button); state.hidden = false;
}
async function loadHistory() {
  const state = $('history-state'); state.hidden = false; state.textContent = 'ゲームの記録を読み込んでいます。';
  try {
    const response = await fetch('./generations.json', { cache: 'no-cache', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error();
    const data = await response.json();
    generations = (Array.isArray(data.generations) ? data.generations : []).filter(row => row && typeof row.id === 'string');
    versions = (Array.isArray(data.versions) ? data.versions : []).filter(row => row && typeof row.id === 'string');
    pastProposals = new Map((Array.isArray(data.proposals) ? data.proposals : []).map(row => [row.id, row]));
    if (!generations.length && !versions.length) { retryState('バージョンの記録を準備しています。'); return; }
    const select = $('version-select'); select.replaceChildren();
    for (const [key, label, records] of [['versions', '各バージョン', versions], ['generations', '変化のまとまり', generations]]) {
      if (!records.length) continue;
      const group = element('optgroup'); group.label = label;
      for (const record of records) { const option = element('option', '', optionName(record)); option.value = `${key}:${record.id}`; group.append(option); }
      select.append(group);
    }
    select.disabled = false; state.hidden = true; $('story').hidden = false; selectFromUrl();
  } catch { retryState('ゲームの記録を読み込めませんでした。'); }
}
function selectFromUrl() {
  const params = new URL(location.href).searchParams;
  const requestedMode = params.has('generation') ? 'generations' : versions.length ? 'versions' : 'generations';
  const requestedId = params.get(requestedMode === 'versions' ? 'version' : 'generation');
  const records = requestedMode === 'versions' ? versions : generations;
  const found = records.findIndex(row => row.id === requestedId);
  mode = records.length ? requestedMode : versions.length ? 'versions' : 'generations';
  index = found >= 0 ? found : 0; renderStory();
}
function selectRecord(newMode, newIndex, push = true) {
  const records = newMode === 'versions' ? versions : generations;
  if (!records[newIndex]) return;
  mode = newMode; index = newIndex;
  if (push) {
    const url = new URL(location.href); url.searchParams.delete('version'); url.searchParams.delete('generation');
    url.searchParams.set(mode === 'versions' ? 'version' : 'generation', records[index].id); url.hash = '';
    history.pushState(null, '', url);
  }
  renderStory();
}
function appendOpinion(parent, summary, proposal) {
  const original = proposal?.originalText?.trim();
  if (original && [...original].length <= 125) {
    parent.append(element('p', 'idea-source', proposal.originalWording || '本人の原文'));
    parent.append(element('blockquote', 'idea-text original-text', original));
  } else {
    if (summary) parent.append(element('p', 'idea-text', summary));
    if (original) {
      const disclosure = element('details', 'original');
      disclosure.append(element('summary', '', '原文を読む'));
      disclosure.append(element('small', 'idea-source', proposal.originalWording || '本人の原文'));
      disclosure.append(element('blockquote', 'original-text', original)); parent.append(disclosure);
    } else parent.append(element('small', 'idea-source', '本人の意見・要約'));
  }
}
function changePair(row, destination) {
  const pair = element('div', 'change-pair');
  const opinion = element('div', 'opinion'), change = element('div', 'reflection');
  if (row.idea) appendOpinion(opinion, row.idea, pastProposals.get(row.proposalId));
  if (row.change) { change.append(element('p', 'change-label', `${destination}での変化`)); change.append(element('p', 'change-text', row.change)); }
  pair.append(opinion, change);
  return pair;
}
function renderTransition(current, next) {
  const content = $('transition-content'); content.replaceChildren();
  const incoming = next || current;
  const ids = next && Array.isArray(current.feedbackUntilNextVersionIds) ? current.feedbackUntilNextVersionIds : incoming.inputProposalIds;
  const inputs = Array.isArray(ids) ? ids : null;
  const continuation = !!next && inputs !== null && !inputs.length;
  let rows = examples(incoming);
  if (inputs?.length) {
    rows = inputs.map((id, position) => rows.find(row => row.proposalId === id) || {
      idea: pastProposals.get(id)?.text, proposalId: id, change: position === 0 ? incoming.summary : ''
    }).filter(row => row.idea || row.change);
  }
  $('transition-destination').textContent = next ? `次の版  ${versionLabel(next)}` : 'この先の改善へ';
  $('transition-title').textContent = continuation ? '前の要望を引き継いだ調整' : next ? 'この時の意見' : 'この版に入った意見';
  if (continuation) {
    content.append(element('p', 'change-text', next.summary || rows[0]?.change || '同じ要望に沿って調整しました。'));
    content.append(element('p', 'attribution', 'この間の新しい入力は記録されていません。'));
    const opinionIndex = list().findIndex((record, position) => position > index && record.feedbackUntilNextVersionIds?.length);
    if (opinionIndex > index + 1) {
      const jump = element('button', 'opinion-jump', `次に意見が届いた版 ${versionLabel(list()[opinionIndex])} →`);
      jump.type = 'button'; jump.addEventListener('click', () => selectRecord(mode, opinionIndex)); content.append(jump);
    }
    if (rows.some(row => row.idea)) {
      const original = element('details', 'more-changes'); original.append(element('summary', '', 'もとの意見を読む'));
      rows.forEach(row => { if (row.idea) appendOpinion(original, row.idea, pastProposals.get(row.proposalId)); }); content.append(original);
    }
  } else if (rows.length) {
    content.append(changePair(rows[0], versionLabel(incoming)));
    if (rows.length > 1) {
      const more = element('details', 'more-changes'); more.append(element('summary', '', `ほかの意見と変化を読む（${rows.length - 1}件）`));
      rows.slice(1).forEach(row => more.append(changePair(row, versionLabel(incoming)))); content.append(more);
    }
  } else content.append(element('p', 'transition-empty', incoming.summary || 'この更新の入力文は記録されていません。'));
  $('latest-ideas').hidden = !!next; $('transition-next').hidden = !next;
  if (next) $('transition-next').textContent = `${versionLabel(next)}を見る →`;
}
function appendInputRecords(parent, ids, title) {
  const records = (Array.isArray(ids) ? ids : []).map(id => pastProposals.get(id)).filter(Boolean);
  if (!records.length) return;
  parent.append(element('li', 'records-heading', title));
  for (const proposal of records) {
    const item = element('li', 'input-record'); appendOpinion(item, proposal.text || '', proposal);
    const labels = [proposal.source, proposal.wording];
    if (proposal.sourceTurnStartedAt) {
      const date = new Date(proposal.sourceTurnStartedAt);
      if (!Number.isNaN(date.getTime())) labels.push(new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(date));
    }
    item.append(element('small', '', labels.filter(Boolean).join('・'))); parent.append(item);
  }
}

function recordInputs(record) {
  if (Array.isArray(record?.inputProposalIds)) return record.inputProposalIds;
  const ids = versions.filter(version => record?.versionIds?.includes(version.id)).flatMap(version => version.inputProposalIds || []);
  return ids.length ? [...new Set(ids)] : record?.relatedProposalIds || [];
}
function renderEvidence(record) {
  const node = $('evidence-list'); node.replaceChildren();
  appendInputRecords(node, recordInputs(record), 'この版に入るまでの意見');
  appendInputRecords(node, record.feedbackUntilNextVersionIds || recordInputs(list()[index + 1]), '次の版までに入力された意見');
  for (const source of Array.isArray(record.evidence) ? record.evidence : []) {
    const item = element('li'), value = typeof source === 'string' ? source : source.label || source.text || source.title || source.url || '';
    const raw = typeof source === 'string' ? /^(https?:|\.?\.?\/)/.test(source) ? source : null : source.url || source.href;
    const url = safeUrl(raw);
    if (url) { const a = element('a', '', value || '記録を読む'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; item.append(a); }
    else item.textContent = String(value);
    if (item.textContent) node.append(item);
  }
  $('evidence').hidden = !node.childElementCount; $('evidence').open = false;
}
function renderStory() {
  selected = list()[index]; if (!selected) return;
  const previous = list()[index - 1], next = list()[index + 1];
  $('version-select').value = `${mode}:${selected.id}`;
  const meta = [versionLabel(selected), selected.period].filter(Boolean).join('　');
  $('version-meta').textContent = meta; $('generation-title').textContent = recordName(selected);
  $('generation-summary').textContent = selected.summary || '';
  announcement.textContent = `${meta}、${recordName(selected)}を表示しています。`;
  const image = $('game-image'), imageUrl = safeUrl(selected.image);
  image.hidden = !imageUrl; $('image-empty').hidden = !!imageUrl; image.parentElement.classList.toggle('is-empty', !imageUrl);
  $('image-empty').textContent = 'この版の画像は準備中です。';
  if (imageUrl) { image.alt = `${versionLabel(selected)} ${recordName(selected)}のゲーム画面`; image.src = imageUrl; }
  else image.removeAttribute('src');
  $('game-caption').textContent = selected.caption || '';
  const playUrl = safeUrl(selected.playUrl); $('play-version').disabled = !playUrl;
  const playable = versions.find(row => safeUrl(row.playUrl) === playUrl);
  $('play-version').querySelector('span').textContent = playUrl ? `${playable?.id || versionLabel(selected)}を遊ぶ` : 'プレイ準備中';
  $('play-note').textContent = playUrl ? '過去の版は一人で試せます' : '実装の記録は引き続き読めます';
  const source = safeUrl(selected.sourceUrl); $('source-link').hidden = !source;
  if (source) { $('source-link').href = source; $('source-link').target = '_blank'; $('source-link').rel = 'noopener noreferrer'; }
  comparisonVersion = next || previous || null;
  const compare = $('comparison-stage'), comparisonImage = $('comparison-image');
  compare.hidden = !comparisonVersion;
  document.querySelector('.story-grid').dataset.final = String(!next && !!previous);
  const comparisonLabels = (next ? selected : previous)?.comparison;
  $('before-label').textContent = `${next ? '変更前' : '反映後'}　${versionLabel(selected)}${comparisonLabels ? '　' + (next ? comparisonLabels.beforeLabel : comparisonLabels.afterLabel) : ''}`;
  if (comparisonVersion) {
    $('after-label').textContent = `${next ? '反映後' : '変更前'}　${versionLabel(comparisonVersion)}${comparisonLabels ? '　' + (next ? comparisonLabels.afterLabel : comparisonLabels.beforeLabel) : ''}`;
    const url = safeUrl(comparisonVersion.image);
    comparisonImage.hidden = !url;
    if (url) { comparisonImage.src = url; comparisonImage.alt = `${versionLabel(comparisonVersion)} ${recordName(comparisonVersion)}のゲーム画面`; }
    else comparisonImage.removeAttribute('src');
    $('comparison-caption').textContent = comparisonVersion.caption || '';
    $('play-comparison').textContent = `${versionLabel(comparisonVersion)}を遊ぶ`;
    $('play-comparison').disabled = !safeUrl(comparisonVersion.playUrl);
  }
  renderTransition(selected, next); renderEvidence(selected);
  $('previous-version').disabled = !previous; $('next-version').disabled = !next;
  $('previous-version').querySelector('b').textContent = previous ? optionName(previous) : '';
  $('next-version').querySelector('b').textContent = next ? optionName(next) : '';
  if (next?.image) { nextImage = new Image(); const url = safeUrl(next.image); if (url) nextImage.src = url; }
}
$('game-image').addEventListener('load', () => { $('game-image').hidden = false; $('image-empty').hidden = true; $('game-image').parentElement.classList.remove('is-empty'); });
$('game-image').addEventListener('error', () => { $('game-image').parentElement.classList.add('is-empty'); $('game-image').hidden = true; $('image-empty').hidden = false; $('image-empty').textContent = 'この版の画像を読み込めませんでした。'; });
$('version-select').addEventListener('change', event => { const [key, ...id] = event.target.value.split(':'); const records = key === 'versions' ? versions : generations; const found = records.findIndex(row => row.id === id.join(':')); if (found >= 0) selectRecord(key, found); });
$('previous-version').addEventListener('click', () => selectRecord(mode, index - 1));
$('next-version').addEventListener('click', () => selectRecord(mode, index + 1));
$('transition-next').addEventListener('click', () => selectRecord(mode, index + 1));
window.addEventListener('popstate', selectFromUrl);
const dialog = $('game-dialog'), frame = $('game-frame'); let gameOpener;
function playRecord(record) {
  const url = safeUrl(record?.playUrl); if (!url) return;
  gameOpener = document.activeElement; $('game-dialog-version').textContent = versionLabel(record);
  $('game-dialog-title').textContent = recordName(record); frame.title = `${optionName(record)}のゲーム`;
  $('game-new-tab').href = url; dialog.showModal(); document.body.style.overflow = 'hidden'; frame.src = url;
  $('close-game').focus();
}
$('play-version').addEventListener('click', () => playRecord(selected));
$('play-comparison').addEventListener('click', () => playRecord(comparisonVersion));
function closeGame() { frame.src = 'about:blank'; dialog.close(); document.body.style.overflow = ''; gameOpener?.focus(); window.dispatchEvent(new Event('history-game-closed')); }
$('close-game').addEventListener('click', closeGame);
// Esc belongs to the game while it has focus (including pointer-lock release).
dialog.addEventListener('cancel', event => { event.preventDefault(); if (document.activeElement !== frame) closeGame(); });
initFeedback(); loadHistory();
