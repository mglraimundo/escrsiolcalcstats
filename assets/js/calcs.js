import Chart from 'chart.js/auto';
import { MONTHS, fmtInt, ymLabel, makeSorter, attachTableSort } from './util.js';
import { downloadCsv, downloadChartPng, timestamp } from './export.js';

// Distinct colors per calculator (categorical palette).
const CALC_COLORS = [
  '#0b5cab', '#1b9e77', '#d95f02', '#7570b3',
  '#e7298a', '#66a61e', '#e6ab02', '#a6761d',
  '#666666', '#1f78b4', '#b2df8a', '#fb9a99',
];

const state = {
  year: 'all',
  calc: '',
  variant: '',
  sortKey: 'year',
  sortDir: 'asc',
};

let raw = [];
let stackedChart, totalsChart, variantChart;

const VARIANT_LABELS = {
  standard: 'Standard',
  toric: 'Toric',
  keratoconus: 'Keratoconus',
  post_lasik: 'Post-LASIK/PRK',
};
const VARIANT_ORDER = ['standard', 'toric', 'keratoconus', 'post_lasik'];
const VARIANT_COLORS = {
  standard: '#0b5cab',
  toric: '#1b9e77',
  keratoconus: '#d95f02',
  post_lasik: '#7570b3',
};

function variantOf(r) {
  if (r.toric) return 'toric';
  if (r.keratoconus) return 'keratoconus';
  if (r.post_lasik) return 'post_lasik';
  return 'standard';
}

function variantBreakdown(rows) {
  const totals = Object.fromEntries(VARIANT_ORDER.map(v => [v, 0]));
  rows.forEach(r => { totals[variantOf(r)] += r.calculations; });
  const grand = Object.values(totals).reduce((s, n) => s + n, 0);
  return VARIANT_ORDER.map(v => ({
    key: v,
    label: VARIANT_LABELS[v],
    calculations: totals[v],
    share: grand ? totals[v] / grand : 0,
  }));
}

function passesVariant(r) {
  switch (state.variant) {
    case 'standard': return !r.toric && !r.keratoconus && !r.post_lasik;
    case 'toric': return r.toric;
    case 'keratoconus': return r.keratoconus;
    case 'post_lasik': return r.post_lasik;
    default: return true;
  }
}

function filtered() {
  let rows = raw.filter(passesVariant);
  if (state.year !== 'all') rows = rows.filter(r => r.year === Number(state.year));
  if (state.calc) rows = rows.filter(r => r.calculator === state.calc);
  return rows;
}

function sortedForTable(rows) {
  return rows.slice().sort(makeSorter(state.sortKey, state.sortDir));
}

function renderTable(rows) {
  const tbody = document.querySelector('#calcs-table tbody');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.year}</td>
      <td>${MONTHS[r.month] || r.month}</td>
      <td>${r.calculator}</td>
      <td>${r.toric ? '<span class="badge">Yes</span>' : '<span class="badge off">No</span>'}</td>
      <td>${r.keratoconus ? '<span class="badge">Yes</span>' : '<span class="badge off">No</span>'}</td>
      <td>${r.post_lasik ? '<span class="badge">Yes</span>' : '<span class="badge off">No</span>'}</td>
      <td class="num">${fmtInt(r.calculations)}</td>
    </tr>
  `).join('');
  document.querySelectorAll('#calcs-table thead th').forEach((th, i) => {
    if (i === 6) th.classList.add('num');
  });
}

function renderStacked(rows) {
  // Group by year-month, stack by calculator.
  const byKey = new Map();
  const calcSet = new Set();
  rows.forEach(r => {
    const k = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byKey.has(k)) byKey.set(k, { year: r.year, month: r.month, calcs: new Map() });
    const entry = byKey.get(k);
    entry.calcs.set(r.calculator, (entry.calcs.get(r.calculator) || 0) + r.calculations);
    calcSet.add(r.calculator);
  });
  const keys = [...byKey.keys()].sort();
  const labels = keys.map(k => { const e = byKey.get(k); return ymLabel(e.year, e.month); });
  const calcList = [...calcSet].sort();
  const datasets = calcList.map((c, i) => ({
    label: c,
    data: keys.map(k => byKey.get(k).calcs.get(c) || 0),
    backgroundColor: CALC_COLORS[i % CALC_COLORS.length],
    borderWidth: 0,
    stack: 'calcs',
  }));

  if (stackedChart) stackedChart.destroy();
  stackedChart = new Chart(document.getElementById('calcs-stacked-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } },
      },
    },
  });
}

function renderTotals(rows) {
  const totals = new Map();
  rows.forEach(r => totals.set(r.calculator, (totals.get(r.calculator) || 0) + r.calculations));
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);
  const colors = labels.map((_, i) => CALC_COLORS[i % CALC_COLORS.length]);

  if (totalsChart) totalsChart.destroy();
  totalsChart = new Chart(document.getElementById('calcs-totals-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Calculations', data, backgroundColor: colors, borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } } },
    },
  });
}

function renderVariant(rows) {
  const breakdown = variantBreakdown(rows);

  // Pie chart
  if (variantChart) variantChart.destroy();
  variantChart = new Chart(document.getElementById('calcs-variant-chart'), {
    type: 'doughnut',
    data: {
      labels: breakdown.map(b => b.label),
      datasets: [{
        data: breakdown.map(b => b.calculations),
        backgroundColor: breakdown.map(b => VARIANT_COLORS[b.key]),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const b = breakdown[ctx.dataIndex];
              return `${b.label}: ${fmtInt(b.calculations)} (${(b.share * 100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });

  // Table
  const tbody = document.querySelector('#calcs-variant-table tbody');
  tbody.innerHTML = breakdown.map(b => `
    <tr>
      <td><span class="swatch" style="background:${VARIANT_COLORS[b.key]}"></span>${b.label}</td>
      <td class="num">${fmtInt(b.calculations)}</td>
      <td class="num">${(b.share * 100).toFixed(1)}%</td>
    </tr>
  `).join('');
}

function render() {
  const rows = filtered();
  renderStacked(rows);
  renderTotals(rows);
  renderVariant(rows);
  renderTable(sortedForTable(rows));
}

function populateControls(meta) {
  const years = [...new Set(raw.map(r => r.year))].sort();
  const calculators = [...new Set(raw.map(r => r.calculator))].sort();

  const ySel = document.getElementById('calcs-year');
  ySel.innerHTML = '<option value="all">All years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  ySel.addEventListener('change', () => { state.year = ySel.value; render(); });

  const cSel = document.getElementById('calcs-calc');
  cSel.innerHTML = '<option value="">All calculators</option>' + calculators.map(c => `<option value="${c}">${c}</option>`).join('');
  cSel.addEventListener('change', () => { state.calc = cSel.value; render(); });

  const vSel = document.getElementById('calcs-variant');
  vSel.addEventListener('change', () => { state.variant = vSel.value; render(); });
}

function wireExports() {
  document.getElementById('calcs-export-csv').addEventListener('click', () => {
    downloadCsv(`escrs-calcs-${state.year}-${timestamp()}.csv`, sortedForTable(filtered()), [
      { key: 'year', label: 'Year' },
      { key: 'month', label: 'Month' },
      { key: 'calculator', label: 'Calculator' },
      { key: 'toric', label: 'Toric', format: v => v ? 1 : 0 },
      { key: 'keratoconus', label: 'Keratoconus', format: v => v ? 1 : 0 },
      { key: 'post_lasik', label: 'Post LASIK/PRK', format: v => v ? 1 : 0 },
      { key: 'calculations', label: 'Calculations' },
    ]);
  });
  document.getElementById('calcs-export-stacked-png').addEventListener('click', () => {
    downloadChartPng(stackedChart, `escrs-calcs-stacked-${state.year}-${timestamp()}.png`);
  });
  document.getElementById('calcs-export-totals-png').addEventListener('click', () => {
    downloadChartPng(totalsChart, `escrs-calcs-totals-${state.year}-${timestamp()}.png`);
  });
  document.getElementById('calcs-export-variant-png').addEventListener('click', () => {
    downloadChartPng(variantChart, `escrs-calcs-variant-${state.year}-${timestamp()}.png`);
  });
  document.getElementById('calcs-export-variant-csv').addEventListener('click', () => {
    downloadCsv(`escrs-calcs-variant-${state.year}-${timestamp()}.csv`, variantBreakdown(filtered()), [
      { key: 'label', label: 'Variant' },
      { key: 'calculations', label: 'Calculations' },
      { key: 'share', label: 'Share', format: v => (v * 100).toFixed(2) + '%' },
    ]);
  });
}

export function initCalcs(calcs, meta) {
  raw = calcs;
  populateControls(meta);
  attachTableSort(document.getElementById('calcs-table'), state, () => renderTable(sortedForTable(filtered())));
  wireExports();
  render();
}
