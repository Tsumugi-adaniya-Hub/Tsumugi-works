/**
 * quotes テーブル追加スクリプト
 * 実行: node scripts/add-quotes-table.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const SQL = `
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  quote_number TEXT,
  amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5, 2) DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  issue_date DATE DEFAULT CURRENT_DATE,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotes_updated_at ON quotes;
CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
`;

async function main() {
  console.log('quotes テーブルを作成中...');
  const { error } = await supabase.rpc('exec_sql', { sql: SQL }).catch(() => ({ error: { message: 'rpc not available' } }));

  if (error) {
    // rpc が使えない場合は直接 REST API で実行
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ sql: SQL }),
    });
    if (!res.ok) {
      console.log('\nREST API でも実行できませんでした。');
      console.log('Supabase ダッシュボードで以下の SQL を実行してください:');
      console.log('https://supabase.com/dashboard/project/ymmdmzufndnkazdczzyo/sql/new');
      console.log('\n--- ここから ---');
      console.log(SQL);
      console.log('--- ここまで ---');
      return;
    }
    console.log('完了しました。');
  } else {
    console.log('完了しました。');
  }
}

main().catch(console.error);
