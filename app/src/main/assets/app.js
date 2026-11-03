(function () {
  'use strict';

  var bridge = window.Android || null;

  /* ---------- хранилище: SharedPreferences, с запасным localStorage ---------- */

  var store = {
    get: function (key, def) {
      try {
        var v = bridge ? bridge.load(key) : window.localStorage.getItem(key);
        return (v === null || v === undefined || v === '') ? def : v;
      } catch (e) {
        return def;
      }
    },
    set: function (key, value) {
      try {
        if (bridge) { bridge.save(key, value); } else { window.localStorage.setItem(key, value); }
      } catch (e) { /* не страшно */ }
    }
  };

  /* ---------- разбор номеров ---------- */

  var MAX_NUMBER = 999;

  // убираем то, что номерами точно не является: время, даты, цены, годы
  function cleanText(text) {
    return (' ' + String(text).replace(/\r/g, '') + ' ')
      .replace(/\d{1,2}\s*[.\/]\s*\d{1,2}(\s*[.\/]\s*\d{2,4})?(?!\d)/g, ' ')
      .replace(/\d{1,2}\s*:\s*\d{2}(?!\d)/g, ' ')
      .replace(/\d+\s*(₽|руб\.?|р\.)/gi, ' ')
      .replace(/\d{4,}/g, ' ');
  }

  // все номера строки, с повторами (повтор = вторая такая же наклейка)
  function extractNumbers(line) {
    var s = cleanText(line);
    var out = [];

    // 232(3) — три штуки номера 232, так пишут списки в объявлениях
    s = s.replace(/(\d{1,3})\s*[(\[]\s*(\d{1,2})\s*[)\]]/g, function (m, a, b) {
      var n = +a, q = Math.min(+b, 30);
      if (n >= 1 && n <= MAX_NUMBER) { for (var i = 0; i < q; i++) { out.push(n); } }
      return ' ';
    });

    // 16x2 — две штуки номера 16 (знак × приложение ставит само при упорядочивании)
    s = s.replace(/(\d{1,3})\s*[xх×*]\s*(\d{1,2})/gi, function (m, a, b) {
      var n = +a, q = Math.min(+b, 30);
      if (n >= 1 && n <= MAX_NUMBER) { for (var i = 0; i < q; i++) { out.push(n); } }
      return ' ';
    });

    // 120-130 — диапазон подряд идущих номеров
    s = s.replace(/(\d{1,3})\s*[-–—]\s*(\d{1,3})/g, function (m, a, b) {
      var x = +a, y = +b;
      if (y > x && x >= 1 && y <= MAX_NUMBER) {
        for (var i = x; i <= y; i++) { out.push(i); }
        return ' ';
      }
      return ' ' + a + ' ' + b + ' ';
    });

    var re = /\d{1,3}/g, m2;
    while ((m2 = re.exec(s)) !== null) {
      var n2 = +m2[0];
      if (n2 >= 1 && n2 <= MAX_NUMBER) { out.push(n2); }
    }
    return out;
  }

  // номер -> количество
  function countMap(text) {
    var map = new Map();
    extractNumbers(text).forEach(function (n) { map.set(n, (map.get(n) || 0) + 1); });
    return map;
  }

  function toMap(list) {
    var map = new Map();
    list.forEach(function (n) { map.set(n, (map.get(n) || 0) + 1); });
    return map;
  }

  function sortedKeys(map) {
    return Array.from(map.keys()).sort(function (a, b) { return a - b; });
  }

  // "6, 15, 16×2, 27" — по 10 номеров в строке
  function formatList(map) {
    var parts = sortedKeys(map).map(function (n) {
      var q = map.get(n);
      return q > 1 ? (n + '×' + q) : String(n);
    });
    var lines = [];
    for (var i = 0; i < parts.length; i += 10) {
      lines.push(parts.slice(i, i + 10).join(', '));
    }
    return lines.join('\n');
  }

  /* ---------- разбор чужого сообщения на разделы ---------- */

  var RE_HAVE = /(налич|есть|отда|предлага|свободн|дубл|лишн|меняю|обмен|могу|имею)/i;
  var RE_NEED = /(ищу|ищем|нужн|не\s*хватает|хочу|хотим|разыскива|недоста|интересу|требует)/i;

  // все ключевые слова строки с их позициями, по порядку
  function findMarkers(line) {
    var out = [];
    var m;
    var reHave = new RegExp(RE_HAVE.source, 'gi');
    while ((m = reHave.exec(line)) !== null) { out.push({ pos: m.index, section: 'have' }); }
    var reNeed = new RegExp(RE_NEED.source, 'gi');
    while ((m = reNeed.exec(line)) !== null) { out.push({ pos: m.index, section: 'need' }); }
    return out.sort(function (a, b) { return a.pos - b.pos; });
  }

  // строка режется на куски по ключевым словам: "Ищу 6, 15. В наличии 201" — это два раздела
  function segmentsOf(line, current) {
    var marks = findMarkers(line);
    if (!marks.length) { return [{ section: current, text: line }]; }

    var segments = [];
    if (marks[0].pos > 0) { segments.push({ section: current, text: line.slice(0, marks[0].pos) }); }
    for (var i = 0; i < marks.length; i++) {
      var end = (i + 1 < marks.length) ? marks[i + 1].pos : line.length;
      segments.push({ section: marks[i].section, text: line.slice(marks[i].pos, end) });
    }
    return segments;
  }

  function splitMessage(text) {
    var res = { have: [], need: [], unknown: [] };
    var current = null;

    String(text).split('\n').forEach(function (line) {
      var marks = findMarkers(line);
      var lastWithNumbers = null;

      segmentsOf(line, current).forEach(function (seg) {
        var nums = extractNumbers(seg.text);
        if (!nums.length) { return; }
        var target = seg.section ? res[seg.section] : res.unknown;
        target.push.apply(target, nums);
        if (seg.section) { lastWithNumbers = seg.section; }
      });

      // следующие строки продолжают тот раздел, в котором были номера,
      // а если номеров не было — тот, что заявлен в начале строки
      // ("Мое наличие, посмотрите, что вам нужно" — это про наличие)
      if (lastWithNumbers) { current = lastWithNumbers; }
      else if (marks.length) { current = marks[0].section; }
    });

    return res;
  }

  /* ---------- элементы ---------- */

  function $(id) { return document.getElementById(id); }

  var el = {
    raw: $('raw'), rawWarn: $('raw-warn'),
    theirHave: $('their-have'), theirNeed: $('their-need'),
    theirHaveCount: $('their-have-count'), theirNeedCount: $('their-need-count'),
    getChips: $('get-chips'), giveChips: $('give-chips'),
    getCount: $('get-count'), giveCount: $('give-count'),
    getEmpty: $('get-empty'), giveEmpty: $('give-empty'),
    balance: $('balance'),
    myHave: $('my-have'), myNeed: $('my-need'), owned: $('owned'),
    myHaveCount: $('my-have-count'), myNeedCount: $('my-need-count'),
    albumSize: $('album-size'), albumNote: $('album-note'),
    needListBlock: $('need-list-block'), needAlbumBlock: $('need-album-block'),
    toast: $('toast'),
    albumSelect: $('album-select'),
    modal: $('modal'), modalTitle: $('modal-title'), modalText: $('modal-text'),
    modalInput: $('modal-input'), modalOk: $('modal-ok'), modalCancel: $('modal-cancel')
  };

  /* ---------- мелкие помощники интерфейса ---------- */

  var toastTimer = null;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  var modalAction = null;
  function confirmBox(title, text, onOk) {
    el.modalTitle.textContent = title;
    el.modalText.textContent = text;
    el.modalInput.hidden = true;
    el.modalOk.textContent = 'Да';
    modalAction = onOk;
    el.modal.hidden = false;
  }

  // то же окно, но с полем ввода — для названий альбомов
  function promptBox(title, text, value, onOk) {
    el.modalTitle.textContent = title;
    el.modalText.textContent = text;
    el.modalInput.hidden = false;
    el.modalOk.textContent = 'Сохранить';
    el.modalInput.value = value || '';
    modalAction = function () { onOk(el.modalInput.value.trim()); };
    el.modal.hidden = false;
    el.modalInput.focus();
  }

  function closeModal() { el.modal.hidden = true; modalAction = null; }

  function renderChips(node, numbers) {
    node.textContent = '';
    numbers.forEach(function (n) {
      var span = document.createElement('span');
      span.className = 'chip';
      span.textContent = n;
      node.appendChild(span);
    });
  }

  function makeBtn(label, onClick) {
    var b = document.createElement('button');
    b.className = 'btn';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- режим списка «мне нужно» ---------- */

  function isAlbumMode() {
    var checked = document.querySelector('input[name=needmode]:checked');
    return !!checked && checked.value === 'album';
  }

  // что мне нужно: либо прямой список, либо «весь альбом минус вклеенные»
  function myNeedSet() {
    if (!isAlbumMode()) {
      return new Set(countMap(el.myNeed.value).keys());
    }
    var size = Math.max(1, Math.min(999, parseInt(el.albumSize.value, 10) || 0));
    var owned = countMap(el.owned.value);
    var set = new Set();
    for (var i = 1; i <= size; i++) {
      if (!owned.has(i)) { set.add(i); }
    }
    return set;
  }

  /* ---------- главный пересчёт ---------- */

  var lastGet = [], lastGive = [];

  function balanceText(g, v, myHaveSize, myNeedSize) {
    if (myHaveSize === 0 && myNeedSize === 0) {
      return 'Сначала заполните свои списки на вкладке <b>«Мои наклейки»</b>.';
    }
    if (g === 0 && v === 0) { return 'Совпадений нет — обмениваться нечем.'; }
    if (g === 0) { return 'Вам у него брать нечего, а ему от вас подходит <b>' + v + '</b>.'; }
    if (v === 0) { return 'Вам подходит <b>' + g + '</b>, но отдать взамен нечего.'; }
    if (g === v) { return 'Ровный обмен <b>' + g + '</b> на <b>' + v + '</b>.'; }
    return g > v
      ? 'Берёте <b>' + g + '</b>, отдаёте <b>' + v + '</b> — получаете на ' + (g - v) + ' больше.'
      : 'Берёте <b>' + g + '</b>, отдаёте <b>' + v + '</b> — отдаёте на ' + (v - g) + ' больше.';
  }

  function update() {
    var theirHave = countMap(el.theirHave.value);
    var theirNeed = countMap(el.theirNeed.value);
    var myHave = countMap(el.myHave.value);
    var myNeed = myNeedSet();

    el.theirHaveCount.textContent = theirHave.size;
    el.theirNeedCount.textContent = theirNeed.size;
    el.myHaveCount.textContent = myHave.size;
    el.myNeedCount.textContent = myNeed.size;

    if (isAlbumMode()) {
      var ownedCount = countMap(el.owned.value).size;
      el.albumNote.textContent = 'Вклеено ' + ownedCount + ', не хватает ' + myNeed.size + '.';
    }

    lastGet = sortedKeys(theirHave).filter(function (n) { return myNeed.has(n); });
    lastGive = sortedKeys(myHave).filter(function (n) { return theirNeed.has(n); });

    el.getCount.textContent = lastGet.length;
    el.giveCount.textContent = lastGive.length;
    renderChips(el.getChips, lastGet);
    renderChips(el.giveChips, lastGive);
    el.getEmpty.hidden = lastGet.length > 0;
    el.giveEmpty.hidden = lastGive.length > 0;

    el.balance.innerHTML = balanceText(lastGet.length, lastGive.length, myHave.size, myNeed.size);
  }

  /* ---------- альбомы ---------- */

  // У каждого альбома свой набор списков: ключи вида "a.<id>.my.have".
  var ALBUM_KEYS = ['my.have', 'my.need', 'my.owned', 'my.mode', 'my.size',
    'their.have', 'their.need', 'raw'];

  var albums = [];
  var currentAlbum = '';

  function akey(name) { return 'a.' + currentAlbum + '.' + name; }

  function newAlbumId() {
    return 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  function saveAlbums() {
    store.set('albums', JSON.stringify(albums));
    store.set('album.current', currentAlbum);
  }

  // первый запуск новой версии: списки, которые велись до альбомов, переносим в первый альбом
  function createFirstAlbum() {
    var id = newAlbumId();
    var old = {
      'my.have': store.get('my.have', ''),
      'my.need': store.get('my.need', ''),
      'my.owned': store.get('my.owned', ''),
      'my.mode': store.get('my.mode', 'list'),
      'my.size': store.get('my.album', '460')
    };
    var hadLists = !!(old['my.have'] || old['my.need'] || old['my.owned']);
    if (hadLists) {
      Object.keys(old).forEach(function (k) { store.set('a.' + id + '.' + k, old[k]); });
    }
    return [{ id: id, name: hadLists ? 'Мой альбом' : 'Альбом 1' }];
  }

  function loadAlbums() {
    var raw = store.get('albums', '');
    if (raw) {
      try { albums = JSON.parse(raw) || []; } catch (e) { albums = []; }
    }
    if (!albums.length) {
      albums = createFirstAlbum();
      currentAlbum = albums[0].id;
      saveAlbums();
      return;
    }
    currentAlbum = store.get('album.current', '');
    var known = albums.some(function (a) { return a.id === currentAlbum; });
    if (!known) {
      currentAlbum = albums[0].id;
      store.set('album.current', currentAlbum);
    }
  }

  function renderAlbums() {
    el.albumSelect.textContent = '';
    albums.forEach(function (album) {
      var option = document.createElement('option');
      option.value = album.id;
      option.textContent = album.name;
      if (album.id === currentAlbum) { option.selected = true; }
      el.albumSelect.appendChild(option);
    });
  }

  function switchAlbum(id) {
    flushSave();
    currentAlbum = id;
    store.set('album.current', id);
    restore();
    update();
  }

  function addAlbum() {
    promptBox('Новый альбом', 'Например: ЧМ 2026 или EURO 2025/2026', '', function (name) {
      if (!name) { toast('Нужно название'); return; }
      flushSave();   // списки текущего альбома — на диск, пока не переключились
      var album = { id: newAlbumId(), name: name };
      albums.push(album);
      currentAlbum = album.id;
      saveAlbums();
      renderAlbums();
      restore();
      update();
      toast('Альбом «' + name + '» добавлен');
    });
  }

  function renameAlbum() {
    var album = albums.filter(function (a) { return a.id === currentAlbum; })[0];
    if (!album) { return; }
    promptBox('Название альбома', 'Как его называть в списке', album.name, function (name) {
      if (!name) { toast('Нужно название'); return; }
      album.name = name;
      saveAlbums();
      renderAlbums();
    });
  }

  function deleteAlbum() {
    if (albums.length < 2) { toast('Это единственный альбом'); return; }
    var album = albums.filter(function (a) { return a.id === currentAlbum; })[0];
    if (!album) { return; }
    confirmBox('Удалить альбом?', 'Списки альбома «' + album.name + '» будут стёрты.', function () {
      ALBUM_KEYS.forEach(function (name) {
        if (bridge && bridge.remove) { bridge.remove(akey(name)); } else { store.set(akey(name), ''); }
      });
      albums = albums.filter(function (a) { return a.id !== album.id; });
      currentAlbum = albums[0].id;
      saveAlbums();
      renderAlbums();
      restore();
      update();
      toast('Альбом удалён');
    });
  }

  /* ---------- сохранение ---------- */

  var saveTimer = null;

  function saveAll() {
    store.set(akey('my.have'), el.myHave.value);
    store.set(akey('my.need'), el.myNeed.value);
    store.set(akey('my.owned'), el.owned.value);
    store.set(akey('my.size'), String(el.albumSize.value));
    store.set(akey('my.mode'), isAlbumMode() ? 'album' : 'list');
    store.set(akey('their.have'), el.theirHave.value);
    store.set(akey('their.need'), el.theirNeed.value);
    store.set(akey('raw'), el.raw.value);
  }

  function touch() {
    update();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveAll, 300);
  }

  // записать немедленно: приложение сворачивают или закрывают, отложенной записи может не хватить
  function flushSave() {
    clearTimeout(saveTimer);
    saveAll();
    if (bridge && bridge.flush) { bridge.flush(); }
  }
  window.flushSave = flushSave;

  function applyMode() {
    var album = isAlbumMode();
    el.needListBlock.hidden = album;
    el.needAlbumBlock.hidden = !album;
  }

  function restore() {
    el.myHave.value = store.get(akey('my.have'), '');
    el.myNeed.value = store.get(akey('my.need'), '');
    el.owned.value = store.get(akey('my.owned'), '');
    el.albumSize.value = store.get(akey('my.size'), '460');
    el.theirHave.value = store.get(akey('their.have'), '');
    el.theirNeed.value = store.get(akey('their.need'), '');
    el.raw.value = store.get(akey('raw'), '');
    el.rawWarn.hidden = true;
    var mode = store.get(akey('my.mode'), 'list');
    var radio = document.querySelector('input[name=needmode][value="' + mode + '"]');
    if (radio) { radio.checked = true; }
    applyMode();
  }

  /* ---------- действия ---------- */

  function parseRaw() {
    var text = el.raw.value;
    if (!text.trim()) { toast('Сначала вставьте сообщение'); return; }

    var parts = splitMessage(text);
    var unknown = parts.unknown;

    if (!parts.have.length && !parts.need.length && !unknown.length) {
      el.rawWarn.hidden = false;
      el.rawWarn.textContent = 'Номеров в сообщении не нашлось.';
      return;
    }

    el.theirHave.value = formatList(toMap(parts.have));
    el.theirNeed.value = formatList(toMap(parts.need));

    if (unknown.length) {
      // не поняли, к чему относятся номера — спрашиваем у человека
      el.rawWarn.hidden = false;
      el.rawWarn.textContent = '';
      var p = document.createElement('div');
      p.textContent = 'Не понял, к чему относятся ' + new Set(unknown).size +
        ' номеров: в сообщении нет слов вроде «ищу» или «в наличии».';
      var row = document.createElement('div');
      row.className = 'row';
      row.appendChild(makeBtn('Это у него есть', function () {
        el.theirHave.value = formatList(toMap(parts.have.concat(unknown)));
        el.rawWarn.hidden = true;
        touch();
      }));
      row.appendChild(makeBtn('Это он ищет', function () {
        el.theirNeed.value = formatList(toMap(parts.need.concat(unknown)));
        el.rawWarn.hidden = true;
        touch();
      }));
      el.rawWarn.appendChild(p);
      el.rawWarn.appendChild(row);
    } else {
      el.rawWarn.hidden = true;
      toast('Разобрано: есть ' + new Set(parts.have).size + ', ищет ' + new Set(parts.need).size);
    }

    touch();
  }

  function answerText() {
    var lines = [];
    if (lastGet.length) {
      lines.push('Мне нужно от вас (' + lastGet.length + '): ' + lastGet.join(', '));
    }
    if (lastGive.length) {
      lines.push('Могу отдать вам (' + lastGive.length + '): ' + lastGive.join(', '));
    }
    if (!lines.length) { return 'Совпадений не нашлось, в этот раз меняться нечем.'; }
    return lines.join('\n\n');
  }

  function applyExchange() {
    // полученные уходят из «мне нужно» (или становятся вклеенными), отданные — из «лишних»
    if (isAlbumMode()) {
      var owned = countMap(el.owned.value);
      lastGet.forEach(function (n) { if (!owned.has(n)) { owned.set(n, 1); } });
      el.owned.value = formatList(owned);
    } else {
      var need = countMap(el.myNeed.value);
      lastGet.forEach(function (n) { need.delete(n); });
      el.myNeed.value = formatList(need);
    }

    var have = countMap(el.myHave.value);
    lastGive.forEach(function (n) {
      var q = have.get(n);
      if (!q) { return; }
      if (q > 1) { have.set(n, q - 1); } else { have.delete(n); }
    });
    el.myHave.value = formatList(have);

    el.raw.value = '';
    el.theirHave.value = '';
    el.theirNeed.value = '';
    el.rawWarn.hidden = true;
    touch();
    saveAll();
    toast('Списки обновлены');
  }

  function copyText(text) {
    if (bridge && bridge.copy) {
      bridge.copy(text);
      toast('Скопировано');
      return;
    }
    try {
      navigator.clipboard.writeText(text);
      toast('Скопировано');
    } catch (e) {
      toast('Не удалось скопировать');
    }
  }

  function sendText(text) {
    if (bridge && bridge.share) { bridge.share(text); } else { copyText(text); }
  }

  /* ---------- вкладки ---------- */

  var currentTab = 'exchange';

  function showTab(name) {
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('is-active', tabs[i].getAttribute('data-tab') === name);
    }
    var pages = document.querySelectorAll('.page');
    for (var j = 0; j < pages.length; j++) {
      pages[j].classList.toggle('is-active', pages[j].id === 'page-' + name);
    }
    window.scrollTo(0, 0);
    currentTab = name;
  }

  /* ---------- подписки ---------- */

  el.modalCancel.addEventListener('click', closeModal);
  el.modalOk.addEventListener('click', function () {
    var action = modalAction;
    closeModal();
    if (action) { action(); }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
  });

  [el.raw, el.theirHave, el.theirNeed, el.myHave, el.myNeed, el.owned, el.albumSize]
    .forEach(function (node) {
      node.addEventListener('input', touch);
      node.addEventListener('blur', flushSave);
    });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { flushSave(); }
  });
  window.addEventListener('pagehide', flushSave);

  Array.prototype.forEach.call(document.querySelectorAll('input[name=needmode]'), function (r) {
    r.addEventListener('change', function () { applyMode(); touch(); });
  });

  $('btn-paste').addEventListener('click', function () {
    if (!bridge || !bridge.paste) { toast('Вставьте сообщение вручную'); return; }
    var text = bridge.paste();
    if (!text) { toast('Буфер обмена пуст'); return; }
    el.raw.value = text;
    parseRaw();
  });

  $('btn-parse').addEventListener('click', parseRaw);

  $('btn-clear-raw').addEventListener('click', function () {
    el.raw.value = '';
    el.theirHave.value = '';
    el.theirNeed.value = '';
    el.rawWarn.hidden = true;
    touch();
  });

  $('btn-answer').addEventListener('click', function () { sendText(answerText()); });

  $('btn-done').addEventListener('click', function () {
    if (!lastGet.length && !lastGive.length) { toast('Нечего записывать'); return; }
    confirmBox('Записать обмен?',
      'Получите ' + lastGet.length + ', отдадите ' + lastGive.length + '. Списки изменятся.',
      applyExchange);
  });

  $('btn-tidy-have').addEventListener('click', function () {
    el.myHave.value = formatList(countMap(el.myHave.value));
    touch();
    toast('Упорядочено');
  });

  $('btn-tidy-need').addEventListener('click', function () {
    el.myNeed.value = formatList(countMap(el.myNeed.value));
    touch();
    toast('Упорядочено');
  });

  $('btn-send-have').addEventListener('click', function () {
    var list = sortedKeys(countMap(el.myHave.value));
    if (!list.length) { toast('Список пуст'); return; }
    sendText('Мои лишние (' + list.length + '): ' + list.join(', '));
  });

  $('btn-send-need').addEventListener('click', function () {
    var list = Array.from(myNeedSet()).sort(function (a, b) { return a - b; });
    if (!list.length) { toast('Список пуст'); return; }
    sendText('Ищу (' + list.length + '): ' + list.join(', '));
  });

  /* ---------- интеграция с Android ---------- */

  window.onAndroidBack = function () {
    if (!el.modal.hidden) { closeModal(); return true; }
    if (currentTab !== 'exchange') { showTab('exchange'); return true; }
    return false;
  };

  // системные полосы: отступы приходят из MainActivity в dp
  window.applyInsets = function (top, right, bottom, left) {
    var s = document.documentElement.style;
    s.setProperty('--inset-top', top + 'px');
    s.setProperty('--inset-right', right + 'px');
    s.setProperty('--inset-bottom', bottom + 'px');
    s.setProperty('--inset-left', left + 'px');
  };

  function readInsets() {
    if (!bridge || !bridge.insets) { return; }
    var parts = String(bridge.insets()).split(',');
    if (parts.length === 4) {
      window.applyInsets(+parts[0] || 0, +parts[1] || 0, +parts[2] || 0, +parts[3] || 0);
    }
  }

  // на светлой теме значки в системных полосах должны быть тёмными
  function reportTheme() {
    if (bridge && bridge.setDarkBarIcons) {
      bridge.setDarkBarIcons(window.matchMedia('(prefers-color-scheme: light)').matches);
    }
  }

  window.onSharedText = function () {
    if (!bridge || !bridge.takeSharedText) { return; }
    var text = bridge.takeSharedText();
    if (!text) { return; }
    showTab('exchange');
    el.raw.value = text;
    parseRaw();
  };

  // для автотестов разбора (tools/parser-test.js)
  window.__parser = {
    extractNumbers: extractNumbers,
    splitMessage: splitMessage,
    countMap: countMap,
    formatList: formatList
  };

  el.albumSelect.addEventListener('change', function () { switchAlbum(el.albumSelect.value); });
  $('btn-album-new').addEventListener('click', addAlbum);
  $('btn-album-rename').addEventListener('click', renameAlbum);
  $('btn-album-delete').addEventListener('click', deleteAlbum);

  /* ---------- старт ---------- */

  loadAlbums();
  renderAlbums();
  restore();
  update();
  readInsets();
  reportTheme();
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', reportTheme);
  } catch (e) { /* старый движок — тема не переключится на лету */ }
  window.onSharedText();
})();
