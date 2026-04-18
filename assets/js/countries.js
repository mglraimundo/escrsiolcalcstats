import Chart from 'chart.js/auto';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import { fmtInt, fmtFloat, makeSorter, attachTableSort } from './util.js';
import { downloadCsv, downloadChartPng, downloadSvg, downloadSvgAsPng, timestamp } from './export.js';

// GA country name → world-atlas map name. Only includes real aliases; tiny-island
// countries that are genuinely absent from the 110m geometry (Andorra, Aruba, etc.)
// stay unmapped and show up only in the table.
const NAME_ALIASES = {
  'United States': 'United States of America',
  'Türkiye': 'Turkey',
  'North Macedonia': 'Macedonia',
  'Congo - Kinshasa': 'Dem. Rep. Congo',
  'Bosnia & Herzegovina': 'Bosnia and Herz.',
  'Dominican Republic': 'Dominican Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Western Sahara': 'W. Sahara',
  'Myanmar (Burma)': 'Myanmar',
  'Czechia': 'Czechia',
  'Côte d\u2019Ivoire': "Côte d'Ivoire",
};

const METRIC_LABELS = {
  total_users: 'Total users',
  new_users: 'New users',
  sessions: 'Sessions',
  views_per_session: 'Views / session',
};

const state = {
  year: 'all',
  metric: 'total_users',
  continent: '',
  search: '',
  sortKey: 'total_users',
  sortDir: 'desc',
};

let rawRows = [];
let continentChart;
let countryFeatures = null;
let svgRoot = null;
let tooltipEl = null;
let currentRowsForExport = [];

function mapName(gaName) {
  return NAME_ALIASES[gaName] || gaName;
}

// Rows for the currently-selected year scope. When state.year === 'all',
// aggregate across years (one row per country, sessions-weighted views/session).
function scopedRows() {
  if (state.year !== 'all') return rawRows.filter(r => r.year === state.year);
  const byCountry = new Map();
  for (const r of rawRows) {
    const cur = byCountry.get(r.country);
    if (!cur) {
      byCountry.set(r.country, {
        year: 'All',
        country: r.country,
        continent: r.continent,
        total_users: r.total_users,
        new_users: r.new_users,
        sessions: r.sessions,
        _views_num: r.views_per_session * r.sessions,
        _views_den: r.sessions,
      });
    } else {
      cur.total_users += r.total_users;
      cur.new_users += r.new_users;
      cur.sessions += r.sessions;
      cur._views_num += r.views_per_session * r.sessions;
      cur._views_den += r.sessions;
    }
  }
  return [...byCountry.values()].map(r => ({
    year: r.year,
    country: r.country,
    continent: r.continent,
    total_users: r.total_users,
    new_users: r.new_users,
    sessions: r.sessions,
    views_per_session: r._views_den ? r._views_num / r._views_den : 0,
  }));
}

function filterRows() {
  let rows = scopedRows();
  if (state.continent) rows = rows.filter(r => r.continent === state.continent);
  if (state.search) {
    const q = state.search.toLowerCase();
    rows = rows.filter(r => r.country.toLowerCase().includes(q));
  }
  rows.sort(makeSorter(state.sortKey, state.sortDir));
  return rows;
}

function renderTable(rows) {
  const tbody = document.querySelector('#countries-table tbody');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.year}</td>
      <td>${r.country}</td>
      <td>${r.continent}</td>
      <td class="num">${fmtInt(r.total_users)}</td>
      <td class="num">${fmtInt(r.new_users)}</td>
      <td class="num">${fmtInt(r.sessions)}</td>
      <td class="num">${fmtFloat(r.views_per_session, 2)}</td>
    </tr>
  `).join('');
  document.querySelectorAll('#countries-table thead th').forEach((th, i) => {
    if (i >= 3) th.classList.add('num');
  });
}

function renderContinentChart(rowsAllYear) {
  const map = new Map();
  rowsAllYear.forEach(r => {
    if (r.continent === 'Unknown') return;
    const agg = map.get(r.continent) || { total_users: 0, sessions: 0, new_users: 0, _views_num: 0, _views_den: 0 };
    agg.total_users += r.total_users;
    agg.sessions += r.sessions;
    agg.new_users += r.new_users;
    agg._views_num += r.views_per_session * r.sessions;
    agg._views_den += r.sessions;
    map.set(r.continent, agg);
  });
  const labels = [...map.keys()].sort();
  const data = labels.map(k => {
    const a = map.get(k);
    if (state.metric === 'views_per_session') return a._views_den ? a._views_num / a._views_den : 0;
    return a[state.metric];
  });

  if (continentChart) continentChart.destroy();
  continentChart = new Chart(document.getElementById('countries-continent-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: METRIC_LABELS[state.metric],
        data,
        backgroundColor: '#0b5cabcc',
        borderColor: '#0b5cab',
        borderWidth: 1,
      }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } } },
    },
  });
}

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'map-tooltip';
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function renderMap(rowsThisYear) {
  const container = document.getElementById('countries-map');
  container.innerHTML = '';
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!width || !height) return; // tab hidden — will re-render on tab activation

  const byMapName = new Map();
  rowsThisYear.forEach(r => byMapName.set(mapName(r.country), r));

  const values = rowsThisYear
    .map(r => r[state.metric])
    .filter(v => typeof v === 'number' && v > 0);

  // Sqrt scale handles the long tail better than linear (US/UK dominate).
  const maxVal = d3.max(values) || 1;
  const color = d3.scaleSequentialSqrt(d3.interpolateBlues).domain([0, maxVal]);

  const svg = d3.select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');
  svgRoot = svg.node();

  const projection = d3.geoNaturalEarth1().fitSize([width, height], countryFeatures);
  const path = d3.geoPath(projection);

  const tooltip = ensureTooltip();

  svg.append('g')
    .selectAll('path')
    .data(countryFeatures.features)
    .join('path')
    .attr('class', d => {
      const row = byMapName.get(d.properties.name);
      return row ? 'country' : 'country missing';
    })
    .attr('fill', d => {
      const row = byMapName.get(d.properties.name);
      if (!row) return '#e9edf3';
      const v = row[state.metric];
      return v > 0 ? color(v) : '#e9edf3';
    })
    .attr('d', path)
    .on('mousemove', (ev, d) => {
      const row = byMapName.get(d.properties.name);
      tooltip.classList.add('visible');
      const val = row ? fmtFloat(row[state.metric], state.metric === 'views_per_session' ? 2 : 0) : 'no data';
      tooltip.innerHTML = `<strong>${d.properties.name}</strong><br>${METRIC_LABELS[state.metric]}: ${val}${row ? '' : ''}`;
      tooltip.style.left = ev.clientX + 'px';
      tooltip.style.top = ev.clientY + 'px';
    })
    .on('mouseleave', () => tooltip.classList.remove('visible'));

  // Legend gradient fill
  const yearLabel = state.year === 'all' ? 'All years' : state.year;
  document.getElementById('map-metric-label').textContent = `— ${METRIC_LABELS[state.metric]}, ${yearLabel}`;
  const legend = document.getElementById('countries-legend');
  legend.innerHTML = `
    <span>0</span>
    <div class="bar" style="background: linear-gradient(90deg, ${color(0)}, ${color(maxVal * 0.25)}, ${color(maxVal * 0.5)}, ${color(maxVal * 0.75)}, ${color(maxVal)})"></div>
    <span>${fmtFloat(maxVal, state.metric === 'views_per_session' ? 2 : 0)}</span>
  `;

  // Note about any unmatched countries this year
  const unmatched = rowsThisYear
    .filter(r => r.country && r.country !== '(not set)')
    .filter(r => !countryFeatures.features.some(f => f.properties.name === mapName(r.country)))
    .map(r => r.country);
  const note = document.getElementById('countries-map-note');
  if (unmatched.length) {
    note.textContent = `${unmatched.length} countries with data aren't rendered on the 110m map (too small at this resolution): ${unmatched.slice(0, 12).join(', ')}${unmatched.length > 12 ? '…' : ''}.`;
  } else {
    note.textContent = '';
  }
}

function render() {
  const scoped = scopedRows();
  const tableRows = filterRows();
  currentRowsForExport = tableRows;
  renderTable(tableRows);
  renderContinentChart(scoped);
  renderMap(scoped);
}

function populateControls(meta) {
  // Only offer years that actually have country rows.
  const years = [...new Set(rawRows.map(r => r.year))].sort();

  const ySel = document.getElementById('countries-year');
  ySel.innerHTML = '<option value="all">All years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  ySel.addEventListener('change', () => {
    state.year = ySel.value === 'all' ? 'all' : Number(ySel.value);
    render();
  });

  const mSel = document.getElementById('countries-metric');
  mSel.addEventListener('change', () => { state.metric = mSel.value; render(); });

  const cSel = document.getElementById('countries-continent');
  cSel.innerHTML = '<option value="">All continents</option>' + meta.continents.filter(c => c !== 'Unknown').map(c => `<option value="${c}">${c}</option>`).join('');
  cSel.addEventListener('change', () => { state.continent = cSel.value; render(); });

  const searchEl = document.getElementById('countries-search');
  searchEl.addEventListener('input', () => { state.search = searchEl.value; renderTable(filterRows()); });
}

function wireExports() {
  document.getElementById('countries-export-csv').addEventListener('click', () => {
    downloadCsv(`escrs-countries-${state.year}-${timestamp()}.csv`, currentRowsForExport, [
      { key: 'year', label: 'Year' },
      { key: 'country', label: 'Country' },
      { key: 'continent', label: 'Continent' },
      { key: 'total_users', label: 'Total users' },
      { key: 'new_users', label: 'New users' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'views_per_session', label: 'Views per session' },
    ]);
  });
  document.getElementById('countries-export-map-png').addEventListener('click', () => {
    if (svgRoot) downloadSvgAsPng(svgRoot, `escrs-map-${state.metric}-${state.year}-${timestamp()}.png`);
  });
  document.getElementById('countries-export-map-svg').addEventListener('click', () => {
    if (svgRoot) downloadSvg(svgRoot, `escrs-map-${state.metric}-${state.year}-${timestamp()}.svg`);
  });
  document.getElementById('countries-export-continent-png').addEventListener('click', () => {
    if (continentChart) downloadChartPng(continentChart, `escrs-continent-${state.metric}-${state.year}-${timestamp()}.png`);
  });
}

function handleResize() {
  const container = document.getElementById('countries-map');
  if (!container.offsetParent) return;
  renderMap(scopedRows());
}

export function initCountries(countries, meta, worldTopo) {
  rawRows = countries;
  countryFeatures = feature(worldTopo, worldTopo.objects.countries);
  populateControls(meta);
  attachTableSort(document.getElementById('countries-table'), state, () => renderTable(filterRows()));
  wireExports();
  render();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 150);
  });
}
