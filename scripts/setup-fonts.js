/**
 * NotoSansJP フォントダウンロードスクリプト
 * 初回のみ: node scripts/setup-fonts.js
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const FONT_URL  = 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf';
const FONT_PATH = path.join(__dirname, '..', 'fonts', 'NotoSansJP-Regular.ttf');

if (fs.existsSync(FONT_PATH)) {
  console.log('フォント既存: スキップします');
  process.exit(0);
}

// Googleが提供しているシンプルなNotoSansJP TTFを取得
const TTF_URL = 'https://fonts.gstatic.com/s/notosansjp/v53/-F6jfjtqLzI2JPCgQBnw7HFowAIO2lZ9hg.woff2';

// woff2は直接使えないのでGoogleFonts APIからttfを取得する
const DIRECT_TTF = 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf';

console.log('NotoSansJP フォントをダウンロード中...');

function download(url, dest, cb) {
  const file = fs.createWriteStream(dest);
  https.get(url, res => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      file.close();
      fs.unlinkSync(dest);
      download(res.headers.location, dest, cb);
      return;
    }
    res.pipe(file);
    file.on('finish', () => { file.close(); cb(null); });
  }).on('error', err => {
    fs.unlink(dest, () => {});
    cb(err);
  });
}

download(DIRECT_TTF, FONT_PATH, err => {
  if (err) {
    console.error('ダウンロード失敗:', err.message);
    console.log('\n手動でフォントを配置してください:');
    console.log('  NotoSansJP-Regular.ttf を fonts/ フォルダに置く');
    console.log('  入手先: https://fonts.google.com/noto/specimen/Noto+Sans+JP');
  } else {
    console.log('フォントのダウンロード完了:', FONT_PATH);
  }
});
