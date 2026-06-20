# つむぎワークス 運営管理アプリ — コードレビュー依頼

個人事業主（フリーランス）向けに自作した運営管理Webアプリです。
コードの品質・設計・改善点についてレビューをお願いします。

---

## アプリ概要

**目的：** 個人事業主の日常業務（受注管理・財務・スケジュール）を一元管理する社内ツール

**技術スタック：**
- バックエンド：Node.js + Express
- フロントエンド：Vanilla JS + HTML/CSS（SPAっぽい構成）
- DB：Supabase（PostgreSQL）
- 外部連携：Notion API、Google Calendar API
- PDF生成：pdfkit
- ファイルストレージ：Make.com webhook → OneDrive

**主な機能：**
- ダッシュボード（売上・案件・カレンダー・Notionタスク・ビジネスニュース）
- 受注管理（Notion DB と連携して表示、Supabaseにフォールバック）
- 財務管理（請求書・経費・見積もりのCRUD）
- 請求書・見積書のPDF生成 → OneDrive自動保存
- 顧客管理（カード形式のポップアップ表示）
- ビジネスニュースパネル（毎朝スケジュールタスクで更新、7曜日ファイルを上書き）

---

## ファイル構成

```
運営管理アプリ/
├── server.js          # Express APIサーバー（全バックエンド）
├── public/
│   ├── index.html     # フロントエンド（SPA）
│   ├── app.js         # フロントエンドロジック
│   ├── style.css      # スタイル
│   ├── news/          # ビジネスニュース（曜日別JSON）
│   │   ├── monday.json
│   │   └── ...
│   └── data/
│       └── clients.json  # 顧客名マスタ
├── fonts/
│   └── NotoSansJP-Regular.ttf
└── .env               # 環境変数（非公開）
```

---

## server.js（バックエンド）

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const path = require('path');
const fs = require('fs');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ダッシュボード集計
app.get('/api/dashboard', async (req, res) => {
  try {
    const [clients, projects, invoices, expenses] = await Promise.all([
      supabase.from('clients').select('id', { count: 'exact' }),
      supabase.from('projects').select('id, status', { count: 'exact' }),
      supabase.from('invoices').select('amount, tax_rate, status'),
      supabase.from('expenses').select('amount'),
    ]);

    const activeProjects = (projects.data || []).filter(p => p.status === 'active').length;
    const pendingProjects = (projects.data || []).filter(p => p.status === 'pending').length;

    const paidRevenue = (invoices.data || [])
      .filter(i => i.status === 'paid')
      .reduce((sum, i) => sum + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);

    const unpaidRevenue = (invoices.data || [])
      .filter(i => ['sent', 'overdue'].includes(i.status))
      .reduce((sum, i) => sum + Number(i.amount) * (1 + Number(i.tax_rate) / 100), 0);

    const totalExpenses = (expenses.data || [])
      .reduce((sum, e) => sum + Number(e.amount), 0);

    res.json({
      clients: clients.count ?? 0,
      totalProjects: projects.count ?? 0,
      activeProjects,
      pendingProjects,
      paidRevenue: Math.round(paidRevenue),
      unpaidRevenue: Math.round(unpaidRevenue),
      totalExpenses,
      profit: Math.round(paidRevenue) - totalExpenses,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 顧客 CRUD（/api/clients）
app.get('/api/clients', async (req, res) => {
  const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get('/api/clients/:id', async (req, res) => {
  const { data, error } = await supabase.from('clients').select('*, projects(*)').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});
app.post('/api/clients', async (req, res) => {
  const { data, error } = await supabase.from('clients').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});
app.put('/api/clients/:id', async (req, res) => {
  const { data, error } = await supabase.from('clients').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});
app.delete('/api/clients/:id', async (req, res) => {
  const { error } = await supabase.from('clients').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

// 案件・請求・経費・見積もり も同様のCRUDパターン（省略）

// Notion 案件管理DB 取得
app.get('/api/external/notion/projects', async (req, res) => {
  const token = process.env.NOTION_TOKEN;
  const dbId  = process.env.NOTION_PROJECTS_DB_ID;
  if (!token || !dbId) return res.json({ data: [], configured: false });

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        page_size: 50,
        sorts: [{ property: '問い合わせ日', direction: 'descending' }],
      }),
    });
    const json = await response.json();
    if (json.object === 'error') throw new Error(json.message);

    const data = (json.results || []).map(page => {
      const p = page.properties || {};
      return {
        id: page.id,
        notion_url: page.url,
        title:        p['顧客名']?.title?.[0]?.plain_text ?? '（名称なし）',
        project_name: p['案件名']?.rich_text?.[0]?.plain_text ?? '',
        progress:     p['進行度']?.status?.name ?? '',
        payment:      p['入金状況']?.status?.name ?? '',
        inquiry_date:  p['問い合わせ日']?.date?.start ?? null,
        delivery_date: p['納品予定日']?.date?.start ?? null,
        last_edited: page.last_edited_time,
      };
    });
    res.json({ data, configured: true });
  } catch (err) {
    res.json({ data: [], configured: true, error: err.message });
  }
});

// Google Calendar OAuth + イベント取得
const TOKEN_PATH = path.join(__dirname, '.google-token.json');

function getGoogleOAuth2Client() {
  try {
    const { google } = require('googleapis');
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `http://localhost:${process.env.PORT || 3000}/auth/google/callback`
    );
    if (fs.existsSync(TOKEN_PATH)) {
      client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
    }
    return client;
  } catch { return null; }
}

app.get('/auth/google', (req, res) => {
  const auth = getGoogleOAuth2Client();
  const url = auth.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/calendar.readonly'] });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const auth = getGoogleOAuth2Client();
  const { tokens } = await auth.getToken(req.query.code);
  auth.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  res.send('<html><body><h2>認証完了</h2></body></html>');
});

app.get('/api/external/calendar/events', async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) return res.json({ data: [], configured: false, auth_url: '/auth/google' });
  try {
    const { google } = require('googleapis');
    const auth = getGoogleOAuth2Client();
    const calendar = google.calendar({ version: 'v3', auth });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 10,
    });
    res.json({ data: response.data.items || [], configured: true });
  } catch (err) {
    res.json({ data: [], configured: true, error: err.message });
  }
});

// 顧客名マスタ（JSONファイル管理）
const CLIENT_NAMES_PATH = path.join(__dirname, 'public', 'data', 'clients.json');

function readClientNames() {
  try { return JSON.parse(fs.readFileSync(CLIENT_NAMES_PATH, 'utf8')); }
  catch { return []; }
}

app.get('/api/client-names', (req, res) => res.json(readClientNames()));

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

// ビジネスニュース（曜日別JSONファイル）
const NEWS_DIR = path.join(__dirname, 'public', 'news');
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

// PDF生成 → Make.com webhook → OneDrive（省略）

app.listen(PORT, () => console.log(`起動 → http://localhost:${PORT}`));
```

---

## app.js（フロントエンド・抜粋）

```javascript
// Notion優先・Supabaseフォールバックで受注管理を表示
async function loadProjects() {
  const notionRes = await fetchJSON('/api/external/notion/projects').catch(() => ({ configured: false, data: [] }));

  if (notionRes.configured && notionRes.data && notionRes.data.length > 0) {
    _notionProjects = notionRes.data;
    document.getElementById('notion-projects-table').style.display = '';
    document.getElementById('local-projects-table').style.display = 'none';
    renderNotionProjectsTable();
    updateProjectStatsFromNotion();
  } else {
    // Supabase フォールバック
    [_projects, _clients] = await Promise.all([fetchJSON('/api/projects'), fetchJSON('/api/clients')]);
    renderProjectsTable();
  }
}

// 案件追加：顧客名フリー入力 + 保存チェック
async function saveProject() {
  const clientNameInput = document.getElementById('project-client-name').value.trim();
  const saveClientFlag  = document.getElementById('project-save-client').checked;

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
      await fetch('/api/client-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clientNameInput }),
      });
    }
  }
  // ...省略
}

// ユーティリティ
async function fetchJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    return r.json();
  } catch { return []; }
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

---

## 気になっている点（レビューしてほしい箇所）

1. **認証なし** — `localhost:3000` で動かしているのでアクセス制限なし。個人利用なので許容しているが問題があれば指摘ほしい
2. **CORSの設定** — `app.use(cors())` で全許可している
3. **ファイルI/O** — ニュースJSONと顧客名JSONをサーバーサイドでファイル読み書きしている（Supabase移行を検討中）
4. **エラーハンドリング** — Supabaseエラーはそのままクライアントに返している
5. **フロントエンドのグローバル変数** — `_clients`, `_projects` などをグローバルに保持している
6. **XSS対策** — `esc()` 関数でエスケープしているが漏れがないか
7. **コード構造** — server.js が1ファイルに集中している（700行超）

---

## 動作環境
- ローカル（Windows PC）で `node server.js` で起動
- `http://localhost:3000` でアクセス
- 外部公開なし（個人利用のみ）
