/* ============================================================
   つむぎワークス 運営管理アプリ — フロントエンドロジック
   ============================================================ */

const API = '';  // same-origin

// ── キャッシュ ──
let _clients = [];
let _projects = [];
let _invoices = [];
let _expenses = [];
let _quotes   = [];

// ============================================================
// ナビゲーション
// ============================================================
document.querySelectorAll('nav a[data-page]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const page = link.dataset.page;
    document.querySelectorAll('nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${page}`).classList.add('active');
    loadPage(page);
  });
});

function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  else if (page === 'clients')  loadClients();
  else if (page === 'projects') loadProjects();
  else if (page === 'finance')  loadFinance();
}

// ============================================================
// ダッシュボード
// ============================================================
async function loadDashboard() {
  const d = document.getElementById('dashboard-date');
  d.textContent = new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long', day:'numeric', weekday:'short' });

  const [dash, projects] = await Promise.all([
    fetchJSON('/api/dashboard'),
    fetchJSON('/api/projects'),
  ]);

  setText('dc-clients',  dash.clients);
  setText('dc-active',   dash.activeProjects);
  setText('dc-paid',    '¥' + fmt(dash.paidRevenue));
  setText('dc-unpaid',  '¥' + fmt(dash.unpaidRevenue));
  setText('dc-expenses','¥' + fmt(dash.totalExpenses));
  setText('dc-profit',  '¥' + fmt(dash.profit));

  const tbody = document.getElementById('dash-projects-body');
  const recent = projects.slice(0, 5);
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">案件がまだありません</td></tr>';
  } else {
    tbody.innerHTML = recent.map(p => `
      <tr>
        <td>${esc(p.title)}</td>
        <td>${esc(p.clients?.name ?? '—')}</td>
        <td>${statusBadge(p.status, 'project')}</td>
        <td>${p.budget ? '¥' + fmt(p.budget) : '—'}</td>
      </tr>
    `).join('');
  }

  // 外部サービス読み込み
  loadExternalStatus();
  loadCalendarEvents();
  loadNotionTasks();
  loadNewsPanel();
}

// ============================================================
// 外部サービス集約（Google Calendar / Notion）
// ============================================================

async function loadExternalStatus() {
  const status = await fetchJSON('/api/external/status').catch(() => ({}));
  const banner = document.getElementById('ext-setup-banner');
  const items  = document.getElementById('ext-setup-items');
  const msgs = [];
  if (!status.notion) {
    msgs.push('Notion 未接続 — <a href="/settings-guide.html" target="_blank" style="color:var(--accent)">設定方法を見る</a>（NOTION_TOKEN・NOTION_TASKS_DB_ID を .env に追加）');
  }
  if (!status.google_calendar && !status.google_auth_required) {
    msgs.push('Googleカレンダー 未接続 — <a href="/settings-guide.html" target="_blank" style="color:var(--accent)">設定方法を見る</a>（GOOGLE_CLIENT_ID を .env に追加）');
  }
  if (status.google_auth_required) {
    msgs.push('Googleカレンダー 認証が必要です — <a href="/auth/google" target="_blank" style="color:var(--accent)">ここをクリックして認証</a>');
  }
  if (msgs.length > 0) {
    items.innerHTML = msgs.join('<br>');
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

async function loadCalendarEvents() {
  const el = document.getElementById('cal-events-list');
  el.innerHTML = '<div style="padding:8px 20px;font-size:13px;color:var(--text-muted)">読み込み中...</div>';
  const res = await fetchJSON('/api/external/calendar/events').catch(() => ({ data: [], configured: false }));

  if (!res.configured) {
    el.innerHTML = `<div style="padding:10px 20px;font-size:13px;color:var(--text-muted)">
      Googleカレンダー未接続<br>
      <span style="font-size:11px">.env に GOOGLE_CLIENT_ID を設定してください</span>
    </div>`;
    return;
  }
  if (res.auth_url) {
    el.innerHTML = `<div style="padding:10px 20px;font-size:13px;">
      <a href="${res.auth_url}" target="_blank" style="color:var(--accent)">Googleカレンダーと連携する</a>
    </div>`;
    return;
  }
  if (!res.data || res.data.length === 0) {
    el.innerHTML = '<div style="padding:10px 20px;font-size:13px;color:var(--text-muted)">今後2週間の予定はありません</div>';
    return;
  }

  el.innerHTML = res.data.map(ev => {
    const start = ev.start?.dateTime
      ? new Date(ev.start.dateTime).toLocaleString('ja-JP', { month:'numeric', day:'numeric', weekday:'short', hour:'2-digit', minute:'2-digit' })
      : ev.start?.date || '';
    return `<div style="padding:8px 20px; border-bottom:1px solid var(--border); font-size:13px;">
      <div style="font-weight:500">${esc(ev.summary || '（タイトルなし）')}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${start}</div>
    </div>`;
  }).join('');
}

async function loadNotionTasks() {
  const el = document.getElementById('notion-tasks-list');
  el.innerHTML = '<div style="padding:8px 20px;font-size:13px;color:var(--text-muted)">読み込み中...</div>';
  const res = await fetchJSON('/api/external/notion/tasks').catch(() => ({ data: [], configured: false }));

  if (!res.configured) {
    el.innerHTML = `<div style="padding:10px 20px;font-size:13px;color:var(--text-muted)">
      Notion未接続<br>
      <span style="font-size:11px">.env に NOTION_TOKEN・NOTION_TASKS_DB_ID を設定してください</span>
    </div>`;
    return;
  }
  if (!res.data || res.data.length === 0) {
    el.innerHTML = '<div style="padding:10px 20px;font-size:13px;color:var(--text-muted)">タスクがありません</div>';
    return;
  }

  el.innerHTML = res.data.map(page => {
    // Notion ページのタイトルプロパティを抽出（プロパティ名は「名前」か「Name」が一般的）
    const props = page.properties || {};
    const titleProp = props['名前'] || props['Name'] || props['title'] || Object.values(props).find(p => p.type === 'title');
    const title = titleProp?.title?.[0]?.plain_text || '（タイトルなし）';

    // チェックボックス（Done / 完了 など）
    const doneProp = props['Done'] || props['完了'] || props['チェック'];
    const done = doneProp?.checkbox === true;

    // 期日
    const dateProp = props['期日'] || props['Due'] || props['日付'];
    const dueDate = dateProp?.date?.start
      ? new Date(dateProp.date.start).toLocaleDateString('ja-JP', { month:'numeric', day:'numeric' })
      : '';

    return `<div style="padding:8px 20px; border-bottom:1px solid var(--border); font-size:13px; display:flex; align-items:flex-start; gap:8px; ${done ? 'opacity:0.45;' : ''}">
      <span style="margin-top:2px">${done ? '☑' : '☐'}</span>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${esc(title)}</div>
        ${dueDate ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${dueDate}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// 顧客
// ============================================================
async function loadClients() {
  _clients = await fetchJSON('/api/clients');
  updateClientStats();
  renderClientsTable();
}

function updateClientStats() {
  const now = new Date();
  const thisMonth = _clients.filter(c => {
    const d = new Date(c.created_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  setText('cl-total', _clients.length);
  setText('cl-this-month', thisMonth);
  // 案件保有顧客は案件データが必要なので後でロード
  fetchJSON('/api/projects').then(pj => {
    const ids = new Set(pj.filter(p => p.client_id).map(p => p.client_id));
    setText('cl-with-projects', ids.size);
  });
}

function renderClientsTable() {
  const tbody = document.getElementById('clients-table-body');
  if (!_clients.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">顧客がまだいません</td></tr>';
    return;
  }
  tbody.innerHTML = _clients.map(c => `
    <tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.email ?? '—')}</td>
      <td>${esc(c.phone ?? '—')}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="openClientDocs('${c.id}','${esc(c.name)}')">書類</button>
          <button class="btn btn-ghost btn-sm" onclick="openClientModal('${c.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteClient('${c.id}')">削除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openClientModal(id) {
  clearForm('modal-client', ['client-id','client-name','client-email','client-phone','client-address','client-notes']);
  if (id) {
    const c = _clients.find(c => c.id === id);
    if (!c) return;
    document.getElementById('modal-client-title').textContent = '顧客を編集';
    document.getElementById('client-id').value = c.id;
    document.getElementById('client-name').value = c.name;
    document.getElementById('client-email').value = c.email ?? '';
    document.getElementById('client-phone').value = c.phone ?? '';
    document.getElementById('client-address').value = c.address ?? '';
    document.getElementById('client-notes').value = c.notes ?? '';
  } else {
    document.getElementById('modal-client-title').textContent = '顧客を追加';
  }
  openModal('modal-client');
}

async function saveClient() {
  const id = document.getElementById('client-id').value;
  const body = {
    name:    document.getElementById('client-name').value.trim(),
    email:   document.getElementById('client-email').value.trim() || null,
    phone:   document.getElementById('client-phone').value.trim() || null,
    address: document.getElementById('client-address').value.trim() || null,
    notes:   document.getElementById('client-notes').value.trim() || null,
  };
  if (!body.name) return toast('顧客名を入力してください');
  const url = id ? `/api/clients/${id}` : '/api/clients';
  const method = id ? 'PUT' : 'POST';
  const res = await apiFetch(url, method, body);
  if (res.error) return toast(res.error, true);
  closeModal('modal-client');
  toast(id ? '顧客を更新しました' : '顧客を追加しました');
  loadClients();
}

async function deleteClient(id) {
  if (!confirm('この顧客を削除しますか？')) return;
  const res = await apiFetch(`/api/clients/${id}`, 'DELETE');
  toast('顧客を削除しました');
  loadClients();
}

// ============================================================
// 受注管理（Notion 優先・Supabase フォールバック）
// ============================================================
let _notionProjects = [];

// 進行度 → ステータスバッジ色クラスのマッピング
const NOTION_PROGRESS_CLASS = {
  '相談のみ':              'badge-pending',
  '見積もり作成中':        'badge-pending',
  '見積もり済み':          'badge-pending',
  '受注確定':              'badge-active',
  '契約締結':              'badge-active',
  'フェーズ１（LP制作）':  'badge-active',
  'フェース２（事務代行）':'badge-active',
  'フェーズ3（業務効率化）':'badge-active',
  '納品完了':              'badge-completed',
};

async function loadProjects() {
  // まず Notion データを試みる
  const notionRes = await fetchJSON('/api/external/notion/projects').catch(() => ({ configured: false, data: [] }));

  if (notionRes.configured && notionRes.data && notionRes.data.length > 0) {
    _notionProjects = notionRes.data;
    // Notion モードに切り替え
    document.getElementById('notion-projects-table').style.display = '';
    document.getElementById('local-projects-table').style.display = 'none';
    const banner = document.getElementById('notion-projects-banner');
    banner.style.display = 'flex';
    document.getElementById('notion-projects-link').href =
      'https://app.notion.com/p/0c2bb6607f9149a795621a6a312b3327';
    renderNotionProjectsTable();
    updateProjectStatsFromNotion();
  } else {
    // Supabase フォールバック
    _notionProjects = [];
    document.getElementById('notion-projects-table').style.display = 'none';
    document.getElementById('local-projects-table').style.display = '';
    document.getElementById('notion-projects-banner').style.display = 'none';
    [_projects, _clients] = await Promise.all([
      fetchJSON('/api/projects'),
      fetchJSON('/api/clients'),
    ]);
    updateProjectStats();
    renderProjectsTable();
  }
}

function updateProjectStatsFromNotion() {
  const total     = _notionProjects.length;
  const active    = _notionProjects.filter(p => ['受注確定','契約締結','フェーズ１（LP制作）','フェース２（事務代行）','フェーズ3（業務効率化）'].includes(p.progress)).length;
  const pending   = _notionProjects.filter(p => ['相談のみ','見積もり作成中','見積もり済み'].includes(p.progress)).length;
  const completed = _notionProjects.filter(p => p.progress === '納品完了').length;
  setText('pj-total', total);
  setText('pj-active', active);
  setText('pj-pending', pending);
  setText('pj-completed', completed);
}

function renderNotionProjectsTable() {
  const tbody = document.getElementById('notion-projects-body');
  if (!_notionProjects.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Notion に案件データがありません</td></tr>';
    return;
  }
  tbody.innerHTML = _notionProjects.map(p => {
    const cls  = NOTION_PROGRESS_CLASS[p.progress] ?? 'badge-pending';
    const paid = p.payment === '入金済'
      ? '<span class="badge badge-completed">入金済</span>'
      : p.payment === '未入金'
        ? '<span class="badge badge-overdue">未入金</span>'
        : '—';
    return `<tr>
      <td><strong>${esc(p.project_name || '—')}</strong></td>
      <td>${p.inquiry_date  ? fmtDate(p.inquiry_date)  : '—'}</td>
      <td>${esc(p.title)}</td>
      <td><span class="badge ${cls}">${esc(p.progress || '—')}</span></td>
      <td>${paid}</td>
      <td>${p.delivery_date ? fmtDate(p.delivery_date) : '—'}</td>
      <td>
        <a href="${esc(p.notion_url)}" target="_blank" class="btn btn-ghost btn-sm">Notionで開く</a>
      </td>
    </tr>`;
  }).join('');
}

function updateProjectStats() {
  const byStatus = s => _projects.filter(p => p.status === s).length;
  setText('pj-total', _projects.length);
  setText('pj-active', byStatus('active'));
  setText('pj-pending', byStatus('pending'));
  setText('pj-completed', byStatus('completed'));
}

function renderProjectsTable() {
  const filter = document.getElementById('project-status-filter')?.value ?? '';
  const tbody = document.getElementById('projects-table-body');
  const list = filter ? _projects.filter(p => p.status === filter) : _projects;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">案件がありません</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p => {
    const clientName = p.clients?.name ?? '—';
    const clientCell = p.client_id
      ? `<a href="#" class="client-link" onclick="showClientCard('${p.client_id}');return false;" style="color:var(--accent);text-decoration:none;border-bottom:1px dashed var(--accent);">${esc(clientName)}</a>`
      : esc(clientName);
    return `
    <tr>
      <td><strong>${esc(p.title)}</strong></td>
      <td>${clientCell}</td>
      <td>${statusBadge(p.status, 'project')}</td>
      <td>${p.budget ? '¥' + fmt(p.budget) : '—'}</td>
      <td>${p.start_date ? fmtDate(p.start_date) : '—'}</td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="openProjectDocs('${p.id}','${esc(p.title)}')">書類</button>
          <button class="btn btn-ghost btn-sm" onclick="openProjectModal('${p.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">削除</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// 顧客カード表示
async function showClientCard(clientId) {
  const client = await fetchJSON(`/api/clients/${clientId}`).catch(() => null);
  if (!client) return;

  setText('cc-name',    client.name || '');
  setText('cc-company', client.company || '');
  setText('cc-contact', client.contact_name || '');
  setText('cc-email',   client.email || '');
  setText('cc-phone',   client.phone || '');
  setText('cc-address', client.address || '');
  setText('cc-notes',   client.notes || '');
  setText('cc-created', fmtDate(client.created_at));

  // 備考行：内容がなければ非表示
  document.getElementById('cc-notes-row').style.display = client.notes ? '' : 'none';

  // 関連案件
  const projects = (client.projects || []);
  const ccProjects = document.getElementById('cc-projects');
  if (!projects.length) {
    ccProjects.innerHTML = '<span style="font-size:13px;color:var(--text-muted)">関連案件なし</span>';
  } else {
    ccProjects.innerHTML = projects.map(p => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:var(--bg); border-radius:6px; font-size:13px;">
        <span>${esc(p.title)}</span>
        ${statusBadge(p.status, 'project')}
      </div>`).join('');
  }

  // 編集ボタン
  document.getElementById('cc-edit-btn').onclick = () => {
    closeModal('modal-client-card');
    openClientModal(clientId);
  };

  openModal('modal-client-card');
}

async function openProjectModal(id) {
  clearForm('modal-project', ['project-id','project-title','project-budget','project-start','project-end','project-description']);
  document.getElementById('project-client-name').value = '';
  document.getElementById('project-save-client').checked = false;

  // datalist に保存済み顧客名 + Supabase clients をセット
  const saved = await fetchJSON('/api/client-names').catch(() => []);
  const combined = [...new Set([...saved, ..._clients.map(c => c.name)])].sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('client-datalist').innerHTML = combined.map(n => `<option value="${esc(n)}">`).join('');

  if (id) {
    const p = _projects.find(p => p.id === id);
    if (!p) return;
    document.getElementById('modal-project-title').textContent = '案件を編集';
    document.getElementById('project-id').value = p.id;
    document.getElementById('project-title').value = p.title;
    // client_id → 顧客名に変換して表示
    const clientName = _clients.find(c => c.id === p.client_id)?.name ?? '';
    document.getElementById('project-client-name').value = clientName;
    document.getElementById('project-status').value = p.status;
    document.getElementById('project-start').value = p.start_date ?? '';
    document.getElementById('project-end').value = p.end_date ?? '';
    document.getElementById('project-budget').value = p.budget ?? '';
    document.getElementById('project-description').value = p.description ?? '';
  } else {
    document.getElementById('modal-project-title').textContent = '案件を追加';
  }
  openModal('modal-project');
}

async function saveProject() {
  const id = document.getElementById('project-id').value;
  const clientNameInput = document.getElementById('project-client-name').value.trim();
  const saveClientFlag  = document.getElementById('project-save-client').checked;

  // 顧客名 → client_id を解決
  let clientId = null;
  if (clientNameInput) {
    const existing = _clients.find(c => c.name === clientNameInput);
    if (existing) {
      clientId = existing.id;
    } else if (saveClientFlag) {
      // Supabase clients テーブルに新規登録
      const newClient = await apiFetch('/api/clients', 'POST', { name: clientNameInput });
      if (!newClient.error) {
        clientId = newClient.id;
        _clients.push(newClient);
      }
    }
    // clients.json にも保存
    if (saveClientFlag) {
      await fetch('/api/client-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clientNameInput }),
      });
    }
  }

  const body = {
    title:       document.getElementById('project-title').value.trim(),
    client_id:   clientId,
    status:      document.getElementById('project-status').value,
    start_date:  document.getElementById('project-start').value || null,
    end_date:    document.getElementById('project-end').value || null,
    budget:      Number(document.getElementById('project-budget').value) || 0,
    description: document.getElementById('project-description').value.trim() || null,
  };
  if (!body.title) return toast('案件名を入力してください');
  const url = id ? `/api/projects/${id}` : '/api/projects';
  const method = id ? 'PUT' : 'POST';
  const res = await apiFetch(url, method, body);
  if (res.error) return toast(res.error, true);
  closeModal('modal-project');
  toast(id ? '案件を更新しました' : '案件を追加しました');
  loadProjects();
}

async function deleteProject(id) {
  if (!confirm('この案件を削除しますか？')) return;
  await apiFetch(`/api/projects/${id}`, 'DELETE');
  toast('案件を削除しました');
  loadProjects();
}

// ============================================================
// 財務
// ============================================================
async function loadFinance() {
  [_invoices, _expenses, _clients, _projects, _quotes] = await Promise.all([
    fetchJSON('/api/invoices'),
    fetchJSON('/api/expenses'),
    fetchJSON('/api/clients'),
    fetchJSON('/api/projects'),
    fetchJSON('/api/quotes'),
  ]);
  updateFinanceStats();
  renderInvoicesQuotesTable();
  renderExpensesTable();
}

function updateFinanceStats() {
  const paid = _invoices.filter(i => i.status === 'paid')
    .reduce((s, i) => s + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);
  const unpaid = _invoices.filter(i => ['sent','overdue'].includes(i.status))
    .reduce((s, i) => s + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);
  const exp = _expenses.reduce((s, e) => s + Number(e.amount), 0);
  setText('fi-paid',     '¥' + fmt(Math.round(paid)));
  setText('fi-unpaid',   '¥' + fmt(Math.round(unpaid)));
  setText('fi-expenses', '¥' + fmt(exp));
  setText('fi-profit',   '¥' + fmt(Math.round(paid) - exp));
}

// 請求・見積 統合テーブル
function renderInvoicesQuotesTable() {
  const tbody = document.getElementById('invoices-quotes-body');
  const filter = document.getElementById('fi-doc-filter')?.value ?? '';

  let rows = [];
  if (filter !== 'quote') {
    rows = rows.concat(_invoices.map(i => ({ ...i, _type: 'invoice' })));
  }
  if (filter !== 'invoice') {
    rows = rows.concat(_quotes.map(q => ({ ...q, _type: 'quote' })));
  }

  // 発行日の新しい順
  rows.sort((a, b) => {
    const da = a.issue_date ?? '';
    const db = b.issue_date ?? '';
    return db.localeCompare(da);
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">${filter === 'invoice' ? '請求' : filter === 'quote' ? '見積' : '請求・見積'}がありません</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(row => {
    const isInvoice = row._type === 'invoice';
    const typeBadge = isInvoice
      ? '<span class="badge badge-active" style="font-size:11px;">請求</span>'
      : '<span class="badge badge-pending" style="font-size:11px;">見積</span>';
    const statusType = isInvoice ? 'invoice' : 'quote';
    const statusOptions = isInvoice
      ? [['draft','下書き'],['sent','送付済'],['paid','入金済'],['overdue','期限超過']]
      : [['draft','下書き'],['sent','送付済'],['accepted','承認済'],['rejected','却下']];
    const statusSelect = `<select class="inline-status-select" onchange="${isInvoice ? 'updateInvoiceStatus' : 'updateQuoteStatus'}('${row.id}', this.value)">
      ${statusOptions.map(([v, l]) => `<option value="${v}"${row.status === v ? ' selected' : ''}>${l}</option>`).join('')}
    </select>`;
    const deadline = isInvoice
      ? (row.due_date ? fmtDate(row.due_date) : '—')
      : (row.valid_until ? fmtDate(row.valid_until) : '—');
    const pdfBtn = isInvoice
      ? `<button class="btn btn-ghost btn-sm" title="PDF生成＆OneDrive保存" onclick="downloadInvoicePdf('${row.id}')">PDF</button>`
      : `<button class="btn btn-ghost btn-sm" title="PDF生成" onclick="downloadQuotePdf('${row.id}')">PDF</button>`;
    const actions = isInvoice
      ? `<button class="btn btn-ghost btn-sm" onclick="openInvoiceModal('${row.id}')">編集</button>
         <button class="btn btn-danger btn-sm" onclick="deleteInvoice('${row.id}')">削除</button>`
      : `${row.status !== 'accepted' ? `<button class="btn btn-ghost btn-sm" onclick="convertQuote('${row.id}')">請求書化</button>` : ''}
         <button class="btn btn-ghost btn-sm" onclick="openQuoteModal('${row.id}')">編集</button>
         <button class="btn btn-danger btn-sm" onclick="deleteQuote('${row.id}')">削除</button>`;

    return `<tr>
      <td>${typeBadge}</td>
      <td>${esc(row.clients?.name ?? '—')}</td>
      <td>${esc(row.projects?.title ?? '—')}</td>
      <td>¥${fmt(Math.round(Number(row.amount) * (1 + Number(row.tax_rate)/100)))}</td>
      <td>${statusSelect}</td>
      <td>${row.issue_date ? fmtDate(row.issue_date) : '—'}</td>
      <td>${deadline}</td>
      <td>${pdfBtn}</td>
      <td><div class="actions">${actions}</div></td>
    </tr>`;
  }).join('');
}

async function updateInvoiceStatus(id, status) {
  const res = await apiFetch(`/api/invoices/${id}`, 'PUT', { status });
  if (res.error) { toast(res.error, true); loadFinance(); return; }
  const inv = _invoices.find(i => i.id === id);
  if (inv) inv.status = status;
  updateFinanceStats();
  toast('ステータスを更新しました');
}

async function updateQuoteStatus(id, status) {
  const res = await apiFetch(`/api/quotes/${id}`, 'PUT', { status });
  if (res.error) { toast(res.error, true); loadFinance(); return; }
  const q = _quotes.find(q => q.id === id);
  if (q) q.status = status;
  updateFinanceStats();
  toast('ステータスを更新しました');
}

function renderExpensesTable() {
  const tbody = document.getElementById('expenses-table-body');
  if (!_expenses.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">経費がありません</td></tr>';
    return;
  }
  tbody.innerHTML = _expenses.map(e => `
    <tr>
      <td>${fmtDate(e.expense_date)}</td>
      <td><span class="badge badge-pending">${esc(e.category)}</span></td>
      <td>${esc(e.description)}</td>
      <td>${esc(e.projects?.title ?? '—')}</td>
      <td>¥${fmt(Number(e.amount))}</td>
      <td>
        <div class="actions">
          <button class="btn btn-ghost btn-sm" onclick="openExpenseModal('${e.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">削除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function openInvoiceModal(id) {
  clearForm('modal-invoice', ['invoice-id','invoice-amount','invoice-notes','invoice-issue-date','invoice-due-date']);
  document.getElementById('invoice-client-name').value = '';
  document.getElementById('invoice-project-name').value = '';
  document.getElementById('invoice-save-client').checked = false;

  // datalist をセット
  const saved = await fetchJSON('/api/client-names').catch(() => []);
  const clientNames = [...new Set([...saved, ..._clients.map(c => c.name)])].sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('invoice-client-datalist').innerHTML = clientNames.map(n => `<option value="${esc(n)}">`).join('');
  const projectTitles = _projects.map(p => p.title).sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('invoice-project-datalist').innerHTML = projectTitles.map(t => `<option value="${esc(t)}">`).join('');

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('invoice-issue-date').value = today;

  if (id) {
    const inv = _invoices.find(i => i.id === id);
    if (!inv) return;
    document.getElementById('modal-invoice-title').textContent = '請求を編集';
    document.getElementById('invoice-id').value = inv.id;
    document.getElementById('invoice-client-name').value = inv.clients?.name ?? _clients.find(c => c.id === inv.client_id)?.name ?? '';
    document.getElementById('invoice-project-name').value = inv.projects?.title ?? _projects.find(p => p.id === inv.project_id)?.title ?? '';
    document.getElementById('invoice-amount').value = inv.amount;
    document.getElementById('invoice-status').value = inv.status;
    document.getElementById('invoice-issue-date').value = inv.issue_date ?? today;
    document.getElementById('invoice-due-date').value = inv.due_date ?? '';
    document.getElementById('invoice-notes').value = inv.notes ?? '';
  } else {
    document.getElementById('modal-invoice-title').textContent = '請求を追加';
  }
  openModal('modal-invoice');
}

async function saveInvoice() {
  const id = document.getElementById('invoice-id').value;
  const clientNameInput = document.getElementById('invoice-client-name').value.trim();
  const projectNameInput = document.getElementById('invoice-project-name').value.trim();
  const saveClientFlag   = document.getElementById('invoice-save-client').checked;

  // 顧客名 → client_id
  let clientId = null;
  if (clientNameInput) {
    const existing = _clients.find(c => c.name === clientNameInput);
    if (existing) {
      clientId = existing.id;
    } else if (saveClientFlag) {
      const newClient = await apiFetch('/api/clients', 'POST', { name: clientNameInput });
      if (!newClient.error) { clientId = newClient.id; _clients.push(newClient); }
    }
    if (saveClientFlag) {
      await fetch('/api/client-names', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: clientNameInput }) });
    }
  }

  // 案件名 → project_id
  let projectId = null;
  if (projectNameInput) {
    const existing = _projects.find(p => p.title === projectNameInput);
    if (existing) projectId = existing.id;
  }

  const body = {
    client_id:  clientId,
    project_id: projectId,
    amount:     Number(document.getElementById('invoice-amount').value) || 0,
    status:     document.getElementById('invoice-status').value,
    issue_date: document.getElementById('invoice-issue-date').value || null,
    due_date:   document.getElementById('invoice-due-date').value || null,
    notes:      document.getElementById('invoice-notes').value.trim() || null,
  };
  if (!body.amount) return toast('金額を入力してください');
  const url = id ? `/api/invoices/${id}` : '/api/invoices';
  const method = id ? 'PUT' : 'POST';
  const res = await apiFetch(url, method, body);
  if (res.error) return toast(res.error, true);
  closeModal('modal-invoice');
  toast(id ? '請求を更新しました' : '請求を追加しました');
  loadFinance();
}

async function deleteInvoice(id) {
  if (!confirm('この請求を削除しますか？')) return;
  await apiFetch(`/api/invoices/${id}`, 'DELETE');
  toast('請求を削除しました');
  loadFinance();
}

function openExpenseModal(id) {
  clearForm('modal-expense', ['expense-id','expense-description','expense-amount','expense-date']);
  populateSelect('expense-project', _projects, 'id', 'title', '— 案件を選択 —');
  document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];

  if (id) {
    const e = _expenses.find(e => e.id === id);
    if (!e) return;
    document.getElementById('modal-expense-title').textContent = '経費を編集';
    document.getElementById('expense-id').value = e.id;
    document.getElementById('expense-category').value = e.category;
    document.getElementById('expense-project').value = e.project_id ?? '';
    document.getElementById('expense-description').value = e.description;
    document.getElementById('expense-amount').value = e.amount;
    document.getElementById('expense-date').value = e.expense_date;
  } else {
    document.getElementById('modal-expense-title').textContent = '経費を追加';
  }
  openModal('modal-expense');
}

async function saveExpense() {
  const id = document.getElementById('expense-id').value;
  const body = {
    category:    document.getElementById('expense-category').value,
    project_id:  document.getElementById('expense-project').value || null,
    description: document.getElementById('expense-description').value.trim(),
    amount:      Number(document.getElementById('expense-amount').value) || 0,
    expense_date: document.getElementById('expense-date').value,
  };
  if (!body.description) return toast('内容を入力してください');
  if (!body.amount) return toast('金額を入力してください');
  const url = id ? `/api/expenses/${id}` : '/api/expenses';
  const method = id ? 'PUT' : 'POST';
  const res = await apiFetch(url, method, body);
  if (res.error) return toast(res.error, true);
  closeModal('modal-expense');
  toast(id ? '経費を更新しました' : '経費を追加しました');
  loadFinance();
}

async function deleteExpense(id) {
  if (!confirm('この経費を削除しますか？')) return;
  await apiFetch(`/api/expenses/${id}`, 'DELETE');
  toast('経費を削除しました');
  loadFinance();
}

// ============================================================
// ユーティリティ
// ============================================================
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

async function apiFetch(url, method, body) {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 204) return {};
    return r.json();
  } catch (e) { return { error: e.message }; }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function fmt(n) {
  return Number(n).toLocaleString('ja-JP');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' });
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const STATUS_LABELS = {
  project: { pending:'未着手', active:'進行中', completed:'完了', cancelled:'キャンセル' },
  invoice: { draft:'下書き', sent:'送付済', paid:'入金済', overdue:'期限超過' },
  quote:   { draft:'下書き', sent:'送付済', accepted:'承認済', rejected:'却下' },
};

function statusBadge(status, type) {
  const label = STATUS_LABELS[type]?.[status] ?? status;
  return `<span class="badge badge-${status}">${label}</span>`;
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ============================================================
// ビジネスニュースパネル
// ============================================================

// 簡易マークダウン → HTML 変換
function md2html(text) {
  if (!text) return '';
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    // 見出し
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h2>$1</h2>')
    // 太字
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // リンク
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // 箇条書き
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    // 段落（空行で区切る）
    .replace(/\n\n+/g, '</p><p>')
    .replace(/^(?!<[a-z])(.+)$/gm, (m) => m.startsWith('<') ? m : m);
}

// 曜日の日本語ラベル
const WEEKDAY_JA_MAP = {
  monday:'月曜日', tuesday:'火曜日', wednesday:'水曜日',
  thursday:'木曜日', friday:'金曜日', saturday:'土曜日', sunday:'日曜日'
};

let _newsCache = [];

async function loadNewsPanel() {
  const todayEl   = document.getElementById('news-today');
  const historyEl = document.getElementById('news-history-list');
  if (!todayEl) return;

  todayEl.innerHTML = '<span style="color:var(--text-muted)">読み込み中...</span>';

  const news = await fetchJSON('/api/news/week').catch(() => []);
  _newsCache = news;

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayNews = news.find(n => n.date === todayStr);
  const pastNews  = news.filter(n => n.date !== todayStr).slice(0, 6);

  // 当日ニュース表示
  if (todayNews && todayNews.content) {
    todayEl.innerHTML = md2html(todayNews.content);
  } else {
    todayEl.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">本日のニュースはまだありません。<br>朝8時のブリーフィング実行後に更新されます。</span>';
  }

  // 過去6日分ボタン
  if (!pastNews.length) {
    historyEl.innerHTML = '<span style="font-size:11px; color:var(--text-muted)">過去の記事なし</span>';
    return;
  }
  historyEl.innerHTML = pastNews.map(n => {
    const d = new Date(n.date);
    const label = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${n.weekday_ja || ''}）`;
    return `<button onclick="openNewsModal('${n.date}')">${label}</button>`;
  }).join('');
}

function openNewsModal(date) {
  const item = _newsCache.find(n => n.date === date);
  if (!item) return;
  const d = new Date(date);
  const title = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${item.weekday_ja || ''}）の記事`;
  document.getElementById('modal-news-title').textContent = title;
  document.getElementById('modal-news-body').innerHTML = md2html(item.content);
  openModal('modal-news');
}


function clearForm(modalId, fieldIds) {
  fieldIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function populateSelect(selectId, items, valKey, labelKey, placeholder) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map(i => `<option value="${i[valKey]}">${esc(i[labelKey])}</option>`).join('');
}

let _toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = isError ? '#c0392b' : '#1a1a18';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ============================================================
// 見積
// ============================================================
async function loadQuotes() {
  [_quotes, _clients, _projects] = await Promise.all([
    fetchJSON('/api/quotes'),
    fetchJSON('/api/clients'),
    fetchJSON('/api/projects'),
  ]);
  updateQuoteStats();
  renderQuotesTable();
}

function updateQuoteStats() {
  const total = _quotes.reduce((s, q) => s + Math.round(Number(q.amount) * (1 + Number(q.tax_rate) / 100)), 0);
  setText('qt-total',        _quotes.length);
  setText('qt-accepted',     _quotes.filter(q => q.status === 'accepted').length);
  setText('qt-sent',         _quotes.filter(q => q.status === 'sent').length);
  setText('qt-total-amount', '¥' + fmt(total));
}

function renderQuotesTable() {
  const tbody = document.getElementById('quotes-table-body');
  if (!_quotes.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">見積がありません</td></tr>';
    return;
  }
  tbody.innerHTML = _quotes.map(q => `
    <tr>
      <td>${esc(q.projects?.title ?? '—')}</td>
      <td>${esc(q.clients?.name ?? '—')}</td>
      <td>¥${fmt(Math.round(Number(q.amount) * (1 + Number(q.tax_rate)/100)))}</td>
      <td>${statusBadge(q.status, 'quote')}</td>
      <td>${q.issue_date ? fmtDate(q.issue_date) : '—'}</td>
      <td>${q.valid_until ? fmtDate(q.valid_until) : '—'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" title="PDF生成" onclick="downloadQuotePdf('${q.id}')">PDF</button>
      </td>
      <td>
        <div class="actions">
          ${q.status !== 'accepted' ? `<button class="btn btn-ghost btn-sm" onclick="convertQuote('${q.id}')">請求書化</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="openQuoteModal('${q.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteQuote('${q.id}')">削除</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function openQuoteModal(id) {
  clearForm('modal-quote', ['quote-id','quote-amount','quote-notes','quote-issue-date','quote-valid-until']);
  document.getElementById('quote-client-name').value = '';
  document.getElementById('quote-project-name').value = '';
  document.getElementById('quote-save-client').checked = false;

  // datalist をセット
  const saved = await fetchJSON('/api/client-names').catch(() => []);
  const clientNames = [...new Set([...saved, ..._clients.map(c => c.name)])].sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('quote-client-datalist').innerHTML = clientNames.map(n => `<option value="${esc(n)}">`).join('');
  const projectTitles = _projects.map(p => p.title).sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('quote-project-datalist').innerHTML = projectTitles.map(t => `<option value="${esc(t)}">`).join('');

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('quote-issue-date').value = today;

  if (id) {
    const q = _quotes.find(q => q.id === id);
    if (!q) return;
    document.getElementById('modal-quote-title').textContent = '見積を編集';
    document.getElementById('quote-id').value = q.id;
    document.getElementById('quote-client-name').value = q.clients?.name ?? _clients.find(c => c.id === q.client_id)?.name ?? '';
    document.getElementById('quote-project-name').value = q.projects?.title ?? _projects.find(p => p.id === q.project_id)?.title ?? '';
    document.getElementById('quote-amount').value = q.amount;
    document.getElementById('quote-status').value = q.status;
    document.getElementById('quote-issue-date').value = q.issue_date ?? today;
    document.getElementById('quote-valid-until').value = q.valid_until ?? '';
    document.getElementById('quote-notes').value = q.notes ?? '';
  } else {
    document.getElementById('modal-quote-title').textContent = '見積を追加';
  }
  openModal('modal-quote');
}

async function saveQuote() {
  const id = document.getElementById('quote-id').value;
  const clientNameInput = document.getElementById('quote-client-name').value.trim();
  const projectNameInput = document.getElementById('quote-project-name').value.trim();
  const saveClientFlag   = document.getElementById('quote-save-client').checked;

  // 顧客名 → client_id
  let clientId = null;
  if (clientNameInput) {
    const existing = _clients.find(c => c.name === clientNameInput);
    if (existing) {
      clientId = existing.id;
    } else if (saveClientFlag) {
      const newClient = await apiFetch('/api/clients', 'POST', { name: clientNameInput });
      if (!newClient.error) { clientId = newClient.id; _clients.push(newClient); }
    }
    if (saveClientFlag) {
      await fetch('/api/client-names', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ name: clientNameInput }) });
    }
  }

  // 案件名 → project_id
  let projectId = null;
  if (projectNameInput) {
    const existing = _projects.find(p => p.title === projectNameInput);
    if (existing) projectId = existing.id;
  }

  const body = {
    client_id:   clientId,
    project_id:  projectId,
    amount:      Number(document.getElementById('quote-amount').value) || 0,
    status:      document.getElementById('quote-status').value,
    issue_date:  document.getElementById('quote-issue-date').value || null,
    valid_until: document.getElementById('quote-valid-until').value || null,
    notes:       document.getElementById('quote-notes').value.trim() || null,
  };
  if (!body.amount) return toast('金額を入力してください');
  const url = id ? `/api/quotes/${id}` : '/api/quotes';
  const method = id ? 'PUT' : 'POST';
  const res = await apiFetch(url, method, body);
  if (res.error) return toast(res.error, true);
  closeModal('modal-quote');
  toast(id ? '見積を更新しました' : '見積を追加しました');
  loadFinance();
}

async function deleteQuote(id) {
  if (!confirm('この見積を削除しますか？')) return;
  await apiFetch(`/api/quotes/${id}`, 'DELETE');
  toast('削除しました');
  loadFinance();
}

async function convertQuote(id) {
  if (!confirm('この見積を請求書に変換しますか？')) return;
  const res = await apiFetch(`/api/quotes/${id}/convert`, 'POST');
  if (res.error) return toast(res.error, true);
  toast('請求書を作成しました。');
  loadFinance();
}

async function downloadQuotePdf(id) {
  toast('PDF を生成中...');
  try {
    const res = await fetch(`/api/quotes/${id}/pdf`);
    if (!res.ok) { toast('PDF生成に失敗しました', true); return; }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') ?? '';
    const match = cd.match(/filename\*=UTF-8''(.+)/);
    const filename = match ? decodeURIComponent(match[1]) : '見積書.pdf';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast('PDF を保存しました');
  } catch (e) {
    toast('エラー: ' + e.message, true);
  }
}

// ============================================================
// 請求書 PDF ダウンロード → サーバー → Make → OneDrive
// ============================================================
async function downloadInvoicePdf(id) {
  toast('PDF を生成中...');
  try {
    const res = await fetch(`/api/invoices/${id}/pdf`);
    if (!res.ok) { toast('PDF生成に失敗しました', true); return; }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') ?? '';
    const match = cd.match(/filename\*=UTF-8''(.+)/);
    const filename = match ? decodeURIComponent(match[1]) : '請求書.pdf';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    toast('PDF を保存しました（OneDriveにも転送中）');
  } catch (e) {
    toast('エラー: ' + e.message, true);
  }
}

// ============================================================
// 書類アップロード
// ============================================================
let _uploadContext = { entity_type: '', entity_id: '', entity_name: '' };

function openClientDocs(clientId, clientName) {
  _uploadContext = { entity_type: 'client', entity_id: clientId, entity_name: clientName };
  document.getElementById('client-docs-title').textContent = `書類 — ${clientName}`;
  document.getElementById('client-docs-section').style.display = 'block';
  loadDocs('client', clientId, 'client-docs-body');
}

function openProjectDocs(projectId, projectTitle) {
  _uploadContext = { entity_type: 'project', entity_id: projectId, entity_name: projectTitle };
  document.getElementById('project-docs-title').textContent = `書類 — ${projectTitle}`;
  document.getElementById('project-docs-section').style.display = 'block';
  loadDocs('project', projectId, 'project-docs-body');
}

async function loadDocs(entityType, entityId, tbodyId) {
  const docs = await fetchJSON(`/api/documents/${entityType}/${entityId}`);
  const tbody = document.getElementById(tbodyId);
  if (!docs.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty" style="padding:16px;">書類がまだありません</td></tr>';
    return;
  }
  tbody.innerHTML = docs.map(d => `
    <tr>
      <td>📄 ${esc(d.filename)}</td>
      <td>${fmtDate(d.created_at)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteDoc('${d.id}','${entityType}','${entityId}')">削除</button></td>
    </tr>
  `).join('');
}

async function deleteDoc(id, entityType, entityId) {
  if (!confirm('この書類記録を削除しますか？（OneDrive上のファイルは手動で削除してください）')) return;
  await apiFetch(`/api/documents/${id}`, 'DELETE');
  toast('削除しました');
  const tbodyId = entityType === 'client' ? 'client-docs-body' : 'project-docs-body';
  loadDocs(entityType, entityId, tbodyId);
}

function handleFileDrop(event, scope) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file) return;
  uploadFileObject(file, scope);
}

function uploadFile(scope) {
  const input = document.getElementById(`${scope}-file-input`);
  const file = input.files[0];
  if (!file) return;
  uploadFileObject(file, scope);
  input.value = '';
}

async function uploadFileObject(file, scope) {
  if (!_uploadContext.entity_id) { toast('先に顧客または案件を選択してください', true); return; }
  toast(`${file.name} をアップロード中...`);
  const formData = new FormData();
  formData.append('file', file);
  formData.append('entity_type', _uploadContext.entity_type);
  formData.append('entity_id', _uploadContext.entity_id);
  formData.append('entity_name', _uploadContext.entity_name);
  try {
    const res = await fetch('/api/documents/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { toast(data.error, true); return; }
    toast(data.make_sent ? 'アップロード完了（OneDriveに転送しました）' : 'アップロード完了（Make連携を確認してください）');
    const tbodyId = scope === 'client' ? 'client-docs-body' : 'project-docs-body';
    loadDocs(_uploadContext.entity_type, _uploadContext.entity_id, tbodyId);
  } catch (e) {
    toast('エラー: ' + e.message, true);
  }
}

// モーダル外クリックで閉じる
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// 初期ロード
loadDashboard();
