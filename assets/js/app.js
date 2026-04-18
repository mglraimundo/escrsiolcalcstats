import { initOverview } from './overview.js';
import { initCountries } from './countries.js';
import { initCalcs } from './calcs.js';

async function fetchJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to fetch ${path}: ${r.status}`);
  return r.json();
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(p => p.classList.toggle('active', p.id === `tab-${target}`));
      // Tell charts to re-measure (Chart.js handles resize via ResizeObserver but map needs nudging).
      window.dispatchEvent(new Event('resize'));
    });
  });
}

function renderMetaLine(meta) {
  document.getElementById('source-file').textContent = meta.source;
}

async function main() {
  setupTabs();
  try {
    const [overall, countries, calcs, meta, world] = await Promise.all([
      fetchJSON('data/overall.json'),
      fetchJSON('data/countries.json'),
      fetchJSON('data/calcs.json'),
      fetchJSON('data/meta.json'),
      fetchJSON('data/world-110m.json'),
    ]);
    renderMetaLine(meta);
    initOverview(overall, meta);
    initCountries(countries, meta, world);
    initCalcs(calcs, meta);
  } catch (err) {
    console.error(err);
    document.getElementById('source-file').textContent = `failed to load: ${err.message}`;
  }
}

main();
