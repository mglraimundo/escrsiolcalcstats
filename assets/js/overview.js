import Chart from 'chart.js/auto';
import { MONTHS, fmtInt, fmtFloat, fmtDuration, ymLabel, makeSorter, attachTableSort } from './util.js';
import { downloadCsv, downloadChartPng, timestamp } from './export.js';

const PALETTE = {
  users: '#0b5cab',
  sessions: '#1b9e77',
  duration: '#d95f02',
};

let usersChart;
const state = { year: 'all', sortKey: 'year', sortDir: 'asc' };
let monthly = [];

function chronological() {
  let rows = monthly.slice();
  if (state.year !== 'all') rows = rows.filter(r => r.year === Number(state.year));
  rows.sort(makeSorter('year', 'asc'));
  // secondary sort by month
  rows.sort((a, b) => a.year === b.year ? a.month - b.month : a.year - b.year);
  return rows;
}

function forTable() {
  const rows = chronological();
  rows.sort(makeSorter(state.sortKey, state.sortDir));
  return rows;
}

function renderKpis(rows) {
  const users = rows.reduce((s, r) => s + r.users, 0);
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  const avgDur = rows.length
    ? rows.reduce((s, r) => s + r.avg_session_duration * r.sessions, 0) / Math.max(sessions, 1)
    : 0;
  document.getElementById('kpi-users').textContent = fmtInt(users);
  document.getElementById('kpi-sessions').textContent = fmtInt(sessions);
  document.getElementById('kpi-duration').textContent = fmtDuration(avgDur);
  document.getElementById('kpi-months').textContent = fmtInt(rows.length);
}

function renderTable(rows) {
  const tbody = document.querySelector('#overview-table tbody');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.year}</td>
      <td>${MONTHS[r.month] || r.month}</td>
      <td class="num">${fmtInt(r.users)}</td>
      <td class="num">${fmtInt(r.sessions)}</td>
      <td class="num">${fmtFloat(r.avg_session_duration, 1)}</td>
    </tr>
  `).join('');
  // Align numeric header cells
  document.querySelectorAll('#overview-table thead th').forEach((th, i) => {
    if (i >= 2) th.classList.add('num');
  });
}

function buildCharts(rows) {
  const labels = rows.map(r => ymLabel(r.year, r.month));

  if (usersChart) usersChart.destroy();
  usersChart = new Chart(document.getElementById('overview-users-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Users', data: rows.map(r => r.users), borderColor: PALETTE.users, backgroundColor: PALETTE.users + '33', tension: 0.25, yAxisID: 'y', fill: true },
        { label: 'Sessions', data: rows.map(r => r.sessions), borderColor: PALETTE.sessions, backgroundColor: PALETTE.sessions + '22', tension: 0.25, yAxisID: 'y', fill: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => v.toLocaleString() } },
      },
    },
  });

}

function render() {
  const chrono = chronological();
  renderKpis(chrono);
  buildCharts(chrono);
  renderTable(forTable());
}

function populateYearFilter() {
  const years = [...new Set(monthly.map(r => r.year))].sort();
  const sel = document.getElementById('overview-year');
  sel.innerHTML = '<option value="all">All years</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.addEventListener('change', () => { state.year = sel.value; render(); });
}

function wireExports() {
  document.getElementById('overview-export-csv').addEventListener('click', () => {
    downloadCsv(`escrs-overall-${state.year}-${timestamp()}.csv`, forTable(), [
      { key: 'year', label: 'Year' },
      { key: 'month', label: 'Month' },
      { key: 'users', label: 'Users' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'avg_session_duration', label: 'Avg session duration (s)' },
    ]);
  });
  document.getElementById('overview-export-users-png').addEventListener('click', () => {
    downloadChartPng(usersChart, `escrs-overview-users-${state.year}-${timestamp()}.png`);
  });
}

export function initOverview(overall, _meta) {
  monthly = overall.monthly;
  populateYearFilter();
  attachTableSort(document.getElementById('overview-table'), state, () => renderTable(forTable()));
  wireExports();
  render();
}
