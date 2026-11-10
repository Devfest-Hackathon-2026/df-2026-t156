import { initFeedback } from '/history/feedback.js';
initFeedback();
const pick = document.querySelector('#archive-pick');
pick.addEventListener('submit', event => {
  event.preventDefault();
  location.assign(document.querySelector('#archived').value);
});
const query = new URLSearchParams(location.search);
const version = query.get('version') || (location.hash.match(/^#(r\d+)$/) || [])[1];
if (/^r\d{2}$/.test(version || '')) {
  const card = [...document.querySelectorAll('.patch')].find(el=>el.dataset.versions.split(' ').includes(version));
  if(card) requestAnimationFrame(()=>card.scrollIntoView());
}