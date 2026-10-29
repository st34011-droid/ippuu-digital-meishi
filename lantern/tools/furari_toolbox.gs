/**
 * ふらりランタン 道具箱（Google Apps Script）
 *
 * これ1本で、次の5つが用意できます。
 *   ① 感想フォーム（Googleフォーム）…アプリの「かんそうを おくる」と同じ質問に、「正直に、いまいちだったところ」を足したもの
 *   ② アクセスの記録…案内ページが「見られた」「ためしてみるが押された」「感想ボタンが押された」を、1行ずつ書き込む
 *   ③ ファネル（自動の集計表）…経路（チラシなど）ごとの数、週ごとの数、予測と逆算
 *   ④ 目安箱の受け口…アプリの「めやすばこに いれる」で届いた感想を、フォームと同じ「回答」シートに1行ずつ入れる
 *   ⑤ 集計と応募用まとめ…質問ごとの数と、応募書類に貼れるまとめ（使ってよい感想だけ）。数式なので、開けば いつも最新
 * ぜんぶ、1つのスプレッドシート「ふらりランタン 感想とアクセスの記録」にまとまります。
 * お名前・メールアドレス・端末を見分ける情報は、集めません。
 *
 * 使い方
 *  1. https://script.google.com →「新しいプロジェクト」→ 入っているコードを消して、これを全部貼る → 保存
 *  2. 上の関数の選択欄で「setupAll」を選んで「実行」
 *     （Googleの承認が出ます。「詳細」→「安全ではないページに移動」で進みます。自分のフォームとシートを作るだけです）
 *  3. 右上「デプロイ」→「新しいデプロイ」→ 種類の歯車で「ウェブアプリ」を選び、
 *       次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員 →「デプロイ」
 *     出てくる「ウェブアプリのURL」（…/exec で終わるもの）をコピーする
 *  4. 案内ページの CONFIG に、2つ入れる
 *       formUrl  … 実行ログの「★感想フォームのURL」
 *       sheetUrl … 手順3でコピーしたURL
 *     アプリ（lantern/index.html）の先頭の MEYASU_URL にも、手順3でコピーしたURLを入れる（目安箱の送り先。同じURL）
 *  5. 動作確認：案内ページのURLの最後に ?c=test を付けて、スマホで開き、「ためしてみる」を押す。
 *     スプレッドシートの「アクセス記録」に test の行が2つ（view と try）できれば成功です。test は集計に入りません。
 *
 * あとで このコードを直したときは、「デプロイ」→「デプロイを管理」→ えんぴつ →「バージョン：新バージョン」→「デプロイ」。
 * （直しただけでは、ウェブアプリには反映されません）
 */

var BOOK_NAME = 'ふらりランタン 感想とアクセスの記録';
var FORM_NAME = 'ふらりランタン 感想フォーム（試作）';
var SHEET_FUNNEL = 'ファネル';
var SHEET_LOG = 'アクセス記録';
var SHEET_ANS = '回答';
var EVENTS = ['view', 'try', 'form'];
var MAX_LOG_ROWS = 20000;
var WHERE_CHOICES = ['社会福祉協議会・相談窓口のチラシ', 'ハローワークのチラシ', '支援員さん・相談員さんの紹介', 'Zoom説明会', '知り合いの紹介'];

// 質問の選択肢。フォームを作るときと、目安箱で受け取るときの両方で使う（アプリの選択肢と、同じ文字にしてある）
var OPTIONS = {
  days: ['1日', '2〜3日', '4〜6日', '7日以上'],
  when: ['朝起きたとき', '昼間', '寝る前', '疲れたとき', '気が向いたとき'],
  hard: ['特になし', '灯りのつけ方', 'ダンジョンの進み方', '文字が読みにくい', 'どこを押せばいいか'],
  feel: ['気持ちが少し楽になった', '休んでもいいと思えた', '起きるきっかけになった', '生活リズムを気にするようになった', 'ちょっと大変だった', '特に変わらない'],
  again: ['使いたい', 'どちらでもない', '使わない'],
  wish: ['曲や体操がほしい', 'キャラの声かけをもっと', '文字を減らしてほしい', 'お知らせがほしい', '仲間とつながりたい', 'このままでいい'],
  where: WHERE_CHOICES.concat(['その他']),
  ok: ['いい', '使わないで'],
  age: ['10代', '20代', '30代', '40代', '50代', '60代', '70代以上'],
  role: ['仕事を探している', '働いている', 'B型・A型などに通っている', '家にいることが多い', '学生', 'その他']
};
var MULTI = ['when', 'hard', 'feel', 'wish'];          // いくつでも選べる質問
var TEXTS = { note: 1000, honest: 1000, paste: 300 }; // 自由に書く欄と、長さの上限
var SHEET_SUM = '集計';
var SHEET_PITCH = '応募用まとめ';
var BOX_DAILY_MAX = 300;                              // 目安箱に1日に入る数の上限（いたずら対策）

// フォームの質問の順番。回答シートの列は、この順に B, C, D… になります（A は回答した日時）
var QUESTION_KEYS = ['days', 'when', 'hard', 'feel', 'again', 'wish', 'note', 'honest', 'paste', 'where', 'ok', 'age', 'role'];

// 集計表に出す経路：[経路コード（URLの ?c= の中身）, 表に出す名前, フォームの「どこで知りましたか？」の答え]
var CHANNELS = [
  ['sha', 'チラシ（社協・相談窓口）', WHERE_CHOICES[0]],
  ['hw', 'チラシ（ハローワーク）', WHERE_CHOICES[1]],
  ['staff', '支援員さん・相談員さんの紹介', WHERE_CHOICES[2]],
  ['zoom', 'Zoom説明会', WHERE_CHOICES[3]],
  ['voice', '知り合いの紹介', WHERE_CHOICES[4]]
];

// ============ まとめて用意する（最初に1回だけ） ============
function setupAll() {
  var book = getBook_();
  setupLog_(book);
  ensureForm_(book);
  renameAnswers_(book);
  buildFunnel_(book);
  buildSummary_(book);
  var first = book.getSheetByName(SHEET_FUNNEL);
  if (first) { book.setActiveSheet(first); }
  testCounter();
  showUrls();
}

// ============ ② アクセスを数える（ウェブアプリの入口） ============
// 案内ページが、https://…/exec?e=view&c=hw&w=&d=s&v=2026-10-23a のように呼びます。
function doGet(e) {
  var p = (e && e.parameter) || {};
  var ev = String(p.e || '');
  if (EVENTS.indexOf(ev) < 0) { return ContentService.createTextOutput('ignored'); }

  var d = clean_(p.d, 1, '').toLowerCase();
  if (d !== 's' && d !== 'm' && d !== 'l') { d = ''; }
  // 日時は、日本時間の「見たままの時刻」を数字（シリアル値）で書く。時刻のずれや、日付の読み違えが起きない
  var serial = (new Date().getTime() + 9 * 3600 * 1000) / 86400000 + 25569;
  var row = [serial, clean_(p.c, 16, 'none').toLowerCase(), ev, clean_(p.w, 12, ''), d, clean_(p.v, 16, '')];

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(8000); } catch (x) { locked = false; }
  try {
    var id = PropertiesService.getScriptProperties().getProperty('BOOK_ID');
    if (id) {
      var sh = SpreadsheetApp.openById(id).getSheetByName(SHEET_LOG);
      if (sh && sh.getLastRow() < MAX_LOG_ROWS) { sh.appendRow(row); }
    }
  } catch (err) {
    // 書けなかったときも、ページ側には何も伝えない（ページは普通に動く）
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (x2) {} }
  }
  return ContentService.createTextOutput('ok');
}

// ============ ④ 目安箱の受け口（アプリの「めやすばこに いれる」） ============
// アプリが、えらんだ答えを JSON にして POST します。「回答」シートに、フォームと同じ列の順で1行足します。
// 同じ中身を2回押しても1行になるように、アプリが付ける「しるし（id）」を6時間おぼえておきます。
function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '';
  if (body.length > 20000) { return json_({ ok: false, error: 'too_long' }); }
  var d = null;
  try { d = JSON.parse(body); } catch (x) { d = null; }
  if (!d || d.kind !== 'kansou') { return json_({ ok: false, error: 'bad_request' }); }
  if (OPTIONS.ok.indexOf(d.ok) < 0) { return json_({ ok: false, error: 'need_ok' }); }

  var id = clean_(d.id, 40, '');
  var cache = CacheService.getScriptCache();
  if (id && cache.get('box-' + id)) { return json_({ ok: true, dup: true }); }
  var row = [new Date()].concat(QUESTION_KEYS.map(function (k) { return boxCell_(k, d[k]); }));

  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(8000); } catch (x2) { locked = false; }
  if (!locked) { return json_({ ok: false, error: 'busy' }); }
  try {
    var props = PropertiesService.getScriptProperties();
    var dayKey = 'box-count-' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
    var n = Number(props.getProperty(dayKey) || 0);
    if (n >= BOX_DAILY_MAX) { return json_({ ok: false, error: 'full' }); }
    var bookId = props.getProperty('BOOK_ID');
    var sh = bookId ? SpreadsheetApp.openById(bookId).getSheetByName(SHEET_ANS) : null;
    if (!sh) { return json_({ ok: false, error: 'no_sheet' }); }
    sh.appendRow(row);
    props.setProperty(dayKey, String(n + 1));
    if (id) { cache.put('box-' + id, '1', 21600); }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: 'write_failed' });
  } finally {
    try { lock.releaseLock(); } catch (x3) {}
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// 目安箱の答えを、シートの1マス分にする。選択肢にない答えは入れない。
// 自由に書く欄は、長さを切り、= + - @ で始まるときは数式にならないよう先頭に ' を付ける
function boxCell_(key, v) {
  if (OPTIONS[key]) {
    var allowed = OPTIONS[key];
    if (MULTI.indexOf(key) >= 0) {
      var arr = Array.isArray(v) ? v : [];
      return allowed.filter(function (a) { return arr.indexOf(a) >= 0; }).join(', ');
    }
    return allowed.indexOf(v) >= 0 ? v : '';
  }
  if (TEXTS[key]) {
    var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, TEXTS[key]);
    return /^[=+\-@]/.test(s) ? "'" + s : s;
  }
  return '';
}

// 英数字と . _ - だけを残して、長さを切る（へんな文字が入っても、記録を壊さない）
function clean_(v, max, fallback) {
  var s = String(v == null ? '' : v).replace(/[^A-Za-z0-9._-]/g, '').slice(0, max);
  return s || fallback;
}

// 実行して「アクセス記録」に test の行ができるか確かめる
function testCounter() {
  var r = doGet({ parameter: { e: 'view', c: 'test', v: 'editor' } });
  Logger.log('テスト行を書きました（シートの「アクセス記録」の一番下を見てください）: ' + r.getContent());
}

// ============ ブック（スプレッドシート） ============
function getBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BOOK_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 消されていたら作りなおす */ }
  }
  var book = SpreadsheetApp.create(BOOK_NAME);
  book.setSpreadsheetTimeZone('Asia/Tokyo');
  props.setProperty('BOOK_ID', book.getId());
  return book;
}

function setupLog_(book) {
  var sh = book.getSheetByName(SHEET_LOG);
  if (sh) { return sh; }
  sh = book.insertSheet(SHEET_LOG);
  var heads = ['日時（日本時間）', '経路', 'できごと', '場所', '画面', '版'];
  sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground('#eceef8');
  sh.setFrozenRows(1);
  // 書き込む行ぶんを先に用意して、日時の表示形式をそろえておく
  if (sh.getMaxColumns() > heads.length) { sh.deleteColumns(heads.length + 1, sh.getMaxColumns() - heads.length); }
  if (sh.getMaxRows() < MAX_LOG_ROWS + 1) { sh.insertRowsAfter(sh.getMaxRows(), MAX_LOG_ROWS + 1 - sh.getMaxRows()); }
  sh.getRange(2, 1, MAX_LOG_ROWS, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  sh.setColumnWidth(1, 170);
  sh.getRange(1, 2).setNote('URLの ?c= の中身。none＝付いていない、test＝動作確認（集計に入りません）');
  sh.getRange(1, 3).setNote('view＝ページを開いた／try＝「ためしてみる」を押した／form＝感想ボタンを押した');
  sh.getRange(1, 5).setNote('s＝小さい画面（スマホ）／m＝中／l＝大きい画面（パソコン）');
  return sh;
}

// ============ ① 感想フォーム ============
function ensureForm_(book) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FORM_ID');
  if (id) {
    try { return FormApp.openById(id); } catch (e) { /* 消されていたら作りなおす */ }
  }
  var form = createForm_(book);
  props.setProperty('FORM_ID', form.getId());
  return form;
}

function createForm_(book) {
  var form = FormApp.create(FORM_NAME);

  form.setDescription(
    'ふらりランタンを使ってみた感想を、聞かせてください。\n' +
    'ボタンを選ぶだけで、1〜2分です。答えたくない所は、とばしてください。\n' +
    'お名前・住所・病名などは、書かないでください。\n' +
    '18歳未満の方は、保護者の方といっしょに答えてください。'
  );
  form.setCollectEmail(false);
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  form.setProgressBar(false);
  form.setConfirmationMessage('ありがとうございました。いただいた感想で、ふらりランタンをよくしていきます。');

  // --- アプリの「かんそうを おくる」と同じ質問（QUESTION_KEYS の順） ---
  radio_(form, '1. 何日くらい使いましたか？', OPTIONS.days, false);
  checks_(form, '2. どんなときに使いましたか？（いくつでも）', OPTIONS.when);
  checks_(form, '3. わかりにくかったところは？（いくつでも）', OPTIONS.hard);
  checks_(form, '4. 使ってみて、どうでしたか？（いくつでも）', OPTIONS.feel);
  radio_(form, '5. これからも使いたいと思いますか？', OPTIONS.again, false);
  checks_(form, '6. こうなったら、もっと使いたい（いくつでも）', OPTIONS.wish);

  form.addParagraphTextItem()
    .setTitle('ひとこと（自由に。声で入力してもOK）')
    .setHelpText('よかった所も、使いにくかった所も、助かります。お名前などは書かないでください。')
    .setRequired(false);

  // --- フォームだけの質問：正直な感想（10/25に足した。アプリの「かんそうを おくる」にはない） ---
  form.addParagraphTextItem()
    .setTitle('正直に、いまいちだったところ（あれば）')
    .setHelpText('合わなかった所、面倒だった所、使うのをやめた理由など、遠慮なく書いてください。きびしい感想ほど、直すときの手がかりになります。お名前などは書かないでください。')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('アプリの「かんそうを おくる」で作った文章があれば、貼りつけてください')
    .setHelpText('なくて大丈夫です。使った日数など、アプリが数えた記録を送りたい方だけ、どうぞ。')
    .setRequired(false);

  // --- どの入口から来たか（経路ごとの比べ方に使う。集計表の「フォームでの答え」と同じ文字にしてある） ---
  var where = radio_(form, 'このページを、どこで知りましたか？', WHERE_CHOICES, false);
  where.showOtherOption(true);

  // --- 最後に：使ってよいかの確認（これだけ必須） ---
  form.addSectionHeaderItem().setTitle('最後に');

  radio_(form, 'この感想を、お名前を出さずに、コンテストの応募書類に使ってもいいですか？', OPTIONS.ok, true)
    .setHelpText('全国のコンテスト（しのはら財団「ケアテック・イノベーション・コンテスト2026」）の応募書類に、感想の内容を使わせてください。お名前は出しません。「使わないで」を選んだ感想は、使いません。');

  radio_(form, '書いてもいいなら：年代', OPTIONS.age, false);
  radio_(form, '書いてもいいなら：いまの過ごし方', OPTIONS.role, false);

  // --- 回答は、同じブックにためる（あとで「回答」という名前にそろえる） ---
  try {
    form.setDestination(FormApp.DestinationType.SPREADSHEET, book.getId());
  } catch (e) {
    Logger.log('回答をブックにためる設定でエラー（フォームの「回答」タブから、あとで手で設定してください）: ' + e);
  }

  // --- 公開 ---
  try {
    if (typeof form.setPublished === 'function') { form.setPublished(true); }
  } catch (e2) {
    Logger.log('公開の設定でエラー（フォームの右上「公開」から、手で公開してください）: ' + e2);
  }
  form.setAcceptingResponses(true);
  return form;
}

function radio_(form, title, choices, required) {
  return form.addMultipleChoiceItem().setTitle(title).setChoiceValues(choices).setRequired(!!required);
}

function checks_(form, title, choices) {
  return form.addCheckboxItem().setTitle(title).setChoiceValues(choices).setRequired(false);
}

// フォームが作る「フォームの回答 1」を、集計表が探せるように「回答」という名前にそろえる
function renameAnswers_(book) {
  var id = book.getId();
  for (var t = 0; t < 8; t++) {
    var b = SpreadsheetApp.openById(id);
    var all = b.getSheets();
    for (var i = 0; i < all.length; i++) {
      var n = all[i].getName();
      if (n === SHEET_ANS) { return all[i]; }
      if (/^フォームの回答/.test(n) || /^Form Responses/.test(n)) {
        all[i].setName(SHEET_ANS);
        return all[i];
      }
    }
    Utilities.sleep(1000);
  }
  Logger.log('注意：回答のシートが見つかりませんでした。ブックの中の回答シートの名前を「' + SHEET_ANS + '」に手で変えてください。');
  return null;
}

// 回答シートで、質問の列の記号（B, C, …）
function col_(key) {
  return String.fromCharCode(66 + QUESTION_KEYS.indexOf(key));
}

// ============ ③ ファネル（自動の集計表） ============
function buildFunnel_(book) {
  var sh = book.getSheetByName(SHEET_FUNNEL);
  if (!sh) {
    var first = book.getSheets()[0];
    if (first && first.getName() !== SHEET_LOG && first.getName() !== SHEET_ANS) {
      sh = first;
      sh.setName(SHEET_FUNNEL);
    } else {
      sh = book.insertSheet(SHEET_FUNNEL, 0);
    }
  }
  sh.clear();

  var LG = "'" + SHEET_LOG + "'!";
  var AN = "'" + SHEET_ANS + "'!";
  var LOG_T = LG + '$A:$A';
  var LOG_C = LG + '$B:$B';
  var LOG_E = LG + '$C:$C';
  var ANS_T = AN + '$A:$A';
  var ANS_WHERE = AN + '$' + col_('where') + ':$' + col_('where');
  var ANS_OK = AN + '$' + col_('ok') + ':$' + col_('ok');
  var HEAD_BG = '#eceef8';
  var INPUT_BG = '#fff4dc';

  sh.getRange('A1').setValue('ふらりランタン 効果測定（自動で数えます）').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setValue('数字は「' + SHEET_LOG + '」と「' + SHEET_ANS + '」から、自動で出ます。黄色いマスは、書きかえてよい所です。見方は、いちばん下に書いてあります。');

  // ---- いまの数（経路ごと） ----
  sh.getRange('A4').setValue('■ いまの数（ぜんぶの期間）').setFontWeight('bold');
  var heads = ['経路', '経路コード', '訪問', 'ためしてみる', 'ためしてみる率', '感想ボタン', '感想の回答', '感想率', '使ってよい', 'フォームでの答え'];
  sh.getRange(5, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground(HEAD_BG);

  var first = 6;
  var last = first + CHANNELS.length - 1;
  var other = last + 1;
  var total = last + 2;
  var r, i;
  for (i = 0; i < CHANNELS.length; i++) {
    r = first + i;
    sh.getRange(r, 1, 1, 2).setValues([[CHANNELS[i][1], CHANNELS[i][0]]]);
    sh.getRange(r, 10).setValue(CHANNELS[i][2]);
    sh.getRange(r, 3).setFormula('=COUNTIFS(' + LOG_C + ',$B' + r + ',' + LOG_E + ',"view")');
    sh.getRange(r, 4).setFormula('=COUNTIFS(' + LOG_C + ',$B' + r + ',' + LOG_E + ',"try")');
    sh.getRange(r, 6).setFormula('=COUNTIFS(' + LOG_C + ',$B' + r + ',' + LOG_E + ',"form")');
    sh.getRange(r, 7).setFormula('=IF($J' + r + '="",0,COUNTIF(' + ANS_WHERE + ',$J' + r + '))');
    sh.getRange(r, 9).setFormula('=IF($J' + r + '="",0,COUNTIFS(' + ANS_WHERE + ',$J' + r + ',' + ANS_OK + ',"いい"))');
  }
  sh.getRange(first, 2, CHANNELS.length, 1).setBackground(INPUT_BG);
  sh.getRange(first, 10, CHANNELS.length, 1).setBackground(INPUT_BG);

  sh.getRange(other, 1).setValue('その他・経路なし');
  sh.getRange(total, 1).setValue('合計（test は除く）').setFontWeight('bold');
  sh.getRange(total, 3).setFormula('=COUNTIFS(' + LOG_E + ',"view",' + LOG_C + ',"<>test")');
  sh.getRange(total, 4).setFormula('=COUNTIFS(' + LOG_E + ',"try",' + LOG_C + ',"<>test")');
  sh.getRange(total, 6).setFormula('=COUNTIFS(' + LOG_E + ',"form",' + LOG_C + ',"<>test")');
  sh.getRange(total, 7).setFormula('=MAX(0,COUNTA(' + ANS_T + ')-1)');
  sh.getRange(total, 9).setFormula('=COUNTIF(' + ANS_OK + ',"いい")');
  var sumCols = [3, 4, 6, 7, 9];
  for (i = 0; i < sumCols.length; i++) {
    var c = sumCols[i];
    var L = String.fromCharCode(64 + c);
    sh.getRange(other, c).setFormula('=' + L + total + '-SUM(' + L + first + ':' + L + last + ')');
  }
  for (r = first; r <= total; r++) {
    sh.getRange(r, 5).setFormula('=IF(C' + r + '=0,"",D' + r + '/C' + r + ')');
    sh.getRange(r, 8).setFormula('=IF(D' + r + '=0,"",G' + r + '/D' + r + ')');
  }
  sh.getRange(first, 5, total - first + 1, 1).setNumberFormat('0%');
  sh.getRange(first, 8, total - first + 1, 1).setNumberFormat('0%');
  sh.getRange(total, 1, 1, heads.length).setBackground(HEAD_BG).setFontWeight('bold');
  sh.getRange(5, 3, total - 4, 7).setHorizontalAlignment('center');

  // ---- 使ってよい感想：目標と、いま ----
  var goalRow = total + 2;
  sh.getRange(goalRow, 1).setValue('使ってよい感想の数（目標 → いま → あと）').setFontWeight('bold');
  sh.getRange(goalRow, 2).setValue(5).setBackground(INPUT_BG);
  sh.getRange(goalRow, 3).setFormula('=I' + total);
  sh.getRange(goalRow, 4).setFormula('=IF(C' + goalRow + '>=B' + goalRow + ',"達成！","あと"&(B' + goalRow + '-C' + goalRow + ')&"件")');
  sh.getRange(goalRow, 2, 1, 3).setHorizontalAlignment('center');
  var GOAL = '$B$' + goalRow;

  // ---- 週ごと ----
  var wk = goalRow + 2;
  sh.getRange(wk, 1).setValue('■ 週ごと（月曜はじまり）と、その週に直したこと').setFontWeight('bold');
  var wheads = ['週のはじまり', '訪問', 'ためしてみる', 'ためしてみる率', '感想の回答', '直したこと（手で書く。例：ボタンの言葉を変えた）'];
  sh.getRange(wk + 1, 1, 1, wheads.length).setValues([wheads]).setFontWeight('bold').setBackground(HEAD_BG);
  sh.getRange(wk + 1, 7, 1, 4).setBackground(HEAD_BG);
  var weeks = 6;
  for (i = 0; i < weeks; i++) {
    r = wk + 2 + i;
    sh.getRange(r, 1).setFormula(i === 0 ? '=DATE(2026,10,19)' : '=A' + (r - 1) + '+7').setNumberFormat('m/d');
    var span = LOG_T + ',">="&$A' + r + ',' + LOG_T + ',"<"&($A' + r + '+7)';
    sh.getRange(r, 2).setFormula('=COUNTIFS(' + LOG_E + ',"view",' + LOG_C + ',"<>test",' + span + ')');
    sh.getRange(r, 3).setFormula('=COUNTIFS(' + LOG_E + ',"try",' + LOG_C + ',"<>test",' + span + ')');
    sh.getRange(r, 4).setFormula('=IF(B' + r + '=0,"",C' + r + '/B' + r + ')').setNumberFormat('0%');
    sh.getRange(r, 5).setFormula('=COUNTIFS(' + ANS_T + ',">="&$A' + r + ',' + ANS_T + ',"<"&($A' + r + '+7))');
    sh.getRange(r, 6, 1, 5).setBackground(INPUT_BG);
  }
  sh.getRange(wk + 1, 2, weeks + 1, 4).setHorizontalAlignment('center');
  sh.getRange(wk + 2, 1, weeks, 1).setHorizontalAlignment('left');

  // ---- 予測と逆算 ----
  var pr = wk + 2 + weeks + 1;
  sh.getRange(pr, 1).setValue('■ 予測と逆算（かりの数です。実際の数がたまったら、黄色いマスを書きかえます）').setFontWeight('bold');
  sh.getRange(pr + 1, 1, 1, 4).setValues([['チラシで集める場合', '低め', 'ふつう', '高め']]).setFontWeight('bold').setBackground(HEAD_BG);
  var rates = [
    ['置いたチラシ1枚あたり、ページを開く人の割合', 0.004, 0.02, 0.05],
    ['ページを開いた人のうち、「ためしてみる」を押す割合', 0.10, 0.15, 0.20],
    ['「ためしてみる」を押した人のうち、感想を送る割合', 0.10, 0.15, 0.25],
    ['感想のうち、使ってよいと答える割合', 0.8, 0.8, 0.8]
  ];
  var rQ = pr + 2;
  sh.getRange(rQ, 1, rates.length, 4).setValues(rates);
  sh.getRange(rQ, 2, rates.length, 3).setNumberFormat('0.0%').setBackground(INPUT_BG);
  var rGoal = rQ + 4;
  var rNeedAns = rGoal + 1;
  var rNeedVis = rGoal + 2;
  var rNeedFly = rGoal + 3;
  var rHave = rGoal + 4;
  var rVis = rGoal + 5;
  var rTry = rGoal + 6;
  var rAns = rGoal + 7;
  var rUse = rGoal + 8;
  sh.getRange(rGoal, 1).setValue('目標：使ってよい感想の数');
  sh.getRange(rNeedAns, 1).setValue('→ 必要な感想の数');
  sh.getRange(rNeedVis, 1).setValue('→ 必要な「ページを開く人」の数');
  sh.getRange(rNeedFly, 1).setValue('→ 必要なチラシの枚数（置いた枚数）').setFontWeight('bold');
  sh.getRange(rHave, 1).setValue('いま置いたチラシの枚数');
  sh.getRange(rVis, 1).setValue('→ その枚数で見込める、ページを開く人');
  sh.getRange(rTry, 1).setValue('→ 見込める、「ためしてみる」');
  sh.getRange(rAns, 1).setValue('→ 見込める、感想');
  sh.getRange(rUse, 1).setValue('→ 見込める、使ってよい感想').setFontWeight('bold');
  var cols = ['B', 'C', 'D'];
  for (i = 0; i < cols.length; i++) {
    var k = cols[i];
    var q1 = k + rQ;
    var q2 = k + (rQ + 1);
    var q3 = k + (rQ + 2);
    var q4 = k + (rQ + 3);
    sh.getRange(k + rGoal).setFormula('=' + GOAL);
    sh.getRange(k + rNeedAns).setFormula('=' + k + rGoal + '/' + q4).setNumberFormat('0.0');
    sh.getRange(k + rNeedVis).setFormula('=ROUNDUP(ROUND(' + k + rNeedAns + '/(' + q2 + '*' + q3 + '),6),0)').setNumberFormat('#,##0');
    sh.getRange(k + rNeedFly).setFormula('=ROUNDUP(ROUND(' + k + rNeedVis + '/' + q1 + ',6),0)').setNumberFormat('#,##0').setFontWeight('bold');
    if (i === 0) { sh.getRange(k + rHave).setValue(100).setBackground(INPUT_BG); }
    else { sh.getRange(k + rHave).setFormula('=B' + rHave); }
    sh.getRange(k + rVis).setFormula('=' + k + rHave + '*' + q1).setNumberFormat('0.0##');
    sh.getRange(k + rTry).setFormula('=' + k + rVis + '*' + q2).setNumberFormat('0.0##');
    sh.getRange(k + rAns).setFormula('=' + k + rTry + '*' + q3).setNumberFormat('0.0##');
    sh.getRange(k + rUse).setFormula('=' + k + rAns + '*' + q4).setNumberFormat('0.0##').setFontWeight('bold');
  }

  sh.getRange(pr + 1, 2, rUse - pr, 3).setHorizontalAlignment('center');

  // ---- 人づてで集める場合：声をかけた人数 → 必要な達成率 ----
  var hr = rUse + 2;
  sh.getRange(hr, 1).setValue('■ 人づてで集める場合（支援員さんの紹介・Zoom・知り合い）').setFontWeight('bold');
  sh.getRange(hr + 1, 1, 1, 5).setValues([['声をかけた人数', 10, 20, 30, 50]]).setFontWeight('bold').setBackground(HEAD_BG);
  sh.getRange(hr + 1, 2, 1, 4).setBackground(INPUT_BG);
  sh.getRange(hr + 2, 1).setValue('目標に必要な、感想まで届く人の割合');
  var hc = ['B', 'C', 'D', 'E'];
  for (i = 0; i < hc.length; i++) {
    sh.getRange(hc[i] + (hr + 2)).setFormula('=' + GOAL + '/' + hc[i] + (hr + 1)).setNumberFormat('0%');
  }
  sh.getRange(hr + 3, 1).setValue('実際の割合は、上の表の「経路」（支援員さん・Zoom・知り合い）の行で出ます。');
  sh.getRange(hr + 1, 2, 2, 4).setHorizontalAlignment('center');

  // ---- 見方と、かりの数のもと（1行を短くして、横に長くなりすぎないようにする） ----
  var nt = hr + 5;
  var notes = [
    ['■ かりの数のもと', true],
    ['・チラシ→ページを開く割合：QR追跡サービス会社の記事（linkbreakers.com）を目安にした。', false],
    ['　ポスターなど置いてあるだけの場合、QRを見た人の1〜5%が読み取る。5,000枚で20人（0.4%）は「平均より低い」例。', false],
    ['　ここでは0.4%を低め、2%をふつう、5%を高めにした。「置いた枚数」あたりなので、実際はもっと低いかもしれない。', false],
    ['・「ためしてみる」を押す割合10〜20%、100人が開いて感想が1〜5件：作った人の想定。', false],
    ['・使ってよいと答える割合80%：仮。', false],
    ['', false],
    ['■ 見方', true],
    ['・訪問＝ページを開いた回数。ためしてみる＝「ためしてみる」を押した回数。感想ボタン＝ページの「感想を送る」を押した回数。', false],
    ['・感想率＝感想の回答 ÷ ためしてみる。人づてで直接フォームへ来た人も回答に入るので、目安です。', false],
    ['・感想の回答は、フォームの「このページを、どこで知りましたか？」の答え（自己申告）で、経路に分けている。', false],
    ['', false],
    ['■ 経路コード（URLの ?c= の中身）', true],
    ['・チラシのQR：?c=sha（社協・相談窓口）／ ?c=hw（ハローワーク）', false],
    ['・人に送るリンク：?c=staff（支援員さん）／ ?c=zoom（Zoom説明会）／ ?c=voice（知り合い）', false],
    ['・置く場所ごとに分けたいとき：?c=hw-kita のように決めて、上の表に行を足す。', false],
    ['・動作確認：?c=test（集計に入りません）。', false],
    ['', false],
    ['■ 数えていないもの', true],
    ['・アプリの中の使われ方（何日使ったか など）。「記録は、あなたのスマホの中だけ」と約束しているため。', false],
    ['　感想フォームの「何日くらい使いましたか？」で、答えた人の分だけ分かる。', false]
  ];
  for (i = 0; i < notes.length; i++) {
    if (notes[i][0] === '') { continue; }
    var cell = sh.getRange(nt + i, 1).setValue(notes[i][0]);
    if (notes[i][1]) { cell.setFontWeight('bold'); }
  }

  // ---- 見た目 ----
  sh.setColumnWidth(1, 400);
  for (i = 2; i <= 9; i++) { sh.setColumnWidth(i, 120); }
  sh.setColumnWidth(10, 260);
  sh.setFrozenRows(0);
  return sh;
}

// ============ ⑤ 集計と、応募用まとめ（数式なので、開けば いつも最新。押すボタンは いらない） ============
var SUM_ITEMS = [
  ['days', '1. 使った日数'],
  ['when', '2. 使ったとき（いくつでも）'],
  ['hard', '3. わかりにくかった所（いくつでも）'],
  ['feel', '4. 使ってみて（いくつでも）'],
  ['again', '5. これからも使いたいか'],
  ['wish', '6. こうなったら、もっと使いたい（いくつでも）'],
  ['where', 'どこで知ったか'],
  ['age', '年代'],
  ['role', 'いまの過ごし方']
];

// 回答シートの列（$K:$K のような全体と、K2:K のような2行目から）
function ansCol_(key) { return "'" + SHEET_ANS + "'!$" + col_(key) + ':$' + col_(key); }
function ansFrom2_(key) { return "'" + SHEET_ANS + "'!" + col_(key) + '2:' + col_(key); }

// 選択肢の数え方：いくつでも選べる質問は「その文字を含む」、ひとつだけの質問は「ぴったり同じ」
function crit_(key, text) { return MULTI.indexOf(key) >= 0 ? '"*' + text + '*"' : '"' + text + '"'; }

// 応募用まとめの1行（使ってよい人の分だけ）。例：「これからも使いたいか：使いたい 3件、どちらでもない 1件、使わない 0件」
function pitchLine_(label, key) {
  var parts = OPTIONS[key].map(function (o) {
    return '"' + o + ' "&COUNTIFS(' + ansCol_(key) + ',' + crit_(key, o) + ',' + ansCol_('ok') + ',"いい")&"件"';
  });
  return '="' + label + '："&' + parts.join('&"、"&');
}

// 自由に書いた声を、1つのマスに並べる（使ってよい人の分だけ）
function pitchVoices_(label, key) {
  return '="' + label + '："&CHAR(10)&IFERROR("・"&TEXTJOIN(CHAR(10)&"・",TRUE,FILTER(' + ansFrom2_(key) + ',' +
    ansFrom2_('ok') + '="いい",' + ansFrom2_(key) + '<>"")),"（まだありません）")';
}

function buildSummary_(book) {
  var HEAD_BG = '#eceef8';
  var OKC = ansCol_('ok');
  var total = 'MAX(0,COUNTA(\'' + SHEET_ANS + '\'!$A:$A)-1)';

  // ---- 集計（質問ごとの数。自由に書いた欄は、ぜんぶ並べる） ----
  var sh = book.getSheetByName(SHEET_SUM) || book.insertSheet(SHEET_SUM);
  sh.clear();
  sh.getRange('A1').setValue('ふらりランタン 感想の集計（数式なので、開けば いつも最新です）').setFontSize(14).setFontWeight('bold');
  sh.getRange('A2').setValue('フォームと、アプリの目安箱の両方を数えます。「使ってよい」は、応募書類に使ってよいと答えた人の分です。');
  sh.getRange('A4').setValue('回答の数').setFontWeight('bold');
  sh.getRange('B4').setFormula('=' + total);
  sh.getRange('C4').setValue('うち、使ってよい').setFontWeight('bold');
  sh.getRange('D4').setFormula('=COUNTIF(' + OKC + ',"いい")');
  sh.getRange(6, 1, 1, 4).setValues([['質問', '答え', 'ぜんぶ', '使ってよい']]).setFontWeight('bold').setBackground(HEAD_BG);
  var r = 7;
  SUM_ITEMS.forEach(function (item) {
    var key = item[0];
    OPTIONS[key].forEach(function (o, i) {
      if (i === 0) { sh.getRange(r, 1).setValue(item[1]).setFontWeight('bold'); }
      sh.getRange(r, 2).setValue(o);
      var crit = MULTI.indexOf(key) >= 0 ? '"*"&B' + r + '&"*"' : 'B' + r;
      sh.getRange(r, 3).setFormula('=COUNTIF(' + ansCol_(key) + ',' + crit + ')');
      sh.getRange(r, 4).setFormula('=COUNTIFS(' + ansCol_(key) + ',' + crit + ',' + OKC + ',"いい")');
      r++;
    });
    r++;
  });
  sh.getRange(7, 3, r - 7, 2).setHorizontalAlignment('center');
  var lists = [
    ['F', 'note', 'ひとこと（ぜんぶ。直すときの手がかり）'],
    ['G', 'honest', '正直に、いまいちだった所（ぜんぶ）'],
    ['H', 'paste', '使った記録（送ってくれた人の分）']
  ];
  lists.forEach(function (l) {
    sh.getRange(l[0] + '6').setValue(l[2]).setFontWeight('bold').setBackground(HEAD_BG);
    sh.getRange(l[0] + '7').setFormula('=IFERROR(FILTER(' + ansFrom2_(l[1]) + ',' + ansFrom2_(l[1]) + '<>""),"（まだありません）")');
    sh.setColumnWidth(sh.getRange(l[0] + '1').getColumn(), 360);
    sh.getRange(l[0] + '7:' + l[0]).setWrap(true).setVerticalAlignment('top');
  });
  sh.setColumnWidth(1, 300);
  sh.setColumnWidth(2, 260);
  sh.setColumnWidth(3, 80);
  sh.setColumnWidth(4, 90);

  // ---- 応募用まとめ（使ってよい人の分だけ。いちばん下のマスをコピーすれば、まとめて貼れる） ----
  var ps = book.getSheetByName(SHEET_PITCH) || book.insertSheet(SHEET_PITCH);
  ps.clear();
  ps.getRange('A1').setValue('ふらりランタン 応募用まとめ（使ってよい感想だけ。数式なので、いつも最新）').setFontSize(14).setFontWeight('bold');
  ps.getRange('A2').setValue('A14のマスをコピーすると、まとめて貼れます。数は「〜件」のまま書き、効果を言い切る書き方にはしない。');
  ps.getRange('A4').setFormula('="使ってよい感想："&COUNTIF(' + OKC + ',"いい")&"件（回答 "&' + total + '&"件のうち）"');
  ps.getRange('A5').setFormula(pitchLine_('使った日数', 'days'));
  ps.getRange('A6').setFormula(pitchLine_('これからも使いたいか', 'again'));
  ps.getRange('A7').setFormula(pitchLine_('使ってみて（いくつでも）', 'feel'));
  ps.getRange('A8').setFormula(pitchLine_('わかりにくかった所（いくつでも）', 'hard'));
  ps.getRange('A9').setFormula(pitchLine_('こうなったら、もっと使いたい（いくつでも）', 'wish'));
  ps.getRange('A10').setFormula(pitchVoices_('ひとこと（原文）', 'note'));
  ps.getRange('A11').setFormula(pitchVoices_('正直に、いまいちだった所（原文）', 'honest'));
  ps.getRange('A13').setValue('▼ まとめて貼る用（このマスをコピー）').setFontWeight('bold');
  ps.getRange('A14').setFormula('=A4&CHAR(10)&A5&CHAR(10)&A6&CHAR(10)&A7&CHAR(10)&A8&CHAR(10)&A9&CHAR(10)&CHAR(10)&A10&CHAR(10)&CHAR(10)&A11');
  ps.setColumnWidth(1, 900);
  ps.getRange('A4:A14').setWrap(true).setVerticalAlignment('top');
  return sh;
}

// 集計と応募用まとめを、作り直す（シートを消してしまったときや、質問を変えたとき）
function rebuildSummary() {
  var book = getBook_();
  buildSummary_(book);
  Logger.log('集計と応募用まとめを作り直しました: ' + book.getUrl());
}

// ============ 実行ログに、必要なURLを出す（setupAll のあとにも、もう一度実行できる） ============
function showUrls() {
  var props = PropertiesService.getScriptProperties();
  var bookId = props.getProperty('BOOK_ID');
  var formId = props.getProperty('FORM_ID');
  if (!bookId || !formId) {
    Logger.log('まだ用意できていません。先に「setupAll」を実行してください。');
    return;
  }
  var form = FormApp.openById(formId);
  Logger.log('★感想フォームのURL（案内ページの CONFIG の formUrl に入れる）: ' + form.getPublishedUrl());
  Logger.log('フォームの編集用URL（質問を直すとき）: ' + form.getEditUrl());
  Logger.log('記録のスプレッドシート（ファネル・アクセス記録・回答）: ' + SpreadsheetApp.openById(bookId).getUrl());
  var web = '';
  try { web = ScriptApp.getService().getUrl(); } catch (e) { web = ''; }
  if (web && /\/exec$/.test(web)) {
    Logger.log('★ウェブアプリのURL（案内ページの CONFIG の sheetUrl と、アプリの MEYASU_URL に入れる。目安箱の送り先も同じURL）: ' + web);
  } else {
    Logger.log('★ウェブアプリのURL：まだ公開されていません。「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行：自分／アクセス：全員）で公開し、出てくる …/exec のURLを、案内ページの CONFIG の sheetUrl と、アプリの MEYASU_URL に入れてください。');
  }
  try {
    Logger.log('アプリ用のメモ（あとで、アプリに「フォームで おくる」ボタンを入れるときに使います）: ' +
      JSON.stringify({ url: form.getPublishedUrl(), e: entryMap_(form) }));
  } catch (e2) {
    Logger.log('アプリ用のメモは作れませんでした（なくても、ここまでの動きには関係ありません）: ' + e2);
  }
}

// 各質問の「entry.数字」（フォームの記入ずみリンクで使う番号）を調べる
function entryMap_(form) {
  var map = {};
  var items = form.getItems();
  var k = 0;
  for (var i = 0; i < items.length && k < QUESTION_KEYS.length; i++) {
    var it = items[i];
    var t = it.getType();
    var ir = null;
    try {
      if (t === FormApp.ItemType.MULTIPLE_CHOICE) {
        var mc = it.asMultipleChoiceItem();
        ir = mc.createResponse(mc.getChoices()[0].getValue());
      } else if (t === FormApp.ItemType.CHECKBOX) {
        var cb = it.asCheckboxItem();
        ir = cb.createResponse([cb.getChoices()[0].getValue()]);
      } else if (t === FormApp.ItemType.PARAGRAPH_TEXT) {
        ir = it.asParagraphTextItem().createResponse('x');
      } else {
        continue; // 見出しなど（答える欄ではないもの）は、とばす
      }
      var u = form.createResponse().withItemResponse(ir).toPrefilledUrl();
      var m = /entry\.(\d+)=/.exec(u);
      if (m) { map[QUESTION_KEYS[k]] = 'entry.' + m[1]; }
    } catch (e) { /* この質問だけ、番号が取れなかった */ }
    k++;
  }
  return map;
}
