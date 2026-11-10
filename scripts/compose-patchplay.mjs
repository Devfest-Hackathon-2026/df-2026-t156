// Build the public-facing selections from the retained versions and original feedback.
import fs from 'node:fs/promises';
const root = new URL('../public/', import.meta.url);
const archive = JSON.parse(await fs.readFile(new URL('history/generations.json', root),'utf8'));
const ver = id => archive.versions.find(v => v.id === id);
const prompt = id => archive.proposals.find(p => p.id === id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const img = id => '/history/'+ver(id).image;
const entries = [
  {until:7, shot:'r04', title:'宇宙から、歩いて探す谷へ',lead:'サイバーな舞台より、自然でオープンワールドのような世界を、一人称・WASDで歩きたい', body:'宇宙船でコアを運ぶ試作から、谷を一人称で歩く遊びへ。地面に落ちた鉱石は、ピッケルで掘って持ち帰る鉱脈に変わった。',inputs:['p13','p14','p15']},
  {until:15, shot:'r09',title:'3分間、稼ぐか、強くなるか',body:'売上でピッケルを強化すれば、次はもっと硬い鉱石を掘れる。強化に費やした点は順位から引かれる。残り時間が投資の判断を変える。',inputs:['p17','p19','p21','p22']},
  {until:19, shot:'r16',title:'岩を削って、帰り道を変える',body:'背景だった大岩からも銅が採れるようになった。割れる岩を崩せば、売店への近道が開く。道中で奪われた鉱石は、相手を追って奪い返せる。',inputs:['p26','p25','p30']},
  {until:27, shot:'r26',title:'弓の一射で、荷物を奪う',body:'接近して殴るほかに、弓を引いて帰り道の相手を狙えるように。矢の軌道が見え、鉱石を持ち帰る側にもかわす余地ができた。',inputs:['p31','p34','p35']},
  {until:37, shot:'r29',title:'光を見て、奪い合う場所を選ぶ',body:'希少な鉱脈を遠くから見つけられるようにした。高く買う店は30秒ごとに移る。灯りを追うか、近くで換金するかを選べる。',inputs:['p37','p38','p39','p42']},
  {until:43, shot:'r43',title:'店に入れば売れる。道具は一押しで強化',body:'売店の円に入るだけで換金。中央のアンビルにピッケルやバッグを使えば、その道具を強化できる。',inputs:['p43','p44','p45']},
  {until:44, shot:'r44',title:'一撃当てたら、追うか、逃げるか',body:'見た目に合わせて当たる幅を広げた。近接攻撃が当たると2秒間、足が1.4倍速くなる。空のバッグを持つ相手にも、一撃を入れる意味が生まれた。',inputs:['p46']}
];
const mark='<svg viewBox="0 0 39 32" fill="currentColor" aria-hidden="true"><path d="M0 3h19L9 16H0zm12 13L22 3h17L17 29H0z"/></svg>';
const word='<span class="wordmark">'+mark+'<span>WORLD<em>SHIFT</em></span></span>';
const head=(title,desc)=>`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#11131b"><title>${title}</title><meta name="description" content="${desc}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="https://worldshift.pichu.dev/patchplay/poster.jpg"><meta name="twitter:card" content="summary_large_image"><link rel="icon" href="/patchplay/icon.svg"><link rel="stylesheet" href="/patchplay/style.css"></head><body><a class="skip" href="#main">本文へ</a>`;
const nav=(history=false)=>`<header class="top"><div class="wrap bar"><a class="brand" href="/" aria-label="WORLDSHIFT ホーム">${word}</a><nav><a class="${history?'active':''}" href="/history/">進化の履歴</a><a href="/history/#ideas">改善案</a><a class="navplay" href="/play">遊ぶ <i>↗</i></a></nav></div></header>`;
const foot=`<footer><div class="wrap foot"><a href="/" class="brand">${word}</a><a href="/history/">進化の履歴</a><a href="/play">最新版を遊ぶ ↗</a></div></footer></body></html>`;
const videoFile = '1-4jKsDMGDks1GtSBuY7P2qrnsaZC5rN7';
const videoUrl = 'https://drive.google.com/file/d/' + videoFile;
const art = `<a class="keyart" id="trailer-link" href="${videoUrl}/view" aria-label="WORLDSHIFTの実演を見る（57秒）">
  <div class="art-before"></div><div class="art-after"></div><div class="slice"></div>
  <div class="arttag first">宇宙船で運ぶ</div><div class="arttag last">谷を歩いて掘る</div>
  <span class="watch"><span class="play-symbol" aria-hidden="true">▶</span> 実演を見る <small>0:57</small></span>
</a>`;
const trailer = `<dialog id="trailer" aria-labelledby="trailer-title"><header><h2 id="trailer-title">WORLDSHIFT 実演</h2>
  <form method="dialog"><button aria-label="動画を閉じる" autofocus>閉じる ×</button></form></header>
  <iframe title="WORLDSHIFTの実演動画" data-src="${videoUrl}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe>
  <a class="trailer-fallback" href="${videoUrl}/view" target="_blank" rel="noopener noreferrer">Google Driveで見る ↗</a>
</dialog><script type="module" src="/patchplay/trailer.js"></script>`;
const origin='/history-play/play/';
const previews=entries.filter((_,i)=>[0,3,5].includes(i)).map(e=>`<a class="thumb" href="/history/#${e.shot}"><img src="${img(e.shot)}" alt="" loading="lazy"><h3>${e.title} <i>↗</i></h3></a>`).join('');
const home=head('WORLDSHIFT — プレイヤーの一票で進化するゲーム','宇宙船を操る試作が、ひとつの提案から採鉱対戦へ。勝者が提案し、敗者が投票する。AIと作り変えてきた39版を遊べます。')+nav()+`<main id="main"><section class="hero wrap"><div class="hero-copy"><h1>宇宙船を降りたら、<br><b>別のゲームだった。</b></h1><p>自然の中を、自分の足で歩きたい。<br>その提案を受けて、AIが宇宙の運搬ゲームを谷の採鉱対戦に作り変えた。</p><div class="ctas"><a class="action" href="/history/#r04">変化を遊び比べる <i>↗</i></a><a class="action ghost" href="/play">最新版を遊ぶ <i>↗</i></a></div></div>${art}</section>${trailer}
<section class="loop"><div class="wrap steps"><div><em>01</em><div><h2>勝者が書く</h2><p>試合を終えたら、変えてほしいことを一案。</p></div></div><div><em>02</em><div><h2>みんなで選ぶ</h2><p>敗者は、遊んでみたい案に一票。</p></div></div><div><em>03</em><div><h2>AIが実装する</h2><p data-cycle-copy>得票した案から次のゲームを作る。6時間ごとの自動更新を開発中。</p></div></div></div></section>
<section class="wrap showcase"><div class="sectionhead"><h2>提案から生まれた遊び</h2><a href="/history/">履歴をすべて見る ↗</a></div><div class="thumbs">${previews}</div></section>
<section class="now"><div class="wrap now-inner"><div><p>いま遊べるオンラインゲーム</p><h2>谷の採鉱競争</h2></div><p>掘る、奪う、持ち帰る。<br>3分間でいちばん稼いだ人が勝つ。</p><a class="action" href="/play">対戦に参加 <i>↗</i></a></div></section></main>`+foot;
const versionOptions=archive.versions.map(v=>`<option value="${esc(v.playUrl)}">${v.id}　${esc(v.title)}</option>`).join('');
let low=1;
const cards=entries.map((e,i)=>{
  const versions=archive.versions.filter(v=>v.number>=low&&v.number<=e.until);low=e.until+1;
  const props=e.inputs.map(prompt);
  const original=props.filter(p=>p?.originalText).map(p=>`<blockquote>${esc(p.originalText)}</blockquote>`).join('');
  const shotLink = (id, label) => `<a class="patch-image" href="${origin}${id}/" aria-label="${esc(label)}">
    <img width="800" height="450" ${i ? 'loading="lazy"' : ''} src="${img(id)}" alt="${esc(ver(id).title)}">
    <span>▶　${esc(label)}</span>
  </a>`;
  const shot = i === 0
    ? `<div class="first-versions">${shotLink('r03','宇宙船を操る')}${shotLink('r04','谷を歩く')}</div>`
    : shotLink(e.shot, 'この版を遊ぶ');
  return `<article id="${e.shot}" class="patch" data-versions="${versions.map(v=>v.id).join(' ')}">
  ${shot}
  <div class="patch-body"><p class="version">SHIFT ${String(i+1).padStart(2,'0')} <span>/</span> ${versions[0].id.toUpperCase()}–${versions.at(-1).id.toUpperCase()}</p><h2>${esc(e.title)}</h2>${i===0?'<p class="first-idea">'+esc(e.lead)+'</p>':''}<p>${esc(e.body)}</p><details><summary>提案の原文</summary>${original}</details></div></article>`;
}).join('');
const previous=await fs.readFile(new URL('history/index.html',root),'utf8');
const board=previous.match(/<section class="feedback-section"[\s\S]*?<\/section>/)?.[0];
if(!board)throw Error('Missing feedback form');
const history=head('進化の履歴 — WORLDSHIFT','プレイヤーの声で何が変わったか。実際の提案とゲームを並べて辿る。')+nav(true)+`<main id="main"><section class="archive-intro wrap"><p class="eyebrow">WORLDSHIFT / HISTORY</p><h1>進化の履歴<span>.</span></h1><p>ひとつの意見から、ゲームはどう変わったか。</p></section><section class="wrap timeline">${cards}<details class="allversions"><summary>保存版から選んで遊ぶ <span>39 versions</span></summary><form id="archive-pick"><label for="archived">バージョン</label><select id="archived">${versionOptions}</select><button>遊ぶ ↗</button></form></details></section>${board.replace('href="/"','href="/play"').replace('最新版を遊んだら','試合を終えたら')}</main><script type="module" src="/patchplay/history.js"></script>`+foot;
await fs.mkdir(new URL('patchplay/',root),{recursive:true});
await fs.writeFile(new URL('patchplay/index.html',root),home);
await fs.writeFile(new URL('history/index.html',root),history);
