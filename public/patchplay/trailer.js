const opener = document.getElementById('trailer-link');
const dialog = document.getElementById('trailer');
const player = dialog.querySelector('iframe');

opener.addEventListener('click', event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !dialog.showModal) return;
  event.preventDefault();
  player.src = player.dataset.src;
  dialog.showModal();
});

dialog.addEventListener('close', () => player.removeAttribute('src'));
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});