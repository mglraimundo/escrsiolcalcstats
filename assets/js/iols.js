import Chart from 'chart.js/auto';
import { fmtInt, makeSorter, attachTableSort } from './util.js';
import { downloadCsv, downloadChartPng, timestamp } from './export.js';

const CALC_COLORS = [
  '#0b5cab', '#1b9e77', '#d95f02', '#7570b3',
  '#e7298a', '#66a61e', '#e6ab02', '#a6761d',
  '#666666', '#1f78b4', '#b2df8a', '#fb9a99',
];

const LENS_PAGE_SIZE = 50;

const state = {
  year: 'all',
  type: 'all',
  mfr: '',
  sortKey: 'count',
  sortDir: 'desc',
  showAll: false,
};

let data = null;
let mfrChart = null;

function filteredMfr() {
  return data.manufacturers.filter(r => r.year === state.year && r.type === state.type);
}

function filteredLenses() {
  return data.lenses.filter(r =>
    r.year === state.year && r.type === state.type &&
    (!state.mfr || r.manufacturer === state.mfr)
  );
}

function renderManufacturers(rows) {
  const sorted = rows.slice().sort((a, b) => b.count - a.count).slice(0, 15);
  const labels = sorted.map(r => r.manufacturer);
  const counts = sorted.map(r => r.count);
  const colors = sorted.map((_, i) => CALC_COLORS[i % CALC_COLORS.length]);

  if (mfrChart) mfrChart.destroy();
  mfrChart = new Chart(document.getElementById('iols-mfr-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Calculations', data: counts, backgroundColor: colors, borderWidth: 0 }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const r = sorted[ctx.dataIndex];
              return `${fmtInt(r.count)} (${(r.share * 100).toFixed(1)}%)`;
            },
          },
        },
      },
      scales: { x: { beginAtZero: true, ticks: { callback: v => Number(v).toLocaleString() } } },
    },
  });
}

function renderTable(rows) {
  const sorted = rows.slice().sort(makeSorter(state.sortKey, state.sortDir));
  const visible = state.showAll ? sorted : sorted.slice(0, LENS_PAGE_SIZE);
  const tbody = document.querySelector('#iols-table tbody');
  tbody.innerHTML = visible.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${r.manufacturer}</td>
      <td>${r.name}</td>
      <td class="num">${fmtInt(r.count)}</td>
      <td class="num">${(r.share * 100).toFixed(2)}%</td>
    </tr>
  `).join('');

  const existing = document.getElementById('iols-show-all');
  if (existing) existing.remove();

  if (!state.showAll && sorted.length > LENS_PAGE_SIZE) {
    const btn = document.createElement('button');
    btn.id = 'iols-show-all';
    btn.className = 'btn';
    btn.style.marginTop = '0.75rem';
    btn.textContent = `Show all ${fmtInt(sorted.length)} IOLs`;
    btn.addEventListener('click', () => { state.showAll = true; renderTable(rows); });
    document.querySelector('#iols-table').after(btn);
  }
}

function render() {
  renderManufacturers(filteredMfr());
  renderTable(filteredLenses());
}

function populateYearFilter() {
  const years = ['all', ...new Set(data.manufacturers.map(r => r.year).filter(y => y !== 'all'))].sort(
    (a, b) => a === 'all' ? -1 : b === 'all' ? 1 : Number(a) - Number(b)
  );
  const ySel = document.getElementById('iols-year');
  ySel.innerHTML = years.map(y => `<option value="${y}">${y === 'all' ? 'All years' : y}</option>`).join('');
  ySel.addEventListener('change', () => { state.year = ySel.value; state.showAll = false; populateMfrFilter(); render(); });
}

function populateMfrFilter() {
  const mfrs = [...new Set(
    data.manufacturers
      .filter(r => r.year === state.year && r.type === state.type)
      .sort((a, b) => b.count - a.count)
      .map(r => r.manufacturer)
  )];
  const sel = document.getElementById('iols-mfr');
  const prev = state.mfr;
  sel.innerHTML = '<option value="">All manufacturers</option>' +
    mfrs.map(m => `<option value="${m}">${m}</option>`).join('');
  sel.value = mfrs.includes(prev) ? prev : '';
  state.mfr = sel.value;
}

function populateFilters() {
  populateYearFilter();

  document.getElementById('iols-type').addEventListener('change', e => {
    state.type = e.target.value; state.showAll = false;
    populateMfrFilter(); render();
  });

  const mfrSel = document.getElementById('iols-mfr');
  mfrSel.addEventListener('change', () => { state.mfr = mfrSel.value; state.showAll = false; render(); });

  populateMfrFilter();
}

function wireExports() {
  document.getElementById('iols-export-csv').addEventListener('click', () => {
    const rows = filteredLenses().slice().sort(makeSorter(state.sortKey, state.sortDir));
    downloadCsv(`escrs-iols-${state.year}-${state.type}-${timestamp()}.csv`, rows, [
      { key: 'manufacturer', label: 'Manufacturer' },
      { key: 'name', label: 'IOL' },
      { key: 'count', label: 'Count' },
      { key: 'share', label: 'Share', format: v => (v * 100).toFixed(2) + '%' },
    ]);
  });

  document.getElementById('iols-export-png').addEventListener('click', () => {
    downloadChartPng(mfrChart, `escrs-iols-manufacturers-${state.year}-${state.type}-${timestamp()}.png`);
  });
}

export function initIols(iolsData, meta) {
  data = iolsData;
  populateFilters();
  attachTableSort(document.getElementById('iols-table'), state, () => renderTable(filteredLenses()));
  wireExports();
  render();
}
