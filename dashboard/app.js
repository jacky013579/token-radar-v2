// Token Radar v2 — the board's behaviour: sort, filter, search, detail view.
// Reads window.RADAR from data.js (written beside this page by main.ts).
// No network: every value on the page comes from that one object.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !Array.isArray(R.rows)) {
    document.getElementById('rows').innerHTML = '<tr><td colspan="8">No radar data loaded.</td></tr>';
    return;
  }

  var rows = R.rows;
  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'rank',
    selected: params.get('slug') || null,
  };

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(g) {
    if (g === null || g === undefined) return '—';
    var s = (g > 0 ? '+' : '') + g.toFixed(1) + '%';
    return '<span class="' + (g >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  }
  function age(a) {
    if (a === null || a === undefined) return '—';
    if (a < 1) return Math.round(a * 12) + 'mo';
    return a.toFixed(1) + 'y';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- header stats -------------------------------------------------------
  var top = rows[0];
  var med = rows[Math.floor(rows.length / 2)];
  var wlCount = rows.filter(function (r) { return r.watchlist; }).length;
  document.getElementById('stats').innerHTML =
    stat(money(top.implied_value_usd), 'Top implied value'),
    stat(money(med.implied_value_usd), 'Median implied value') +
    stat(String(rows.length), 'Protocols ranked') +
    stat(wlCount + ' of ' + R.watchlist_size, 'Watchlist covered');
  function stat(b, label) {
    return '<div class="stat"><b>' + b + '</b><span>' + label + '</span></div>';
  }

  // ---- model card ---------------------------------------------------------
  var c = R.calibration;
  document.getElementById('model-text').textContent =
    'The model is a log-space regression fitted on the snapshot\u2019s own ' + c.trained_on +
    ' tokenised protocols (R\u00B2 ' + c.r_squared.toFixed(2) + '): log(market cap) on log(TVL), log(age) and log(chains), ' +
    'plus a shrunk category offset and a bounded momentum tilt from seven-day TVL growth (at most \u00B115%). ' +
    'Every protocol on the board records no token in the snapshot and is not a wrapped, staked or bridged product; ' +
    'the watchlist\u2019s $50M floor is not applied, so smaller early protocols rank alongside it.';

  // ---- category options ---------------------------------------------------
  var cats = [];
  rows.forEach(function (r) {
    var cat = r.category || 'Uncategorised';
    if (cats.indexOf(cat) < 0) cats.push(cat);
  });
  cats.sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (cat) {
    var o = document.createElement('option');
    o.value = cat;
    o.textContent = cat;
    catSel.appendChild(o);
  });

  // ---- controls -----------------------------------------------------------
  var qEl = document.getElementById('q');
  var sortEl = document.getElementById('sort');
  var watchEl = document.getElementById('watch');
  qEl.value = state.q;
  catSel.value = state.cat;
  sortEl.value = state.sort;
  watchEl.checked = state.watch;
  qEl.addEventListener('input', function () { state.q = qEl.value; render(); });
  catSel.addEventListener('change', function () { state.cat = catSel.value; render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; render(); });
  watchEl.addEventListener('change', function () { state.watch = watchEl.checked; render(); });

  // ---- filtering and sorting ----------------------------------------------
  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -999 : b.change_7d) - (a.change_7d === null ? -999 : a.change_7d); },
      age: function (a, b) { return (b.age_years === null ? -1 : b.age_years) - (a.age_years === null ? -1 : a.age_years); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    };
    return list.sort(by[state.sort] || by.rank);
  }

  function render() {
    var list = visible();
    var html = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="slug">' + esc(r.slug) + '</span>' +
        (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + r.chains.length + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_years) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="8">Nothing matches this filter.</td></tr>';
    document.getElementById('count').textContent = 'Showing ' + list.length + ' of ' + rows.length;
    Array.prototype.forEach.call(document.querySelectorAll('#rows tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  // ---- detail view ----------------------------------------------------------
  function select(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    state.selected = slug;
    var d = document.getElementById('detail');
    d.hidden = false;
    document.getElementById('d-name').textContent = r.name;
    document.getElementById('d-sub').textContent =
      r.slug + ' · ' + (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') +
      (r.watchlist ? ' · On the watchlist' : ' · Not on the watchlist') + ' · Records no token';
    document.getElementById('d-value').textContent = money(r.implied_value_usd);
    document.getElementById('d-grid').innerHTML =
      cell(money(r.tvl_usd), 'TVL') +
      cell(r.change_7d === null ? '—' : ((r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'), 'TVL change, 7d') +
      cell(age(r.age_years), 'Tracked since') +
      cell(String(r.chains.length), r.chains.length === 1 ? 'Chain' : 'Chains');
    function cell(b, label) {
      return '<div class="d-cell"><b>' + b + '</b><span>' + label + '</span></div>';
    }
    var tiltPct = Math.round((r.momentum_tilt - 1) * 100);
    document.getElementById('d-model').innerHTML =
      'Model breakdown — regression base <code>' + money(r.base_value_usd) + '</code>' +
      ' × category effect <code>' + (r.category_effect >= 0 ? '+' : '') + r.category_effect.toFixed(2) + ' log</code>' +
      ' × momentum tilt <code>' + (tiltPct >= 0 ? '+' : '') + tiltPct + '%</code>' +
      ' (7-day growth at the ' + Math.round(r.growth_percentile * 100) + 'th percentile of the board)' +
      ' = <code>' + money(r.implied_value_usd) + '</code>.';
    document.getElementById('d-steps').innerHTML = r.farm_steps.map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
    render();
    d.scrollIntoView({ block: 'nearest' });
  }

  // ---- initial state from the URL -------------------------------------------
  render();
  if (state.selected) select(state.selected);
  if (params.get('view') === 'filtered' && !state.cat && !state.q) {
    state.cat = 'Risk Curators';
    catSel.value = 'Risk Curators';
    render();
  }
})();
