(function () {
  'use strict';

  var STALE_AFTER_DAYS = 10;
  var DAY_MS = 24 * 60 * 60 * 1000;
  var scriptSrc = document.currentScript && document.currentScript.src;
  var DATA_URL = scriptSrc ? new URL('trends.json', scriptSrc).href : '/content/trends.json';

  var STAGES = {
    early: { label: 'Early \u2014 post now', className: 'badge-early' },
    rising: { label: 'Rising \u2014 post this week', className: 'badge-rising' }
  };

  var TRAJECTORIES = {
    rising: { arrow: '\u2197', label: 'Rising' },
    peaking: { arrow: '\u2192', label: 'Peaking' },
    fading: { arrow: '\u2198', label: 'Fading' }
  };

  var SAFETY = {
    yes: { label: 'Business-safe', className: 'safe-yes' },
    check: { label: 'Check first', className: 'safe-check' },
    no: { label: 'Not business-safe', className: 'safe-no' }
  };

  var FILTER_NAMES = { all: 'all platforms', tiktok: 'TikTok', reels: 'Instagram Reels' };

  var currentFilter = 'all';

  function $(id) {
    return document.getElementById(id);
  }

  function str(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
  }

  function append(parent) {
    for (var i = 1; i < arguments.length; i++) {
      if (arguments[i]) parent.appendChild(arguments[i]);
    }
    return parent;
  }

  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      var url = new URL(value.trim());
      return url.protocol === 'https:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function externalLink(label, url, className) {
    var href = safeUrl(url);
    if (!href) return null;
    var a = el('a', className, label || new URL(href).hostname);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    append(a, el('span', 'visually-hidden', ' (opens in a new tab)'));
    return a;
  }

  function parseDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(value));
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getMonth() !== Number(match[2]) - 1) return null;
    return date;
  }

  function today() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function daysFromToday(date) {
    return Math.round((date - today()) / DAY_MS);
  }

  function formatDate(date, withYear) {
    var options = { weekday: 'short', month: 'short', day: 'numeric' };
    if (withYear) options.year = 'numeric';
    return date.toLocaleDateString('en-US', options);
  }

  function relativeDays(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    return days > 0 ? 'in ' + days + ' days' : Math.abs(days) + ' days ago';
  }

  function platformKey(name) {
    var value = str(name).toLowerCase();
    if (value === 'both') return ['tiktok', 'reels'];
    if (value.indexOf('tiktok') !== -1) return ['tiktok'];
    if (value.indexOf('instagram') !== -1 || value.indexOf('reels') !== -1) return ['reels'];
    return [];
  }

  function platformKeys(names) {
    var keys = [];
    list(names).forEach(function (name) {
      platformKey(name).forEach(function (key) {
        if (keys.indexOf(key) === -1) keys.push(key);
      });
    });
    return keys;
  }

  function platformTags(names) {
    var labels = list(names).map(str).filter(Boolean);
    if (!labels.length) return null;
    var ul = el('ul', 'platforms');
    ul.setAttribute('aria-label', 'Platforms');
    labels.forEach(function (label) {
      var key = platformKey(label);
      append(ul, el('li', 'tag' + (key.length === 1 ? ' tag-' + key[0] : ''), label));
    });
    return ul;
  }

  function linkList(links) {
    var items = list(links)
      .map(function (link) {
        return link && typeof link === 'object' ? externalLink(str(link.label), link.url, 'pill-link') : null;
      })
      .filter(Boolean);
    if (!items.length) return null;
    var ul = el('ul', 'links');
    items.forEach(function (a) {
      append(ul, append(el('li'), a));
    });
    return ul;
  }

  function facts(pairs) {
    var dl = el('dl', 'facts');
    pairs.forEach(function (pair) {
      if (!pair[1]) return;
      append(dl, el('dt', null, pair[0]), el('dd', null, pair[1]));
    });
    return dl.childNodes.length ? dl : null;
  }

  function setEmpty(container, isEmpty) {
    var next = container.nextElementSibling;
    if (next && next.classList.contains('empty')) next.hidden = !isEmpty;
  }

  function renderHeader(data) {
    var updated = parseDate(data.lastUpdated);
    var next = parseDate(data.nextRefresh);

    $('last-updated').textContent = updated ? formatDate(updated, true) : 'Unknown';

    if (next) {
      var daysUntil = daysFromToday(next);
      $('next-refresh').textContent =
        formatDate(next, true) + (daysUntil < 0 ? ' (overdue)' : ' (' + relativeDays(daysUntil) + ')');
    } else {
      $('next-refresh').textContent = 'Unknown';
    }

    var headline = str(data.headline);
    $('headline').textContent = headline;
    $('headline').hidden = !headline;

    var stale = $('stale-notice');
    if (!updated) {
      stale.textContent = "Heads up: we can't tell when this was last updated, so some trends may have moved on. Double-check before posting.";
      stale.hidden = false;
    } else {
      var age = -daysFromToday(updated);
      if (age > STALE_AFTER_DAYS) {
        stale.textContent =
          'Heads up: this may be stale. It was last updated ' + age + ' days ago, so some trends may have moved on. Double-check before posting.';
        stale.hidden = false;
      } else {
        stale.hidden = true;
      }
    }
  }

  function renderUpcoming(items) {
    var container = $('upcoming-list');
    container.textContent = '';
    items.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var stageKey = str(item.stage).toLowerCase();
      var stage = STAGES[stageKey] || { label: str(item.stage) || 'Trend', className: 'badge-neutral' };
      var card = el('article', 'card trend-card');
      card.setAttribute('data-platforms', platformKeys(item.platforms).join(' '));

      var top = append(el('div', 'card-top'), el('span', 'badge ' + stage.className, stage.label));
      var postBy = parseDate(item.postBy);
      if (postBy) {
        var days = daysFromToday(postBy);
        var text;
        var cls = 'post-by';
        if (days < 0) {
          text = 'Post-by date passed (' + formatDate(postBy) + ')';
          cls += ' is-late';
        } else if (days === 0) {
          text = 'Post today';
          cls += ' is-soon';
        } else {
          text = 'Post by ' + formatDate(postBy) + ' \u00b7 ' + days + (days === 1 ? ' day left' : ' days left');
          if (days <= 3) cls += ' is-soon';
        }
        append(top, el('span', cls, text));
      }

      append(card, top, el('h3', null, str(item.name) || 'Untitled trend'), platformTags(item.platforms));
      append(card, facts([
        ['The signal', str(item.signal)],
        ['What it is', str(item.whatItIs)]
      ]));

      var idea = str(item.coffeeShopIdea);
      if (idea) {
        append(card, append(el('div', 'idea'), el('p', 'idea-label', 'Bucket & the Bean idea'), el('p', null, idea)));
      }

      var firstSeen = parseDate(item.firstSeen);
      if (firstSeen) append(card, el('p', 'meta', 'First spotted ' + formatDate(firstSeen, true)));

      append(card, linkList(item.links));
      append(container, card);
    });
  }

  function renderTailEnd(items) {
    var container = $('tail-end-list');
    container.textContent = '';
    items.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var li = el('li', 'fade-item');
      append(li, append(el('div', 'fade-head'), el('h3', null, str(item.name) || 'Untitled trend'), platformTags(item.platforms)));
      var why = str(item.whyItsFading);
      if (why) append(li, el('p', null, why));
      append(li, linkList(item.links));
      append(container, li);
    });
  }

  function listenLabel(url) {
    var href = safeUrl(url);
    if (!href) return '';
    var host = new URL(href).hostname;
    if (/(^|\.)tiktok\.com$/.test(host)) return 'Listen on TikTok';
    if (/(^|\.)instagram\.com$/.test(host)) return 'Listen on Instagram';
    return 'Listen';
  }

  function renderMusic(items) {
    var container = $('music-list');
    container.textContent = '';
    items.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var card = el('article', 'card music-card');
      var platform = str(item.platform);
      card.setAttribute('data-platforms', platformKey(platform).join(' '));

      var top = el('div', 'card-top');
      var trajectory = TRAJECTORIES[str(item.trajectory).toLowerCase()];
      if (trajectory) {
        var trend = el('span', 'trajectory trajectory-' + trajectory.label.toLowerCase());
        var arrow = el('span', 'arrow', trajectory.arrow);
        arrow.setAttribute('aria-hidden', 'true');
        append(trend, arrow, document.createTextNode(' ' + trajectory.label));
        append(top, trend);
      }
      var safety = SAFETY[str(item.businessAccountSafe).toLowerCase()] || SAFETY.check;
      append(top, el('span', 'safe ' + safety.className, safety.label));

      var platformNames = platform.toLowerCase() === 'both' ? ['TikTok', 'Instagram Reels'] : [platform];
      var artist = str(item.artist);
      append(card, top, el('h3', null, str(item.title) || 'Untitled'), artist ? el('p', 'artist', artist) : null, platformTags(platformNames));

      var stats = str(item.stats);
      if (stats) append(card, el('p', 'stats', stats));

      append(card, facts([
        ['Vibe', str(item.vibe)],
        ['How we could use it', str(item.coffeeShopUse)]
      ]));

      var link = externalLink(listenLabel(item.link), item.link, 'pill-link');
      if (link) append(card, append(el('p', 'listen'), link));

      append(container, card);
    });
  }

  function renderCalendar(items) {
    var container = $('calendar-list');
    container.textContent = '';
    items
      .filter(function (item) {
        return item && typeof item === 'object';
      })
      .map(function (item) {
        return { item: item, date: parseDate(item.date) };
      })
      .sort(function (a, b) {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date - b.date;
      })
      .forEach(function (entry) {
        var item = entry.item;
        var date = entry.date;
        var li = el('li', 'cal-item');
        var badge = el(date ? 'time' : 'span', 'cal-date');
        if (date) {
          badge.setAttribute('datetime', str(item.date));
          append(badge, el('span', 'cal-month', date.toLocaleDateString('en-US', { month: 'short' })), el('span', 'cal-day', String(date.getDate())));
        } else {
          append(badge, el('span', 'cal-month', 'TBD'));
        }

        var body = append(el('div', 'cal-body'), el('h3', null, str(item.name) || 'Untitled date'));
        if (date) {
          var days = daysFromToday(date);
          if (days < 0) li.classList.add('is-past');
          append(body, el('p', 'cal-when', date.toLocaleDateString('en-US', { weekday: 'long' }) + ' \u00b7 ' + (days < 0 ? 'passed' : relativeDays(days))));
        }
        var idea = str(item.idea);
        if (idea) append(body, el('p', null, idea));

        append(container, append(li, badge, body));
      });
  }

  function renderTips(items) {
    var container = $('tips-list');
    container.textContent = '';
    items.map(str).filter(Boolean).forEach(function (tip) {
      append(container, el('li', null, tip));
    });
  }

  function renderSources(items) {
    var container = $('sources-list');
    container.textContent = '';
    items.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var link = externalLink(str(item.label), item.url);
      if (!link) return;
      var li = append(el('li'), link);
      var checked = parseDate(item.checked);
      if (checked) append(li, el('span', 'checked', ' \u00b7 checked ' + formatDate(checked, true)));
      append(container, li);
    });
  }

  function applyFilter(filter) {
    currentFilter = FILTER_NAMES[filter] ? filter : 'all';
    document.querySelectorAll('.chip[data-filter]').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('data-filter') === currentFilter));
    });

    var counts = [];
    document.querySelectorAll('[data-filterable]').forEach(function (section) {
      var grid = section.querySelector('.card-grid');
      var visible = 0;
      grid.querySelectorAll('[data-platforms]').forEach(function (card) {
        var platforms = card.getAttribute('data-platforms').split(' ');
        var show = currentFilter === 'all' || platforms.indexOf(currentFilter) !== -1;
        card.hidden = !show;
        if (show) visible++;
      });
      setEmpty(grid, visible === 0);
      counts.push(visible);
    });

    $('filter-status').textContent =
      'Showing ' + counts[0] + (counts[0] === 1 ? ' trend' : ' trends') + ' and ' + counts[1] + (counts[1] === 1 ? ' song' : ' songs') + ' for ' + FILTER_NAMES[currentFilter] + '.';
  }

  function render(data) {
    renderHeader(data);

    var sections = [
      ['upcoming-list', renderUpcoming, data.upcoming],
      ['tail-end-list', renderTailEnd, data.tailEnd],
      ['music-list', renderMusic, data.music],
      ['calendar-list', renderCalendar, data.calendar],
      ['tips-list', renderTips, data.howToSpotEarly],
      ['sources-list', renderSources, data.sources]
    ];
    sections.forEach(function (section) {
      var container = $(section[0]);
      try {
        section[1](list(section[2]));
      } catch (e) {
        container.textContent = '';
        console.warn('Could not render ' + section[0], e);
      }
      setEmpty(container, !container.children.length);
    });

    applyFilter(currentFilter);
  }

  function showState(state) {
    $('loading').hidden = state !== 'loading';
    $('error').hidden = state !== 'error';
    $('content').hidden = state !== 'ready';
  }

  function load() {
    showState('loading');
    fetch(DATA_URL, { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected data format');
        render(data);
        showState('ready');
      })
      .catch(function (error) {
        console.warn('Could not load trends:', error);
        showState('error');
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.chip[data-filter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        applyFilter(chip.getAttribute('data-filter'));
      });
    });
    $('retry').addEventListener('click', load);
    load();
  });
})();
