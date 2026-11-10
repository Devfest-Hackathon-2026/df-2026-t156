const stage = document.getElementById('game-window');
const shell = document.getElementById('game-shell');
const fullscreen = document.getElementById('fullscreen');

function openGame() {
  const frame = document.createElement('iframe');
  frame.title = '谷の採鉱競争を遊ぶ';
  frame.allow = 'autoplay; fullscreen; gamepad';
  frame.allowFullscreen = true;
  frame.src = '/play';
  frame.addEventListener('load', () => {
    const page = frame.contentWindow.location;
    if (page.pathname.startsWith('/history/')) location.assign(page.href);
  });
  stage.replaceChildren(frame);
}

if (matchMedia('(pointer: fine) and (min-width: 720px)').matches) openGame();
document.getElementById('launch-game')?.addEventListener('click', event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  openGame();
});
fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await shell.requestFullscreen();
  } catch {
    location.assign('/play');
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? '⛶ 元のサイズ' : '⛶ 全画面';
});
