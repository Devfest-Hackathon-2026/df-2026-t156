// Build the public-facing selections from the retained versions and original feedback.
import fs from 'node:fs/promises';
const root = new URL('../public/', import.meta.url);
const archive = JSON.parse(await fs.readFile(new URL('history/generations.json', root),'utf8'));
const ver = id => archive.versions.find(v => v.id === id);
const prompt = id => archive.proposals.find(p => p.id === id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const img = id => '/history/'+ver(id).image;
const entries = [
  {until:7, shot:'r04', title:'宇宙船を降りて、谷を歩く',lead:'サイバーな舞台より、自然でオープンワールドのような世界を、一人称・WASDで歩きたい', body:'宇宙船でコアを運ぶ試作から、一人称で谷を歩き、ピッケルで鉱石を掘る対戦へ。',inputs:['p13','p14','p15']},
  {until:15, shot:'r09',lead:'いつまで強化して、いつから稼ぎに行くかを考えたい。',title:'道具を強くするか、売上を残すか',body:'売上を強化に使うと今の順位は下がる。そのぶん硬い鉱石を掘れるようになる。',inputs:['p17','p19','p21','p22']},
  {until:19, shot:'r16',lead:'大きい岩も掘りたい。',title:'大岩を壊すと近道が開く',body:'岩から銅を採れるようになり、崩せば売店への近道が開く。',inputs:['p26','p25','p30']},
  {until:27, shot:'r26',lead:'弓や銃みたいな概念があっても良いと思う。',title:'弓で相手の鉱石を奪える',body:'帰り道の相手を矢で狙えるように。運ぶ側は、飛んでくる矢を見てかわす。',inputs:['p31','p34','p35']},
  {until:37, shot:'r29',lead:'遠くからでも高い鉱脈が分かるようにしたい。',title:'光る鉱脈と、高く買う店',body:'希少な鉱脈に光が付き、高く買う店は30秒で移る。次に向かう場所を選べる。',inputs:['p37','p38','p39','p42']},
  {until:43, shot:'r43',lead:'円の中に入ったら、自動で売れたらいい。',title:'売店に入ると自動で換金',body:'売却ボタンを押す手間がなくなり、強化は中央のアンビルにまとまった。',inputs:['p43','p44','p45']},
  {until:44, shot:'r44',lead:'鉱石を持っていない相手にも、攻撃する理由がほしい。',title:'攻撃を当てると足が速くなる',body:'近接攻撃を当てると、2秒間だけ足が1.4倍速くなる。',inputs:['p46']}
];
const videoUrl = 'https://drive.google.com/file/d/1-4jKsDMGDks1GtSBuY7P2qrnsaZC5rN7';
const pitch = '勝者は改善案を投稿し、敗者は投票。選ばれた案をAIが数時間ごとに実装し、ゲームに反映する仕組みを開発中です。';
const word = '<span class="wordmark"><img width="36" height="36" src="/patchplay/icon.svg" alt="">WorldShift</span>';
const head = (title, desc) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title><meta name="description" content="${desc}"><meta name="theme-color" content="#f7f3e9">
  <meta property="og:title" content="${title}"><meta property="og:description" content="${desc}">
  <meta property="og:image" content="https://worldshift.pichu.dev/patchplay/poster.jpg"><meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/patchplay/icon.svg"><link rel="stylesheet" href="/patchplay/style.css"></head><body><a class="skip" href="#main">本文へ</a>`;
const nav = (history = false) => `<header class="mast"><div class="bar wrap">
  <a class="brand" href="/" aria-label="WORLDSHIFT ホーム">${word}<span class="tagline">プレイヤー自身が作り変えるゲーム</span></a>
  <nav aria-label="メイン"><a href="/" ${history ? '' : 'aria-current="page"'}>ゲーム</a>
  <a data-trailer href="${videoUrl}/view">PVを見る</a><a href="/history/" ${history ? 'aria-current="page"' : ''}>進化の履歴</a></nav>
</div></header>`;
const foot = '</body></html>';
const origin = '/history-play/play/';
const trailer = `<dialog id="trailer" aria-labelledby="trailer-title"><header>
  <h2 id="trailer-title">WORLDSHIFTのPV</h2><form method="dialog"><button autofocus>閉じる ×</button></form></header>
  <iframe title="WORLDSHIFTの実演動画" data-src="${videoUrl}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe>
  <a class="trailer-fallback" href="${videoUrl}/view" target="_blank" rel="noopener noreferrer">Google Driveで見る ↗</a>
</dialog><script type="module" src="/patchplay/trailer.js"></script>`;
const home = head('WORLDSHIFT — プレイヤー自身が作り替えるゲーム', pitch) + nav() + `
<main class="lobby wrap" id="main">
  <h1 class="sr-only">WorldShift　プレイヤー自身が作り変えるゲーム</h1>
  <section class="game-shell" id="game-shell" aria-labelledby="game-name">
    <div class="game-window" id="game-window">
      <div class="preview"><img class="game-title" src="/valley-title.png" alt="谷の採鉱競争">
        <a class="start" id="launch-game" href="/play">ゲームを開く <span aria-hidden="true">▶</span></a>
      </div>
    </div>
    <div class="game-bar"><div class="game-id"><span class="lamp"></span><strong id="game-name">谷の採鉱競争</strong><span class="game-duration">3分のオンライン対戦</span><span class="game-about">${pitch}</span></div>
      <div class="tools"><a data-trailer href="${videoUrl}/view">▶ PVを見る</a><a href="/history/">進化の履歴</a><button type="button" id="fullscreen">⛶ 全画面</button></div>
    </div>
  </section>

</main>${trailer}<script type="module" src="/patchplay/lobby.js"></script>` + foot;
const versionOptions=archive.versions.map(v=>`<option value="${esc(v.playUrl)}">${v.id}　${esc(v.title)}</option>`).join('');
let low=1;
const cards=entries.map((e,i)=>{
  const versions=archive.versions.filter(v=>v.number>=low&&v.number<=e.until);low=e.until+1;
  const props=e.inputs.map(prompt);
  const original=props.filter(p=>p?.originalText).map(p=>`<blockquote>${esc(p.originalText)}</blockquote>`).join('');
  const shotLink = (id, label) => `<a class="patch-image" href="${origin}${id}/" aria-label="${esc(label)}">
    <img width="800" height="450" ${i ? 'loading="lazy"' : ''} src="https://hobby-256508.web.app/worldshift/history/${esc(ver(id).image.split('/').at(-1))}" data-fallback="${esc(img(id))}" onerror="this.onerror=null;this.src=this.dataset.fallback" alt="${esc(ver(id).title)}">
    <span>▶　${esc(label)}</span>
  </a>`;
  const shot = i === 0
    ? `<div class="first-versions">${shotLink('r03','宇宙船を操る')}${shotLink('r04','谷を歩く')}</div>`
    : shotLink(e.shot, 'この版を遊ぶ');
  return `<article id="${e.shot}" class="patch" data-versions="${versions.map(v=>v.id).join(' ')}">
  ${shot}
  <div class="patch-body"><p class="version">${versions[0].id.toUpperCase()}${versions.length > 1 ? ' → ' + versions.at(-1).id.toUpperCase() : ''}</p><details class="source"><summary><span class="source-label">提案</span><span>${esc(e.lead)}</span><span class="source-more">原文</span></summary>${original}</details><h2>${esc(e.title)}</h2><p>${esc(e.body)}</p></div></article>`;
}).join('');
const previous=await fs.readFile(new URL('history/index.html',root),'utf8');
const board=previous.match(/<section class="feedback-section"[\s\S]*?<\/section>/)?.[0];
if(!board)throw Error('Missing feedback form');
const history=head('進化の履歴 — WORLDSHIFT','プレイヤーの声で何が変わったか。実際の提案とゲームを並べて辿る。')+nav(true)+`<main id="main"><section class="archive-intro wrap"><h1>進化の履歴</h1><p>提案を開いて、当時のゲームを遊んでみよう。</p></section><section class="wrap timeline">${cards}<details class="allversions"><summary>保存版から選んで遊ぶ <span>39 versions</span></summary><form id="archive-pick"><label for="archived">バージョン</label><select id="archived">${versionOptions}</select><button>遊ぶ ↗</button></form></details></section>${board.replace('href="/"','href="/play"').replace('最新版を遊んだら','試合を終えたら')}</main><script type="module" src="/patchplay/history.js"></script>`+trailer+foot;
await fs.mkdir(new URL('patchplay/',root),{recursive:true});
await fs.writeFile(new URL('patchplay/index.html',root),home);
await fs.writeFile(new URL('history/index.html',root),history);