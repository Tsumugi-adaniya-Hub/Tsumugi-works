require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const basicAuth  = require('express-basic-auth');
const crypto     = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const PDFDocument = require('pdfkit');
const multer     = require('multer');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const path = require('path');
const fs   = require('fs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app     = express();
const PORT    = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ============================================================
// ミドルウェア
// ============================================================
app.use(cors());

// Basic認証（環境変数が設定されている場合のみ有効）
if (process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS) {
  app.use(basicAuth({
    users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASS },
    challenge: true,
    realm: 'TsumugiWorks',
  }));
}

app.use(express.json());
app.use(express.static('public'));

// ============================================================
// ダッシュボード集計
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const [clients, projects, invoices, expenses] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact' }),
      supabase.from('projects').select('id, status, payment_status, budget, title'),
      supabase.from('invoices').select('amount, tax_rate, status, project_id, project_name'),
      supabase.from('expenses').select('amount'),
    ]);

    const activeProjects  = (projects.data || []).filter(p => p.status === 'active').length;
    const pendingProjects = (projects.data || []).filter(p => p.status === 'pending').length;

    // 請求書の入金済合計
    const invoicePaid = (invoices.data || [])
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);

    // 請求書が紐づいていないプロジェクトで payment_status='入金済' の budget 合計
    const invoicedProjectIds = new Set((invoices.data || []).map(i => i.project_id).filter(Boolean));
    const invoicedTitles     = new Set((invoices.data || []).map(i => i.project_name).filter(Boolean));
    const projectBudgetPaid  = (projects.data || [])
      .filter(p => p.payment_status === '入金済'
        && !invoicedProjectIds.has(p.id)
        && !invoicedTitles.has(p.title))
      .reduce((sum, p) => sum + Number(p.budget || 0), 0);

    const paidRevenue = invoicePaid + projectBudgetPaid;

    const unpaidRevenue = (invoices.data || [])
      .filter(i => ['sent', 'overdue'].includes(i.status))
      .reduce((sum, i) => sum + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);

    const totalExpenses = (expenses.data || [])
      .reduce((sum, e) => sum + Number(e.amount), 0);

    res.json({
      clients: clients.count ?? 0,
      totalProjects: (projects.data || []).length,
      activeProjects,
      pendingProjects,
      paidRevenue:    Math.round(paidRevenue),
      unpaidRevenue:  Math.round(unpaidRevenue),
      totalExpenses,
      profit: Math.round(paidRevenue) - totalExpenses,
    });
  } catch (err) {
    console.error('[dashboard]', err);
    res.status(500).json({ error: 'ダッシュボード集計に失敗しました' });
  }
});

// ============================================================
// 顧客 CRUD
// ============================================================
app.get('/api/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return res.status(500).json({ error: 'データの取得に失敗しました' }); }
  res.json(data);
});

app.get('/api/clients/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('*, projects(*)')
    .eq('id', req.params.id)
    .single();
  if (error) { console.error(error); return res.status(404).json({ error: '顧客が見つかりません' }); }
  res.json(data);
});

app.post('/api/clients', async (req, res) => {
  const { name, last_name, first_name, last_name_kana, first_name_kana, company, email, phone, postal_code, address, notes } = req.body;
  // name を姓名から構築、直接渡された name は後方互換として残す
  const fullName = (last_name && first_name) ? `${last_name} ${first_name}` :
                   last_name ? last_name :
                   name?.trim();
  if (!fullName) return res.status(400).json({ error: '姓は必須です' });
  const { data, error } = await supabase
    .from('clients')
    .insert({ name: fullName, last_name, first_name, last_name_kana, first_name_kana, company, email, phone, postal_code, address, notes })
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '顧客の登録に失敗しました' }); }
  res.status(201).json(data);
});

app.put('/api/clients/:id', async (req, res) => {
  const { name, last_name, first_name, last_name_kana, first_name_kana, company, email, phone, postal_code, address, notes } = req.body;
  const fullName = (last_name && first_name) ? `${last_name} ${first_name}` :
                   last_name ? last_name :
                   name;
  const { data, error } = await supabase
    .from('clients')
    .update({ name: fullName, last_name, first_name, last_name_kana, first_name_kana, company, email, phone, postal_code, address, notes })
    .eq('id', req.params.id)
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '顧客の更新に失敗しました' }); }
  res.json(data);
});

app.delete('/api/clients/:id', async (req, res) => {
  const { error } = await supabase.from('clients').delete().eq('id', req.params.id);
  if (error) { console.error(error); return res.status(400).json({ error: '顧客の削除に失敗しました' }); }
  res.status(204).end();
});

// ============================================================
// 案件 CRUD
// ============================================================
app.get('/api/projects', async (req, res) => {
  const { data, error } = await supabase
    .from('projects')
    .select('*, clients(name)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return res.status(500).json({ error: 'データの取得に失敗しました' }); }
  res.json(data);
});

app.get('/api/projects/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('projects')
    .select('*, clients(name), invoices(*), expenses(*)')
    .eq('id', req.params.id)
    .single();
  if (error) { console.error(error); return res.status(404).json({ error: '案件が見つかりません' }); }
  res.json(data);
});

app.post('/api/projects', async (req, res) => {
  const { client_id, title, description, status, progress, payment_status, start_date, end_date, budget } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: '案件名は必須です' });
  const { data, error } = await supabase
    .from('projects')
    .insert({ client_id, title: title.trim(), description, status: status || 'pending', progress: progress || '相談のみ', payment_status: payment_status || '未入金', start_date, end_date, budget })
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '案件の登録に失敗しました' }); }
  res.status(201).json(data);
});

app.put('/api/projects/:id', async (req, res) => {
  const { client_id, title, description, status, progress, payment_status, start_date, end_date, budget } = req.body;
  const { data, error } = await supabase
    .from('projects')
    .update({ client_id, title, description, status, progress, payment_status, start_date, end_date, budget })
    .eq('id', req.params.id)
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '案件の更新に失敗しました' }); }
  res.json(data);
});

// 案件 部分更新（進行度・入金状況などインライン更新用）
app.patch('/api/projects/:id', async (req, res) => {
  const allowed = ['status', 'progress', 'payment_status', 'client_id', 'title', 'description', 'start_date', 'end_date', 'budget'];
  const update = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  if (!Object.keys(update).length) return res.status(400).json({ error: '更新対象がありません' });
  const { data, error } = await supabase
    .from('projects')
    .update(update)
    .eq('id', req.params.id)
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '案件の更新に失敗しました' }); }
  res.json(data);
});

app.delete('/api/projects/:id', async (req, res) => {
  const { error } = await supabase.from('projects').delete().eq('id', req.params.id);
  if (error) { console.error(error); return res.status(400).json({ error: '案件の削除に失敗しました' }); }
  res.status(204).end();
});

// ============================================================
// 請求 CRUD
// ============================================================
app.get('/api/invoices', async (req, res) => {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, clients(name), projects(title)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return res.status(500).json({ error: 'データの取得に失敗しました' }); }
  res.json(data);
});

app.post('/api/invoices', async (req, res) => {
  const { client_id, project_id, project_name, invoice_number, amount, tax_rate, status, issue_date, due_date, notes } = req.body;
  const { data, error } = await supabase
    .from('invoices')
    .insert({ client_id, project_id, project_name: project_name || null, invoice_number, amount, tax_rate, status, issue_date, due_date, notes })
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '請求書の登録に失敗しました' }); }
  res.status(201).json(data);
});

app.put('/api/invoices/:id', async (req, res) => {
  const { client_id, project_id, project_name, invoice_number, amount, tax_rate, status, issue_date, due_date, notes } = req.body;
  const { data, error } = await supabase
    .from('invoices')
    .update({ client_id, project_id, project_name: project_name || null, invoice_number, amount, tax_rate, status, issue_date, due_date, notes })
    .eq('id', req.params.id)
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '請求書の更新に失敗しました' }); }
  res.json(data);
});

app.delete('/api/invoices/:id', async (req, res) => {
  const { error } = await supabase.from('invoices').delete().eq('id', req.params.id);
  if (error) { console.error(error); return res.status(400).json({ error: '請求書の削除に失敗しました' }); }
  res.status(204).end();
});

// ============================================================
// 経費 CRUD
// ============================================================
app.get('/api/expenses', async (req, res) => {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, projects(title)')
    .order('expense_date', { ascending: false });
  if (error) { console.error(error); return res.status(500).json({ error: 'データの取得に失敗しました' }); }
  res.json(data);
});

app.post('/api/expenses', async (req, res) => {
  const { project_id, category, description, amount, expense_date } = req.body;
  if (!description?.trim()) return res.status(400).json({ error: '経費の内容は必須です' });
  const { data, error } = await supabase
    .from('expenses')
    .insert({ project_id, category, description: description.trim(), amount, expense_date })
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '経費の登録に失敗しました' }); }
  res.status(201).json(data);
});

app.put('/api/expenses/:id', async (req, res) => {
  const { project_id, category, description, amount, expense_date } = req.body;
  const { data, error } = await supabase
    .from('expenses')
    .update({ project_id, category, description, amount, expense_date })
    .eq('id', req.params.id)
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '経費の更新に失敗しました' }); }
  res.json(data);
});

app.delete('/api/expenses/:id', async (req, res) => {
  const { error } = await supabase.from('expenses').delete().eq('id', req.params.id);
  if (error) { console.error(error); return res.status(400).json({ error: '経費の削除に失敗しました' }); }
  res.status(204).end();
});

// ============================================================
// 見積 CRUD
// ============================================================
app.get('/api/quotes', async (req, res) => {
  const { data, error } = await supabase
    .from('quotes')
    .select('*, clients(name), projects(title)')
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return res.status(500).json({ error: 'データの取得に失敗しました' }); }
  res.json(data);
});

app.post('/api/quotes', async (req, res) => {
  const { client_id, project_id, project_name, quote_number, amount, tax_rate, status, issue_date, valid_until, notes } = req.body;
  const { data, error } = await supabase
    .from('quotes')
    .insert({ client_id, project_id, project_name: project_name || null, quote_number, amount, tax_rate, status, issue_date, valid_until, notes })
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '見積書の登録に失敗しました' }); }
  res.status(201).json(data);
});

app.put('/api/quotes/:id', async (req, res) => {
  const { client_id, project_id, project_name, quote_number, amount, tax_rate, status, issue_date, valid_until, notes } = req.body;
  const { data, error } = await supabase
    .from('quotes')
    .update({ client_id, project_id, project_name: project_name || null, quote_number, amount, tax_rate, status, issue_date, valid_until, notes })
    .eq('id', req.params.id)
    .select().single();
  if (error) { console.error(error); return res.status(400).json({ error: '見積書の更新に失敗しました' }); }
  res.json(data);
});

app.delete('/api/quotes/:id', async (req, res) => {
  const { error } = await supabase.from('quotes').delete().eq('id', req.params.id);
  if (error) { console.error(error); return res.status(400).json({ error: '見積書の削除に失敗しました' }); }
  res.status(204).end();
});

// 見積 → 請求書に変換
app.post('/api/quotes/:id/convert', async (req, res) => {
  const { data: q, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: '見積書が見つかりません' });

  const { data: inv, error: invErr } = await supabase.from('invoices').insert({
    client_id:    q.client_id,
    project_id:   q.project_id,
    project_name: q.project_name,
    amount:       q.amount,
    tax_rate:     q.tax_rate,
    status:       'draft',
    issue_date:   new Date().toISOString().split('T')[0],
    notes: q.notes
      ? `見積書 ${q.quote_number || ''} より転換\n${q.notes}`
      : `見積書 ${q.quote_number || ''} より転換`,
  }).select().single();
  if (invErr) { console.error(invErr); return res.status(400).json({ error: '請求書への転換に失敗しました' }); }

  await supabase.from('quotes').update({ status: 'accepted' }).eq('id', req.params.id);
  res.status(201).json(inv);
});

// 見積 PDF 生成
app.get('/api/quotes/:id/pdf', async (req, res) => {
  const { data: q, error } = await supabase
    .from('quotes')
    .select('*, clients(name), projects(title)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: '見積書が見つかりません' });

  const taxAmt     = Math.round(Number(q.amount) * Number(q.tax_rate) / 100);
  const total      = Number(q.amount) + taxAmt;
  const issueDate  = q.issue_date  ? new Date(q.issue_date).toLocaleDateString('ja-JP')  : '—';
  const validUntil = q.valid_until ? new Date(q.valid_until).toLocaleDateString('ja-JP') : '—';
  const clientName   = q.clients?.name    ?? '—';
  const projectTitle = q.projects?.title ?? q.project_name ?? '—';
  const filename = `見積書_${clientName}_${(q.issue_date || '').slice(0, 7)}.pdf`;

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  doc.registerFont('NotoSans', require.resolve('./fonts/NotoSansJP-Regular.ttf'));
  doc.font('NotoSans');

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  await new Promise(resolve => {
    doc.on('end', resolve);
    doc.fontSize(22).text('御 見 積 書', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12)
      .text(`発行日: ${issueDate}`,   { align: 'right' })
      .text(`有効期限: ${validUntil}`, { align: 'right' });
    doc.moveDown();
    doc.fontSize(14).text(`${clientName} 御中`);
    doc.moveDown();
    doc.fontSize(11)
      .text(`案件: ${projectTitle}`)
      .moveDown()
      .text('─────────────────────────────────────────')
      .text(`小計:      ¥${Number(q.amount).toLocaleString('ja-JP')}`)
      .text(`消費税(${q.tax_rate}%): ¥${taxAmt.toLocaleString('ja-JP')}`)
      .text('─────────────────────────────────────────')
      .fontSize(13).text(`合計（税込）: ¥${total.toLocaleString('ja-JP')}`)
      .moveDown(2)
      .fontSize(10).text('つむぎワークス', { align: 'right' });
    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(pdfBuffer);

  const ym = (q.issue_date || new Date().toISOString()).slice(0, 7);
  sendToMake({
    type: 'quote',
    filename,
    folder_path: `つむぎワークス/見積書/${ym}`,
    file_content: pdfBuffer.toString('base64'),
    entity_id: q.id,
  });
});

// ============================================================
// 外部サービス連携（Google Calendar）
// ============================================================

// --- Google Calendar OAuth ---
const TOKEN_PATH  = path.join(__dirname, '.google-token.json');
const oauthStates = new Map();

function getGoogleOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${APP_URL}/auth/google/callback`
  );
  if (process.env.GOOGLE_TOKEN) {
    client.setCredentials(JSON.parse(process.env.GOOGLE_TOKEN));
  } else if (fs.existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
  }
  return client;
}

function hasGoogleToken() {
  return !!(process.env.GOOGLE_TOKEN || fs.existsSync(TOKEN_PATH));
}

app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(400).send('GOOGLE_CLIENT_ID が設定されていません');
  }
  try {
    const state = crypto.randomUUID();
    oauthStates.set(state, Date.now());
    for (const [k, v] of oauthStates) {
      if (Date.now() - v > 10 * 60 * 1000) oauthStates.delete(k);
    }
    const auth = getGoogleOAuth2Client();
    const url  = auth.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.readonly'],
      state,
    });
    res.redirect(url);
  } catch (e) {
    console.error(e);
    res.status(500).send('OAuth 初期化エラー');
  }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!state || !oauthStates.has(state)) {
      return res.status(400).send('不正なリクエストです（stateが一致しません）');
    }
    oauthStates.delete(state);
    const auth = getGoogleOAuth2Client();
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    const tokenJson = JSON.stringify(tokens);
    console.log('[Google Auth] GOOGLE_TOKEN =', tokenJson);
    res.send(`<html><body style="font-family:sans-serif;padding:2rem">
      <h2>Google カレンダー認証完了</h2>
      <p>このタブを閉じてアプリをリロードしてください。</p>
      <hr>
      <p><strong>Renderで永続化する場合：</strong>以下をコピーして Render の環境変数 <code>GOOGLE_TOKEN</code> に貼り付けてください。</p>
      <textarea rows="4" style="width:100%;font-size:12px">${tokenJson}</textarea>
    </body></html>`);
  } catch (e) {
    console.error(e);
    res.status(500).send('認証エラーが発生しました');
  }
});

app.get('/api/external/calendar/events', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.json({ data: [], configured: false });
  }
  if (!hasGoogleToken()) {
    return res.json({ data: [], configured: false, auth_url: '/auth/google' });
  }
  try {
    const auth     = getGoogleOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth });
    const now           = new Date();
    const twoWeeksLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const response = await calendar.events.list({
      calendarId:   'primary',
      timeMin:      now.toISOString(),
      timeMax:      twoWeeksLater.toISOString(),
      singleEvents: true,
      orderBy:      'startTime',
      maxResults:   10,
    });
    res.json({ data: response.data.items || [], configured: true });
  } catch (err) {
    if (err.code === 401) {
      if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
      return res.json({ data: [], configured: false, auth_url: '/auth/google' });
    }
    console.error(err);
    res.json({ data: [], configured: true, error: 'カレンダーの取得に失敗しました' });
  }
});


// ============================================================
// 顧客名マスタ（data/clients.json）
// ============================================================
const CLIENT_NAMES_PATH = path.join(__dirname, 'data', 'clients.json');

function readClientNames() {
  try {
    return JSON.parse(fs.readFileSync(CLIENT_NAMES_PATH, 'utf8'));
  } catch { return []; }
}

app.get('/api/client-names', (req, res) => {
  res.json(readClientNames());
});

app.post('/api/client-names', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: '名前が必要です' });
  const names = readClientNames();
  if (!names.includes(name.trim())) {
    names.push(name.trim());
    names.sort((a, b) => a.localeCompare(b, 'ja'));
    fs.writeFileSync(CLIENT_NAMES_PATH, JSON.stringify(names, null, 2), 'utf8');
  }
  res.json(names);
});

app.delete('/api/client-names/:name', (req, res) => {
  const target = decodeURIComponent(req.params.name);
  const names  = readClientNames().filter(n => n !== target);
  fs.writeFileSync(CLIENT_NAMES_PATH, JSON.stringify(names, null, 2), 'utf8');
  res.json(names);
});

// ============================================================
// ビジネスニュース（曜日別ファイル）
// ============================================================
const NEWS_DIR  = path.join(__dirname, 'public', 'news');
const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const DAY_JA    = ['日曜日','月曜日','火曜日','水曜日','木曜日','金曜日','土曜日'];

app.get('/api/news/week', (req, res) => {
  const result = [];
  for (const day of DAY_NAMES) {
    const filePath = path.join(NEWS_DIR, `${day}.json`);
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.date) result.push({ day, ...data });
      } catch {}
    }
  }
  result.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(result);
});

app.post('/api/news/save', express.json(), (req, res) => {
  const { content, date } = req.body;
  if (!content || !date) return res.status(400).json({ error: 'content と date が必要です' });
  const d          = new Date(date);
  const dayIndex   = d.getDay();
  const day        = DAY_NAMES[dayIndex];
  const weekday_ja = DAY_JA[dayIndex];
  const filePath   = path.join(NEWS_DIR, `${day}.json`);
  fs.writeFileSync(filePath, JSON.stringify({ date, weekday_ja, content }, null, 2), 'utf8');
  res.json({ ok: true, day, date, weekday_ja });
});

// 設定状態チェック
app.get('/api/external/status', (req, res) => {
  res.json({
    google_calendar:      !!(process.env.GOOGLE_CLIENT_ID && hasGoogleToken()),
    google_auth_required: !!(process.env.GOOGLE_CLIENT_ID && !hasGoogleToken()),
  });
});

// ============================================================
// Make webhook 送信ヘルパー
// ============================================================
async function sendToMake(payload) {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) return { ok: false, error: 'MAKE_WEBHOOK_URL not set' };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: r.ok };
  } catch (e) {
    console.error('[Make webhook]', e);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 請求書 PDF 生成 → Make 経由 OneDrive 保存
// ============================================================
app.get('/api/invoices/:id/pdf', async (req, res) => {
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('*, clients(name), projects(title)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: '請求書が見つかりません' });

  const taxAmt      = Math.round(Number(inv.amount) * Number(inv.tax_rate) / 100);
  const total       = Number(inv.amount) + taxAmt;
  const issueDate   = inv.issue_date ? new Date(inv.issue_date).toLocaleDateString('ja-JP') : '—';
  const dueDate     = inv.due_date   ? new Date(inv.due_date).toLocaleDateString('ja-JP') : '—';
  const clientName   = inv.clients?.name   ?? '—';
  const projectTitle = inv.projects?.title ?? inv.project_name ?? '—';
  const filename = `請求書_${clientName}_${(inv.issue_date || '').slice(0, 7)}.pdf`;

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  doc.registerFont('NotoSans', require.resolve('./fonts/NotoSansJP-Regular.ttf'));
  doc.font('NotoSans');

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  await new Promise(resolve => {
    doc.on('end', resolve);
    doc.fontSize(22).text('請 求 書', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12)
      .text(`発行日: ${issueDate}`,    { align: 'right' })
      .text(`支払期限: ${dueDate}`,    { align: 'right' });
    doc.moveDown();
    doc.fontSize(14).text(`${clientName} 御中`);
    doc.moveDown();
    doc.fontSize(11)
      .text(`案件: ${projectTitle}`)
      .moveDown()
      .text('─────────────────────────────────────────')
      .text(`小計:      ￥${Number(inv.amount).toLocaleString('ja-JP')}`)
      .text(`消費税(${inv.tax_rate}%): ￥${taxAmt.toLocaleString('ja-JP')}`)
      .text('─────────────────────────────────────────')
      .fontSize(13).text(`合計（税込）: ￥${total.toLocaleString('ja-JP')}`)
      .moveDown(2)
      .fontSize(10).text('つむぎワークス', { align: 'right' });
    doc.end();
  });

  const pdfBuffer = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(pdfBuffer);

  const ym = (inv.issue_date || new Date().toISOString()).slice(0, 7);
  sendToMake({
    type:         'invoice',
    filename,
    folder_path:  `つむぎワークス/請求書/${ym}`,
    file_content: pdfBuffer.toString('base64'),
    entity_id:    inv.id,
  }).then(r => {
    if (r.ok) {
      supabase.from('documents').insert({
        entity_type: 'invoice',
        entity_id:   inv.id,
        filename,
        folder_path: `つむぎワークス/請求書/${ym}`,
      }).then(() => {});
    }
  });
});

// ============================================================
// 書類アップロード（ファイル添付 → Make 経由 OneDrive）
// ============================================================
const VALID_ENTITY_TYPES = ['invoice', 'project', 'client'];

app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
  const { entity_type, entity_id, entity_name } = req.body;

  if (!VALID_ENTITY_TYPES.includes(entity_type)) {
    return res.status(400).json({ error: '無効なファイル種別です' });
  }

  const filename    = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const folder_path = `つむぎワークス/書類/${entity_name || entity_type}`;

  const result = await sendToMake({
    type: 'document',
    filename,
    folder_path,
    file_content: req.file.buffer.toString('base64'),
    entity_id,
  });

  const { data, error } = await supabase.from('documents').insert({
    entity_type,
    entity_id,
    filename,
    folder_path,
  }).select().single();

  if (error) { console.error(error); return res.status(400).json({ error: 'ファイルの記録に失敗しました' }); }
  res.json({ ...data, make_sent: result.ok });
});

// 書類一覧
app.get('/api/documents/:entity_type/:entity_id', async (req, res) => {
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('entity_type', req.params.entity_type)
    .eq('entity_id',   req.params.entity_id)
    .order('created_at', { ascending: false });
  if (error) { console.error(error); return res.status(500).json({ error: 'データの取得に失敗しました' }); }
  res.json(data);
});

// 書類削除
app.delete('/api/documents/:id', async (req, res) => {
  const { error } = await supabase.from('documents').delete().eq('id', req.params.id);
  if (error) { console.error(error); return res.status(400).json({ error: 'ファイルの削除に失敗しました' }); }
  res.status(204).end();
});


app.listen(PORT, () => {
  console.log(`つむぎワークス 運営管理アプリ起動 → ${APP_URL}`);
});
