const STORE_KEY = 'statement-budget:v1';
const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const EXPENSE_CATEGORIES = StatementParser.CATEGORY_NAMES;
const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, 'Income', 'Transfer'];
const KIND_LABELS = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const TYPE_LABELS = { credit: 'Credit card', debit: 'Debit' };
const MANUAL_SOURCE_ID = 'manual';
const COLORS = ['#4f7cd6', '#e5534b', '#2e9e6a', '#f0b429', '#9b6bd6', '#e8799a', '#3fb6c4', '#ef8a3c', '#7a8b99', '#a3c152', '#c46a4b', '#5b6ad0', '#2f8f8f', '#d68ad6', '#8a6d3b'];

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const sumBy = (list, pred) => list.filter(pred).reduce((s, t) => s + t.amount, 0);
const groupSum = (list, keyFn) => list.reduce((acc, t) => {
  const key = keyFn(t);
  acc[key] = (acc[key] || 0) + t.amount;
  return acc;
}, {});

const state = loadState();
const view = { dashboard: 'all', month: 'all', kind: 'all', search: '', category: 'all' };
const charts = {};

function inferType(transactions) {
  return transactions.some(t => /DES:|CHECKCARD|Zelle payment|MOBILE PURCHASE/i.test(t.description)) ? 'debit' : 'credit';
}

function migrate(saved) {
  saved.sources ||= [];
  const created = new Set();
  for (const t of saved.transactions) {
    if (t.sourceId) continue;
    const name = t.file || 'Imported statement';
    const isManual = name === 'Manual entry';
    t.sourceId = isManual ? MANUAL_SOURCE_ID : `legacy:${name}`;
    if (!saved.sources.some(s => s.id === t.sourceId)) {
      saved.sources.push({ id: t.sourceId, name: isManual ? 'Manual entries' : name, type: 'credit', hash: null });
      created.add(t.sourceId);
    }
    delete t.file;
  }
  for (const source of saved.sources) {
    if (created.has(source.id) && source.id !== MANUAL_SOURCE_ID) {
      source.type = inferType(saved.transactions.filter(t => t.sourceId === source.id));
    }
  }
  return saved;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.transactions)) {
      const migrated = migrate(saved);
      return { transactions: migrated.transactions, budgets: migrated.budgets || {}, sources: migrated.sources };
    }
  } catch {}
  return { transactions: [], budgets: {}, sources: [] };
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
}

function commit() {
  saveState();
  renderAll();
}

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').className = isError ? 'status error' : 'status';
}

const sourceById = id => state.sources.find(s => s.id === id);
const sourceName = id => sourceById(id)?.name ?? 'Unknown';
const sourceType = t => sourceById(t.sourceId)?.type ?? 'credit';

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

const isIncluded = t => sourceById(t.sourceId)?.included !== false;

function scopeTx() {
  return state.transactions.filter(t => isIncluded(t) && (view.dashboard === 'all' || sourceType(t) === view.dashboard));
}

function allMonths() {
  return [...new Set(scopeTx().map(t => t.date.slice(0, 7)))].sort();
}

function viewTx() {
  return scopeTx().filter(t => view.month === 'all' || t.date.startsWith(view.month));
}

function monthsInView() {
  return view.month === 'all' ? Math.max(1, allMonths().length) : 1;
}

function makeCategory(kind, description) {
  if (kind === 'income') return 'Income';
  if (kind === 'transfer') return 'Transfer';
  return StatementParser.categorize(description);
}

function upsertChart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}

function renderAll() {
  renderMonthOptions();
  renderCards();
  renderCharts();
  renderBudget();
  renderIncome();
  renderTransactions();
  renderFiles();
  $('emptyHint').classList.toggle('hidden', state.transactions.length > 0);
}

function renderMonthOptions() {
  const months = allMonths();
  if (view.month !== 'all' && !months.includes(view.month)) view.month = 'all';
  $('monthSelect').innerHTML = [
    '<option value="all">All months</option>',
    ...months.map(m => `<option value="${m}">${monthLabel(m)}</option>`),
  ].join('');
  $('monthSelect').value = view.month;
}

function renderCards() {
  const list = viewTx();
  const income = sumBy(list, t => t.kind === 'income');
  const expenses = sumBy(list, t => t.kind === 'expense');
  const transfers = sumBy(list, t => t.kind === 'transfer');
  const net = income - expenses;
  const rate = income > 0 ? `${Math.round((net / income) * 100)}%` : '—';
  const cards = [
    ['Income', fmt(income), 'pos'],
    ['Spending', fmt(expenses), 'neg'],
    ['Net left over', fmt(net), net >= 0 ? 'pos' : 'neg'],
    ['Savings rate', rate, ''],
    ['Transfers', fmt(transfers), ''],
    ['Transactions', list.length, ''],
  ];
  $('cards').innerHTML = cards
    .map(([label, value, cls]) => `<div class="stat"><span>${label}</span><strong class="${cls}">${value}</strong></div>`)
    .join('');
}

function renderCharts() {
  const months = allMonths();
  const scoped = scopeTx();
  const monthIncome = months.map(m => sumBy(scoped, t => t.kind === 'income' && t.date.startsWith(m)));
  const monthExpense = months.map(m => sumBy(scoped, t => t.kind === 'expense' && t.date.startsWith(m)));
  upsertChart('monthChart', {
    type: 'bar',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: 'Income', data: monthIncome, backgroundColor: '#2e9e6a' },
        { label: 'Expenses', data: monthExpense, backgroundColor: '#e5534b' },
      ],
    },
    options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });

  const expenses = viewTx().filter(t => t.kind === 'expense');
  const byCategory = groupSum(expenses, t => t.category);
  const categories = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);
  upsertChart('categoryChart', {
    type: 'doughnut',
    data: {
      labels: categories,
      datasets: [{ data: categories.map(c => byCategory[c]), backgroundColor: categories.map((_, i) => COLORS[i % COLORS.length]) }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right' } },
      onHover: (event, elements) => { event.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
      onClick: (event, elements) => {
        if (elements.length) setCategoryFilter(categories[elements[0].index]);
      },
    },
  });

  const byDay = groupSum(expenses, t => t.date);
  const days = Object.keys(byDay).sort();
  const cumulative = [];
  let running = 0;
  for (const day of days) {
    running += byDay[day];
    cumulative.push(running);
  }
  upsertChart('dailyChart', {
    type: 'line',
    data: {
      labels: days,
      datasets: [{
        label: 'Cumulative spending',
        data: cumulative,
        borderColor: '#4f7cd6',
        backgroundColor: 'rgba(79, 124, 214, 0.15)',
        fill: true,
        tension: 0.2,
      }],
    },
    options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });
}

function renderBudget() {
  const scale = monthsInView();
  const spent = groupSum(viewTx().filter(t => t.kind === 'expense'), t => t.category);
  const rows = EXPENSE_CATEGORIES.map(cat => {
    const monthly = state.budgets[cat] || 0;
    const budget = monthly * scale;
    const actual = spent[cat] || 0;
    const pct = budget > 0 ? (actual / budget) * 100 : null;
    const usage = pct === null
      ? ''
      : `<div class="bar"><span class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></span></div><small class="muted">${Math.round(pct)}% used</small>`;
    return `<tr>
      <td>${esc(cat)}</td>
      <td class="num">${fmt(actual)}</td>
      <td class="num"><input type="number" min="0" step="10" value="${monthly || ''}" placeholder="0" data-budget="${esc(cat)}" aria-label="Monthly budget for ${esc(cat)}"></td>
      <td class="usage">${usage}</td>
    </tr>`;
  }).join('');
  $('budgetTable').innerHTML = `<thead><tr><th>Category</th><th class="num">Actual</th><th class="num">Monthly budget</th><th>Used</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderIncome() {
  const bySource = groupSum(viewTx().filter(t => t.kind === 'income'), t => t.description.slice(0, 40).toUpperCase());
  const rows = Object.entries(bySource).sort((a, b) => b[1] - a[1]).slice(0, 10);
  $('incomeTable').innerHTML = rows.length
    ? `<thead><tr><th>Source</th><th class="num">Total</th></tr></thead><tbody>${rows
        .map(([name, total]) => `<tr><td>${esc(name)}</td><td class="num pos">${fmt(total)}</td></tr>`)
        .join('')}</tbody>`
    : '<tbody><tr><td class="muted">No income in this view.</td></tr></tbody>';
}

function selectHtml(field, options, selected, labels = {}) {
  return `<select data-field="${field}">${options
    .map(o => `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(labels[o] || o)}</option>`)
    .join('')}</select>`;
}

function setCategoryFilter(category) {
  view.category = category;
  view.kind = 'expense';
  $('kindFilter').value = 'expense';
  renderTransactions();
}

function renderCategoryDetail(rows) {
  $('categoryDetail').classList.toggle('hidden', view.category === 'all');
  if (view.category === 'all') return;
  const total = rows.reduce((s, t) => s + t.amount, 0);
  $('categoryDetailTitle').textContent = view.category;
  $('categoryDetailTotal').textContent = `${rows.length} transactions · ${fmt(total)}`;
  $('categoryDetailList').innerHTML = rows.length
    ? rows.map(t => `<li>
        <div><span>${esc(t.description)}</span><small class="muted">${esc(t.date)}</small></div>
        <strong class="${t.kind === 'income' ? 'pos' : 'neg'}">${fmt(t.amount)}</strong>
      </li>`).join('')
    : '<li class="muted">No transactions.</li>';
}

function renderTransactions() {
  const q = view.search.trim().toLowerCase();
  const rows = viewTx()
    .filter(t => (view.kind === 'all' || t.kind === view.kind)
      && (view.category === 'all' || t.category === view.category)
      && t.description.toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
  const body = rows.map(t => {
    const sign = t.kind === 'income' ? '+' : t.kind === 'expense' ? '-' : '';
    const cls = t.kind === 'income' ? 'pos' : t.kind === 'expense' ? 'neg' : 'muted';
    return `<tr data-id="${t.id}">
      <td>${esc(t.date)}</td>
      <td>${esc(t.description)}<small class="muted">${esc(sourceName(t.sourceId))}</small></td>
      <td>${selectHtml('kind', ['expense', 'income', 'transfer'], t.kind, KIND_LABELS)}</td>
      <td>${selectHtml('category', ALL_CATEGORIES, t.category)}</td>
      <td class="num ${cls}">${sign}${fmt(t.amount)}</td>
      <td><button class="icon" type="button" data-action="delete" title="Delete transaction" aria-label="Delete transaction">✕</button></td>
    </tr>`;
  }).join('');
  $('txTable').innerHTML = `<thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th class="num">Amount</th><th></th></tr></thead><tbody>${body || '<tr><td class="muted" colspan="6">No matching transactions.</td></tr>'}</tbody>`;
  $('txCount').textContent = `(${rows.length} shown)`;
  renderCategoryDetail(rows);
  $('categoryChip').classList.toggle('hidden', view.category === 'all');
  $('categoryChipText').textContent = `Showing ${view.category} (${view.kind === 'all' ? 'all types' : KIND_LABELS[view.kind].toLowerCase() + 's'})`;
}

function renderFiles() {
  $('fileList').innerHTML = state.sources.length
    ? state.sources.map(s => {
        const list = state.transactions.filter(t => t.sourceId === s.id);
        const dates = list.map(t => t.date).sort();
        const range = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : 'no transactions';
        return `<li>
          <label class="show-toggle"><input type="checkbox" data-include="${esc(s.id)}"${s.included !== false ? ' checked' : ''}> Show</label>
          <span>${esc(s.name)}</span>
          <small class="muted">${list.length} transactions · ${range}</small>
          <select data-source-type="${esc(s.id)}" aria-label="Dashboard for ${esc(s.name)}">
            ${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}"${value === s.type ? ' selected' : ''}>${label} dashboard</option>`).join('')}
          </select>
          <button class="btn small danger" type="button" data-remove="${esc(s.id)}">Remove</button>
        </li>`;
      }).join('')
    : '<li class="muted">No statements imported yet.</li>';
}

async function setupPdfWorker() {
  try {
    const blob = await (await fetch(PDF_WORKER_URL)).blob();
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  }
}

async function pdfToPages(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const { items } = await (await pdf.getPage(n)).getTextContent();
    const rows = [];
    const sorted = items.filter(i => i.str.trim()).sort((a, b) => b.transform[5] - a.transform[5]);
    for (const item of sorted) {
      const y = item.transform[5];
      let row = rows[rows.length - 1];
      if (!row || Math.abs(row.y - y) > 2) {
        row = { y, parts: [] };
        rows.push(row);
      }
      row.parts.push(item);
    }
    pages.push(rows.map(row => row.parts
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map(p => p.str)
      .join(' ')));
  }
  return pages;
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const txKey = t => `${t.date}|${t.amount.toFixed(2)}|${t.description.replace(/\s+/g, ' ').trim().toUpperCase()}`;

async function importFiles(files) {
  const pdfs = [...files].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) {
    setStatus('Please choose PDF files.', true);
    return;
  }
  const fallbackType = document.querySelector('input[name="stype"]:checked').value;
  const messages = [];
  let hasError = false;
  for (const file of pdfs) {
    setStatus(`Reading ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      const hash = await sha256(buffer);
      if (state.sources.some(s => s.hash === hash)) {
        messages.push(`${file.name} was already imported, so it was skipped.`);
        continue;
      }
      const pages = await pdfToPages(buffer);
      const detected = StatementParser.detectStatementType(pages);
      const statementType = detected || fallbackType;
      const parsed = StatementParser.parse(pages, { statementType });
      if (!parsed.length) {
        hasError = true;
        messages.push(`No transactions found in ${file.name}. If it is a scanned image, it needs OCR first.`);
        continue;
      }
      const existingKeys = new Set(state.transactions.map(txKey));
      const fresh = parsed.filter(t => !existingKeys.has(txKey(t)));
      const skipped = parsed.length - fresh.length;
      if (!fresh.length) {
        messages.push(`${file.name}: all ${parsed.length} transactions already exist, so it was skipped.`);
        continue;
      }
      const sourceId = newId();
      state.sources.push({ id: sourceId, name: file.name, type: statementType, hash });
      for (const t of fresh) state.transactions.push({ ...t, id: newId(), sourceId });
      const typeNote = detected ? `detected as ${TYPE_LABELS[statementType]}` : `assumed ${TYPE_LABELS[statementType]}`;
      messages.push(`${file.name}: imported ${fresh.length} (${typeNote})${skipped ? `, skipped ${skipped} duplicates` : ''}.`);
    } catch (err) {
      console.error(err);
      hasError = true;
      messages.push(`Could not read ${file.name}: ${err.message}`);
    }
  }
  setStatus(messages.join(' '), hasError);
  commit();
}

function findTx(id) {
  return state.transactions.find(t => t.id === id);
}

function manualSource() {
  let source = sourceById(MANUAL_SOURCE_ID);
  if (!source) {
    source = { id: MANUAL_SOURCE_ID, name: 'Manual entries', type: 'credit', hash: null };
    state.sources.push(source);
  }
  if (view.dashboard !== 'all') source.type = view.dashboard;
  return source;
}

function exportCsv() {
  const header = ['date', 'description', 'type', 'category', 'amount', 'dashboard', 'statement'];
  const rows = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(t => [t.date, t.description, t.kind, t.category, t.amount.toFixed(2), sourceType(t), sourceName(t.sourceId)]);
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'transactions.csv' });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('fileInput').addEventListener('change', e => {
  const files = [...e.target.files];
  e.target.value = '';
  importFiles(files);
});

window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  importFiles([...e.dataTransfer.files]);
});

$('dashboardSelect').addEventListener('change', e => {
  view.dashboard = e.target.value;
  renderAll();
});

$('monthSelect').addEventListener('change', e => {
  view.month = e.target.value;
  renderAll();
});

$('kindFilter').addEventListener('change', e => {
  view.kind = e.target.value;
  renderTransactions();
});

$('search').addEventListener('input', e => {
  view.search = e.target.value;
  renderTransactions();
});

function clearCategoryFilter() {
  view.category = 'all';
  renderTransactions();
}

$('clearCategory').addEventListener('click', clearCategoryFilter);
$('categoryDetailClose').addEventListener('click', clearCategoryFilter);

$('budgetTable').addEventListener('change', e => {
  const cat = e.target.dataset.budget;
  if (!cat) return;
  state.budgets[cat] = Math.max(0, Number(e.target.value) || 0);
  saveState();
  renderBudget();
});

$('txTable').addEventListener('change', e => {
  const select = e.target.closest('select');
  const tx = findTx(select?.closest('tr')?.dataset.id);
  if (!tx) return;
  if (select.dataset.field === 'kind') {
    tx.kind = select.value;
    tx.category = makeCategory(tx.kind, tx.description);
  } else {
    tx.category = select.value;
  }
  commit();
});

$('txTable').addEventListener('click', e => {
  if (e.target.dataset.action !== 'delete') return;
  const id = e.target.closest('tr').dataset.id;
  state.transactions = state.transactions.filter(t => t.id !== id);
  commit();
});

$('fileList').addEventListener('change', e => {
  const includeId = e.target.dataset.include;
  if (includeId) {
    const source = sourceById(includeId);
    if (!source) return;
    source.included = e.target.checked;
    commit();
    return;
  }
  const id = e.target.dataset.sourceType;
  const source = id && sourceById(id);
  if (!source) return;
  source.type = e.target.value;
  commit();
});

$('fileList').addEventListener('click', e => {
  const id = e.target.dataset.remove;
  if (!id) return;
  state.transactions = state.transactions.filter(t => t.sourceId !== id);
  state.sources = state.sources.filter(s => s.id !== id);
  commit();
});

$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const amount = Math.abs(Number(f.amount.value));
  const description = f.description.value.trim();
  if (!f.date.value || !description || !(amount > 0)) {
    setStatus('Enter a date, description, and amount.', true);
    return;
  }
  const kind = f.kind.value;
  const source = manualSource();
  state.transactions.push({
    id: newId(),
    sourceId: source.id,
    date: f.date.value,
    description,
    amount,
    kind,
    category: makeCategory(kind, description),
  });
  f.description.value = '';
  f.amount.value = '';
  setStatus('Transaction added.');
  commit();
});

$('exportBtn').addEventListener('click', exportCsv);

$('clearBtn').addEventListener('click', () => {
  if (!confirm('Delete all imported transactions and budgets from this browser?')) return;
  state.transactions = [];
  state.budgets = {};
  state.sources = [];
  setStatus('');
  commit();
});

renderAll();
setupPdfWorker();
