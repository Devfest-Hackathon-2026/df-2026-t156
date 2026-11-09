mergeInto(LibraryManager.library, {
  OrbitFeedbackIdentity: function (fallback) {
    var previous = UTF8ToString(fallback), key = '';
    try { key = localStorage.getItem('valley-improvement-key') || ''; } catch (_) {}
    // Existing Unity PlayerPrefs may predate the history page. Preserve those
    // earned rights rather than replacing them with a key created by a page view.
    if (/^[a-f0-9]{64}$/.test(previous)) key = previous;
    if (!/^[a-f0-9]{64}$/.test(key)) {
      key = previous;
      if (!/^[a-f0-9]{64}$/.test(key)) {
        var bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
        key = Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      }
      try { localStorage.setItem('valley-improvement-key', key); } catch (_) {}
    }
    try { localStorage.setItem('valley-improvement-key', key); } catch (_) {}
    var size = lengthBytesUTF8(key) + 1, buffer = _malloc(size);
    stringToUTF8(key, buffer, size); return buffer;
  },
  OrbitOpenHistory: function () { window.location.assign('/history/'); },
  OrbitFeedbackEditor: function (x, y, width, height, value) {
    var area = document.getElementById('valley-improvement-input');
    var draft = UTF8ToString(value);
    if (!area) {
      area = document.createElement('textarea');
      area.id = 'valley-improvement-input';
      area.setAttribute('aria-label', '改善案');
      area.placeholder = '次の試合で変えてみたいこと（180文字まで）';
      area.maxLength = 180;
      area.value = draft;
      area.style.cssText = 'position:fixed;z-index:20;box-sizing:border-box;resize:none;border:1px solid #9caaa1;border-radius:0;background:#fffdf7;color:#21312c;padding:8px 10px;font-family:system-ui,sans-serif;line-height:1.5;outline-offset:2px;';
      area.addEventListener('input', function () { SendMessage('OrbitClient', 'FeedbackDraftChanged', area.value); });
      area.addEventListener('keydown', function (event) {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); SendMessage('OrbitClient', 'FeedbackClose', ''); }
      });
      area.addEventListener('keyup', function (event) { event.stopPropagation(); });
      document.body.appendChild(area);
    }
    var bounds = Module.canvas.getBoundingClientRect();
    area.style.left = (bounds.left + x * bounds.width) + 'px';
    area.style.top = (bounds.top + y * bounds.height) + 'px';
    area.style.width = width * bounds.width + 'px';
    area.style.height = height * bounds.height + 'px';
    area.style.fontSize = Math.max(14, height * bounds.height * 18 / 70) + 'px';
    if (document.activeElement !== area && area.value !== draft) area.value = draft;
  },
  OrbitFeedbackHide: function () {
    var area = document.getElementById('valley-improvement-input');
    if (area) { area.remove(); Module.canvas.focus(); }
  }
});
