/* ============================================================
   つむぎワークス 運営管理アプリ — フロントエンドロジック
   ============================================================ */

const API = '';  // same-origin

// ── キャッシュ ──
let _clients  = [];
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

  const [projects, dash] = await Promise.all([
    fetchJSON('/api/projects'),
    fetchJSON('/api/dashboard'),
  ]);

  const ACTIVE_PROGRESSES = ['受注確定','契約締結','フェーズ１（LP制作）','フェース２（事務代行）','フェーズ3（業務効率化）'];
  const PENDING_PROGRESSES = ['相談のみ','見積もり作成中','見積もり済み'];

  const total     = projects.length;
  const pending   = projects.filter(p => PENDING_PROGRESSES.includes(p.progress)).length;
  const active    = projects.filter(p => ACTIVE_PROGRESSES.includes(p.progress)).length;
  const completed = projects.filter(p => p.progress === '納品完了').length;

  setText('dc-total',     total);
  setText('dc-pending',   pending);
  setText('dc-active',    active);
  setText('dc-completed', completed);
  setText('dc-paid',   '¥' + fmt(dash.paidRevenue ?? 0));
  setText('dc-profit', '¥' + fmt(dash.profit ?? 0));

  const tbody = document.getElementById('dash-projects-body');
  const recent = projects.slice(0, 5);
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">案件がまだありません</td></tr>';
  } else {
    tbody.innerHTML = recent.map(p => {
      const cls = progressBadgeClass(p.progress);
      return `<tr>
        <td>${esc(p.title)}</td>
        <td>${esc(p.clients?.name ?? '—')}</td>
        <td><span class="badge ${cls}">${esc(p.progress || '—')}</span></td>
        <td>${p.start_date ? fmtDate(p.start_date) : '—'}</td>
      </tr>`;
    }).join('');
  }

  loadExternalStatus();
  loadCalendarEvents();
  loadNewsPanel();
}

// ============================================================
// 外部サービス集約（Google Calendar）
// ============================================================

async function loadExternalStatus() {
  const status = await fetchJSON('/api/external/status').catch(() => ({}));
  const banner = document.getElementById('ext-setup-banner');
  const items  = document.getElementById('ext-setup-items');
  const msgs = [];
  if (!status.google_calendar && !status.google_auth_required) {
    msgs.push('Googleカレンダー 未接続 — GOOGLE_CLIENT_ID を .env に追加してください');
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
  const fields = ['client-id','client-last-name','client-first-name','client-last-name-kana','client-first-name-kana',
                  'client-company','client-email','client-phone','client-postal-code','client-address','client-notes'];
  clearForm('modal-client', fields);
  if (id) {
    const c = _clients.find(c => c.id === id);
    if (!c) return;
    document.getElementById('modal-client-title').textContent = '顧客を編集';
    document.getElementById('client-id').value             = c.id;
    document.getElementById('client-last-name').value      = c.last_name ?? '';
    document.getElementById('client-first-name').value     = c.first_name ?? '';
    document.getElementById('client-last-name-kana').value = c.last_name_kana ?? '';
    document.getElementById('client-first-name-kana').value= c.first_name_kana ?? '';
    document.getElementById('client-company').value        = c.company ?? '';
    document.getElementById('client-email').value          = c.email ?? '';
    document.getElementById('client-phone').value          = c.phone ?? '';
    document.getElementById('client-postal-code').value    = c.postal_code ?? '';
    document.getElementById('client-address').value        = c.address ?? '';
    document.getElementById('client-notes').value          = c.notes ?? '';
  } else {
    document.getElementById('modal-client-title').textContent = '顧客を追加';
  }
  openModal('modal-client');
}

async function saveClient() {
  const id = document.getElementById('client-id').value;
  const lastName  = document.getElementById('client-last-name').value.trim();
  const firstName = document.getElementById('client-first-name').value.trim();
  if (!lastName) return toast('姓を入力してください');
  const body = {
    last_name:       lastName,
    first_name:      firstName || null,
    last_name_kana:  document.getElementById('client-last-name-kana').value.trim() || null,
    first_name_kana: document.getElementById('client-first-name-kana').value.trim() || null,
    company:         document.getElementById('client-company').value.trim() || null,
    email:           document.getElementById('client-email').value.trim() || null,
    phone:           document.getElementById('client-phone').value.trim() || null,
    postal_code:     document.getElementById('client-postal-code').value.trim() || null,
    address:         document.getElementById('client-address').value.trim() || null,
    notes:           document.getElementById('client-notes').value.trim() || null,
  };
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
// 受注管理（Supabase完結）
// ============================================================

// 進行度 → バッジ色クラス
function progressBadgeClass(progress) {
  const ACTIVE = ['受注確定','契約締結','フェーズ１（LP制作）','フェース２（事務代行）','フェーズ3（業務効率化）'];
  const PENDING = ['相談のみ','見積もり作成中','見積もり済み'];
  if (ACTIVE.includes(progress))   return 'badge-active';
  if (PENDING.includes(progress))  return 'badge-pending';
  if (progress === '納品完了')      return 'badge-completed';
  return 'badge-pending';
}

async function loadProjects() {
  const [projects, clients, invoices, quotes] = await Promise.all([
    fetchJSON('/api/projects'),
    fetchJSON('/api/clients'),
    fetchJSON('/api/invoices'),
    fetchJSON('/api/quotes'),
  ]);
  _projects = projects;
  _clients  = clients;
  _invoices = invoices;
  _quotes   = quotes;
  updateProjectStats();
  renderUnifiedProjectsTable();
}

// 進行度 → ステータス分類
const PROGRESS_CATEGORY = {
  ACTIVE:   ['受注確定','契約締結','フェーズ１（LP制作）','フェース２（事務代行）','フェーズ3（業務効率化）'],
  PENDING:  ['相談のみ','見積もり作成中','見積もり済み'],
  COMPLETED:['納品完了'],
};

const PROGRESS_OPTIONS = [
  '相談のみ','見積もり作成中','見積もり済み',
  '受注確定','契約締結',
  'フェーズ１（LP制作）','フェース２（事務代行）','フェーズ3（業務効率化）',
  '納品完了',
];
const PAYMENT_OPTIONS = ['未入金','請求書送付済','入金済'];

function updateProjectStats() {
  const total     = _projects.length;
  const active    = _projects.filter(p => PROGRESS_CATEGORY.ACTIVE.includes(p.progress)).length;
  const pending   = _projects.filter(p => PROGRESS_CATEGORY.PENDING.includes(p.progress)).length;
  const completed = _projects.filter(p => PROGRESS_CATEGORY.COMPLETED.includes(p.progress)).length;
  setText('pj-total',     total);
  setText('pj-active',    active);
  setText('pj-pending',   pending);
  setText('pj-completed', completed);
}

// 案件フィールドをインライン更新（PATCH）
async function updateProjectField(id, field, value) {
  const body = {};
  body[field] = value;
  const res = await apiFetch(`/api/projects/${id}`, 'PATCH', body);
  if (res.error) { toast(res.error, true); return; }
  const p = _projects.find(p => p.id === id);
  if (p) p[field] = value;
  updateProjectStats();
  toast('更新しました');
}

// ── 受注一覧テーブル ──
// フィルタータブの状態
let _projectFilter = '';

function setProjectFilter(btn, filter) {
  _projectFilter = filter;
  document.querySelectorAll('#project-filter-tabs .filter-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderUnifiedProjectsTable();
}

function renderUnifiedProjectsTable() {
  const tbody = document.getElementById('projects-unified-body');
  let rows = [..._projects];

  // フィルター
  if (_projectFilter) {
    rows = rows.filter(row => {
      if (_projectFilter === 'active')    return PROGRESS_CATEGORY.ACTIVE.includes(row.progress);
      if (_projectFilter === 'pending')   return PROGRESS_CATEGORY.PENDING.includes(row.progress);
      if (_projectFilter === 'completed') return PROGRESS_CATEGORY.COMPLETED.includes(row.progress);
      return true;
    });
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">案件がありません</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => {
    // 顧客名（クリックで連絡先ポップアップ）
    const clientName = row.clients?.name ?? '—';
    let clientCell = esc(clientName);
    if (row.client_id) {
      const c = _clients.find(c => c.id === row.client_id);
      if (c) clientCell = `<a href="#" onclick="showClientCard('${c.id}');return false;" style="color:var(--accent);text-decoration:none;border-bottom:1px dashed var(--accent);">${esc(clientName)}</a>`;
    }

    // 問い合わせ日
    const inquiryDate = row.start_date ? fmtDate(row.start_date) : '—';

    // 進行度プルダウン
    const progressCell = `<select class="inline-status-select" style="max-width:150px;" onchange="updateProjectField('${row.id}','progress',this.value)">
      ${PROGRESS_OPTIONS.map(v => `<option value="${v}"${row.progress === v ? ' selected' : ''}>${v}</option>`).join('')}
    </select>`;

    // 入金状況プルダウン
    const paymentCell = `<select class="inline-status-select" onchange="updateProjectField('${row.id}','payment_status',this.value)">
      ${PAYMENT_OPTIONS.map(v => `<option value="${v}"${row.payment_status === v ? ' selected' : ''}>${v}</option>`).join('')}
    </select>`;

    // 金額（請求書 > 見積書 > budget の優先順）
    const relInv   = _invoices.find(i => i.project_id === row.id || (i.project_name && i.project_name === row.title));
    const relQuote = _quotes.find(q => q.project_id === row.id   || (q.project_name && q.project_name === row.title));
    let amount = '—';
    if (relInv)        amount = '¥' + fmt(Math.round(Number(relInv.amount)   * (1 + Number(relInv.tax_rate)   / 100)));
    else if (relQuote) amount = '¥' + fmt(Math.round(Number(relQuote.amount) * (1 + Number(relQuote.tax_rate) / 100)));
    else if (row.budget) amount = '¥' + fmt(row.budget);

    // 納品予定日
    const deliveryDate = row.end_date ? fmtDate(row.end_date) : '—';

    // 発行種別プルダウン（onchange でPDFボタン列を動的更新）
    const existingType = relInv ? 'invoice' : (relQuote ? 'quote' : '');
    const rowId = row.id;
    const docTypeSelect = `<select class="inline-status-select" id="doc-type-${rowId}" onchange="refreshPdfCell('${rowId}')">
      <option value="">— 選択 —</option>
      <option value="invoice"${existingType === 'invoice' ? ' selected' : ''}>請求</option>
      <option value="quote"${existingType === 'quote'   ? ' selected' : ''}>見積</option>
    </select>`;

    // 出力（PDF）: 紐づく書類があればPDFボタン、なければ「発行」リンク
    let pdfCell = '';
    if (relInv)        pdfCell = `<button class="btn btn-ghost btn-sm" onclick="downloadInvoicePdf('${relInv.id}')">PDF</button>`;
    else if (relQuote) pdfCell = `<button class="btn btn-ghost btn-sm" onclick="downloadQuotePdf('${relQuote.id}')">PDF</button>`;
    else               pdfCell = `<span id="pdf-cell-${rowId}" style="color:var(--text-muted);font-size:12px;">—</span>`;

    // 備考
    const notes = row.description ? esc(row.description).substring(0, 20) + (row.description.length > 20 ? '…' : '') : '—';
    const notesCell = row.description
      ? `<span title="${esc(row.description)}" style="cursor:help;font-size:12px;">${notes}</span>`
      : `<span style="color:var(--text-muted);font-size:12px;">—</span>`;

    return `<tr>
      <td><strong>${esc(row.title || '—')}</strong></td>
      <td>${clientCell}</td>
      <td style="white-space:nowrap;">${inquiryDate}</td>
      <td>${progressCell}</td>
      <td>${paymentCell}</td>
      <td style="white-space:nowrap;">${amount}</td>
      <td style="white-space:nowrap;">${deliveryDate}</td>
      <td>${docTypeSelect}</td>
      <td id="pdf-cell-wrap-${rowId}">${pdfCell}</td>
      <td>${notesCell}</td>
      <td><button class="btn btn-primary btn-sm" onclick="openProjectModal('${row.id}')">編集</button></td>
      <td><button class="btn btn-danger btn-sm" onclick="confirmDeleteProject('${row.id}')">削除</button></td>
    </tr>`;
  }).join('');
}

// 発行種別変更時にPDFセルを更新
function refreshPdfCell(rowId) {
  const type = document.getElementById('doc-type-' + rowId)?.value;
  const cell = document.getElementById('pdf-cell-wrap-' + rowId);
  if (!cell) return;
  if (!type) { cell.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">—</span>'; return; }
  const row = _projects.find(p => p.id === rowId);
  if (!row) return;
  if (type === 'invoice') {
    const relInv = _invoices.find(i => i.project_id === rowId || (i.project_name && i.project_name === row.title));
    cell.innerHTML = relInv
      ? `<button class="btn btn-ghost btn-sm" onclick="downloadInvoicePdf('${relInv.id}')">PDF</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="openInvoiceForProject('${rowId}')">発行</button>`;
  } else {
    const relQuote = _quotes.find(q => q.project_id === rowId || (q.project_name && q.project_name === row.title));
    cell.innerHTML = relQuote
      ? `<button class="btn btn-ghost btn-sm" onclick="downloadQuotePdf('${relQuote.id}')">PDF</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="openQuoteForProject('${rowId}')">発行</button>`;
  }
}

// 請求書モーダルを案件情報でプリフィル
function openInvoiceForProject(projectId) {
  const p = _projects.find(p => p.id === projectId);
  if (!p) return;
  openInvoiceModal();
  setTimeout(() => {
    document.getElementById('invoice-project-name').value = p.title || '';
    const c = _clients.find(c => c.id === p.client_id);
    if (c) document.getElementById('invoice-client-name').value = c.name || '';
  }, 50);
}

// 見積書モーダルを案件情報でプリフィル
function openQuoteForProject(projectId) {
  const p = _projects.find(p => p.id === projectId);
  if (!p) return;
  openQuoteModal();
  setTimeout(() => {
    document.getElementById('quote-project-name').value = p.title || '';
    const c = _clients.find(c => c.id === p.client_id);
    if (c) document.getElementById('quote-client-name').value = c.name || '';
  }, 50);
}

// 削除確認（confirm不使用 → inline確認）
function confirmDeleteProject(id) {
  const row = _projects.find(p => p.id === id);
  const name = row?.title ?? '案件';
  if (!window.confirm(`「${name}」を削除しますか？`)) return;
  deleteProject(id);
}


// 顧客カード表示
async function showClientCard(clientId) {
  const client = await fetchJSON(`/api/clients/${clientId}`).catch(() => null);
  if (!client) return;

  // 氏名表示：姓名があれば「姓 名」、なければ name
  const displayName = (client.last_name || client.first_name)
    ? [client.last_name, client.first_name].filter(Boolean).join(' ')
    : (client.name || '');
  const kana = (client.last_name_kana || client.first_name_kana)
    ? [client.last_name_kana, client.first_name_kana].filter(Boolean).join(' ')
    : '';
  const nameWithKana = kana ? `${displayName}（${kana}）` : displayName;

  setText('cc-name',    nameWithKana);
  setText('cc-company', client.company || '');
  setText('cc-email',   client.email || '');
  setText('cc-phone',   client.phone || '');
  const addrParts = [client.postal_code ? `〒${client.postal_code}` : '', client.address || ''].filter(Boolean).join(' ');
  setText('cc-address', addrParts);
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
  clearForm('modal-project', ['project-id','project-title','project-budget','project-inquiry-date','project-delivery-date','project-description']);
  document.getElementById('project-client-name').value = '';
  document.getElementById('project-save-client').checked = false;
  document.getElementById('project-progress').value = '相談のみ';

  // datalist に保存済み顧客名 + Supabase clients をセット
  const saved = await fetchJSON('/api/client-names').catch(() => []);
  const combined = [...new Set([...saved, ..._clients.map(c => c.name)])].sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('client-datalist').innerHTML = combined.map(n => `<option value="${esc(n)}">`).join('');

  // 今日の日付をデフォルト
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('project-inquiry-date').value = today;

  if (id) {
    const p = _projects.find(p => p.id === id);
    if (!p) return;
    document.getElementById('modal-project-title').textContent = '案件を編集';
    document.getElementById('project-id').value = p.id;
    document.getElementById('project-title').value = p.title;
    const clientName = _clients.find(c => c.id === p.client_id)?.name ?? '';
    document.getElementById('project-client-name').value = clientName;
    document.getElementById('project-progress').value = p.progress ?? '相談のみ';
    document.getElementById('project-inquiry-date').value = p.start_date ?? today;
    document.getElementById('project-delivery-date').value = p.end_date ?? '';
    document.getElementById('project-budget').value = p.budget ?? '';
    document.getElementById('project-description').value = p.description ?? '';
  } else {
    document.getElementById('modal-project-title').textContent = '案件を追加';
  }
  openModal('modal-project');
}

async function saveProject() {
  const id              = document.getElementById('project-id').value;
  const clientNameInput = document.getElementById('project-client-name').value.trim();
  const saveClientFlag  = document.getElementById('project-save-client').checked;
  const progress        = document.getElementById('project-progress').value;

  // 顧客名 → client_id を解決
  let clientId = null;
  if (clientNameInput) {
    const existing = _clients.find(c => c.name === clientNameInput);
    if (existing) {
      clientId = existing.id;
    } else if (saveClientFlag) {
      const newClient = await apiFetch('/api/clients', 'POST', { name: clientNameInput });
      if (!newClient.error) {
        clientId = newClient.id;
        _clients.push(newClient);
      }
    }
    if (saveClientFlag) {
      await fetch('/api/client-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clientNameInput }),
      });
    }
  }

  const title        = document.getElementById('project-title').value.trim();
  const inquiryDate  = document.getElementById('project-inquiry-date').value || null;
  const deliveryDate = document.getElementById('project-delivery-date').value || null;

  const body = {
    title,
    client_id:      clientId,
    progress:       progress || '相談のみ',
    payment_status: '未入金',
    start_date:     inquiryDate,
    end_date:       deliveryDate,
    budget:         Number(document.getElementById('project-budget').value) || 0,
    description:    document.getElementById('project-description').value.trim() || null,
  };
  if (!body.title) return toast('案件名を入力してください');

  const url    = id ? `/api/projects/${id}` : '/api/projects';
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
  const [invoices, expenses, clients, projects, quotes] = await Promise.all([
    fetchJSON('/api/invoices'),
    fetchJSON('/api/expenses'),
    fetchJSON('/api/clients'),
    fetchJSON('/api/projects'),
    fetchJSON('/api/quotes'),
  ]);
  _invoices = invoices;
  _expenses = expenses;
  _clients  = clients;
  _projects = projects;
  _quotes   = quotes;
  updateFinanceStats();
  renderExpensesTable();
}

function updateFinanceStats() {
  const paid = _invoices.filter(i => i.status === 'paid')
    .reduce((s, i) => s + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);
  const exp = _expenses.reduce((s, e) => s + Number(e.amount), 0);
  setText('fi-paid',     '¥' + fmt(Math.round(paid)));
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
      : `<button class="btn btn-ghost btn-sm" onclick="formalizeQuote('${row.id}')">見積書化</button>
         <button class="btn btn-ghost btn-sm" onclick="openQuoteModal('${row.id}')">編集</button>
         <button class="btn btn-danger btn-sm" onclick="deleteQuote('${row.id}')">削除</button>`;

    return `<tr>
      <td>${typeBadge}</td>
      <td>${esc(row.clients?.name ?? '—')}</td>
      <td>${esc(row.projects?.title ?? row.project_name ?? '—')}</td>
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
  const projectTitles = [...new Set(_projects.map(p => p.title))].sort((a, b) => a.localeCompare(b, 'ja'));
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
    client_id:    clientId,
    project_id:   projectId,
    project_name: projectNameInput || null,
    amount:       Number(document.getElementById('invoice-amount').value) || 0,
    status:       document.getElementById('invoice-status').value,
    issue_date:   document.getElementById('invoice-issue-date').value || null,
    due_date:     document.getElementById('invoice-due-date').value || null,
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
  const projectTitlesQ = [...new Set(_projects.map(p => p.title))].sort((a, b) => a.localeCompare(b, 'ja'));
  document.getElementById('quote-project-datalist').innerHTML = projectTitlesQ.map(t => `<option value="${esc(t)}">`).join('');

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
    client_id:    clientId,
    project_id:   projectId,
    project_name: projectNameInput || null,
    amount:       Number(document.getElementById('quote-amount').value) || 0,
    status:       document.getElementById('quote-status').value,
    issue_date:   document.getElementById('quote-issue-date').value || null,
    valid_until:  document.getElementById('quote-valid-until').value || null,
    notes:        document.getElementById('quote-notes').value.trim() || null,
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

// 見積書化 — 見積をPDFとして出力。将来 Freee 見積書と連携予定
async function formalizeQuote(id) {
  // ── TODO: Freee 会計 見積書 連携（将来実装）──────────────────────
  // Freee の見積書ページへ直接遷移する場合:
  //   const quote = _quotes.find(q => q.id === id);
  //   const freeeQuoteId = quote?.freee_quote_id;  // Supabase に freee_quote_id カラム追加後に使用
  //   if (freeeQuoteId) {
  //     window.open(`https://secure.freee.co.jp/quotations/${freeeQuoteId}`, '_blank');
  //     return;
  //   }
  // Freee API で見積書を作成して返ってきた URL に遷移:
  //   const res = await apiFetch(`/api/quotes/${id}/freee-sync`, 'POST');
  //   if (res.freee_url) { window.open(res.freee_url, '_blank'); return; }
  // ─────────────────────────────────────────────────────────────────

  // 現在は PDF ダウンロードにフォールバック
  await downloadQuotePdf(id);
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
      <td><button class="btn btn-danger btn-sm" onclick="deleteDoc('${d.id}','${entityType}','${entityId}')"> 削除</button></td>
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
