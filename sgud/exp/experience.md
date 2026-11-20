# 累積經驗

本檔為執行工作時特有之累積經驗,留給後續之嘗試、執行與判斷,由agent自行編列、擴充與維護.

## 條件(find)白名單接線(第 33 項批 1)(2026-10-17)

- 通用經驗(修前紅對帳法、翻轉讀值之 Proxy 測試法、mingo 原型成員欄名缺陷、方案文字進 README 前須對 HEAD 實跑、外審派工法)記於 w-orm-lmdb 之 `sgud/exp/experience.md` 同名一節,此處只記本套件特有者.
- **Date**: 數據以 JSON 存檔,Date 存入後為 `toISOString()` 字串;條件內之 Date 於轉譯層 `isoFind` 轉為 ISO 字串(修正前對 `$eq/$gt/$gte/$lt/$lte/$in` 恆不命中、對 `$ne/$nin` 恆命中而 delAll 可刪光全表).限制同 w-orm-level(字典序、範圍外年份、與字串欄位混比).
- **無法解析之資料庫檔夾具**: 直接把 `{ not a json` 寫入資料庫檔,任何讀取皆拋 JSON 解析錯誤;用以驗證「檢核先於讀檔」.壞條件之 `delAll` 不得改寫資料庫檔: 比對內容與 `mtimeMs`(修正前壞條件會刪光並改寫).
- **佇列為 module 層、以檔案路徑為鍵**: 驗證「檢核在佇列之外」時,先不 await 一個 2000 筆之 `insertBulk` 再呼叫壞條件,於結果定案當下(同一 microtask 鏈內)取旗標,不可在 `await tick()` 之後取(此時 insertBulk 可能已完成).
- **本套件無 `close()`**: 規格 T11.3 之「已關閉先於檢核」不適用,不得為了與其他套件對稱而補此測試.
- **變異腳本**: `tmp/mutate2.mjs`(需環境變數 `WSRC=WOrmLowdb.mjs`,不設 `HASCLOSE`),搭配 `tmp/runvariant.mjs`(`WSRC` 同)、`tmp/classify.mjs`(另需 `WFILE=1`,因 lowdb 之 url 為檔案路徑)、`tmp/reconcile.mjs`(審計欄位索引 6).

## 範圍外 Date 條件 fail-closed(第 67 項,R-FIND-02)(2026-10-19)

- 與 w-orm-level 同一規則同一改法,通用經驗(條件側/數據側哨兵須分開報告、以 `undefined` 取代 Date 令 `cvOrmFind` 給出路徑做逐字比對、年份 0–99 勿用 `Date.UTC`、拒收案例須傳同一條件物件逐節點比對、接受側參數化、變異腳本與 `git show HEAD` 取修前紅、外審派工法)記於 w-orm-level 之 `sgud/exp/experience.md` 同名一節.
- 本套件特有: 沒有 `close()`,故 date-range 無「已關閉先於檢核」案;無法解析之資料庫檔以 `fs.writeFileSync(url, '{ not a json')` 製造;壞條件 `delAll` 另驗資料庫檔內容與修改時間不變(`norewrite` 案).
- 變異腳本 `tmp/mutate-date.mjs` 與 `tmp/run-head.mjs` 放在 w-orm-level 之 `tmp/`,以參數指向本 repo(`node <level>/tmp/mutate-date.mjs <lowdb 根> WOrmLowdb.mjs unit-find-whitelist.test.mjs`).

## 寫入時拒收範圍外 Date(第 67 項第 2 次執行,R-DATE-01)(2026-10-19)

- 與 w-orm-level 同一規則同一改法,通用經驗(檢核對象為佇列內 `cloneDeep` 後之複本、以 `JSON.stringify(節點)` 判定、Date 辨認法、循環參照以祖先堆疊略過、資料之鍵以括號法表示、效能、修前紅要連 `test/lib` 一起複製)記於 w-orm-level 之 `sgud/exp/experience.md` 同名一節.
- 本套件特有: lowdb 以 `JSON.stringify(data, null, 2)` 整檔寫回(`JSONFile`),與 level 之逐值 JSON 編碼對 Date 的序列化相同;`insert` 後記憶體 `lowdb.data[key]` 仍含 Date 物件直到下次 `read()`,測試一律以 `select`/`selectByPk`(會重讀檔)讀回;資料庫檔所在資料夾須先建立(`fs.mkdirSync(url, { recursive: true })`).
- lowdb 版 `unit-date-write.test.mjs` 由 level 版以 `tmp/gen-lowdb-test.mjs`(位於 w-orm-level 之 `tmp/`,每處取代恰一處)產生,差異只有資料庫建立方式與無 `close()` 案;日後改 level 版後須重跑該腳本並確認 lowdb 版無漂移.
- 變異/修前紅/效能腳本(`mutate-write.mjs`、`run-head-write.mjs`、`bench-write.mjs`)放在 w-orm-level 之 `tmp/`,以參數指向本 repo.
- 外審(sol 額度用盡改派 Argon)、lodash-es `isBuffer` 恆 false 對 `cloneDeep(Buffer)` 之影響、走訪改用已走訪集合避免菱形圖指數時間、「檢核先於讀取」夾具(本套件為壞 JSON 檔 `fs.writeFileSync(file, '{ not a json')`)等經驗見 w-orm-level 之 `sgud/exp/experience.md` 同名一節.

## 寫入入口前置處理移入 try(第 80 項,R-WRITE-ERR-01)(2026-10-20)

- 與 w-orm-level 同一規則同一改法,通用經驗(盤點 try 之外之前置、早退 `return` 置於 try 內、`emitError` 對任意拋出值之處理、拋出值型別軸、斷言釘住兩半、變異法 `tmp/mutate-pre.mjs`、外審派工)記於 w-orm-level 之 `sgud/exp/experience.md` 同名一節.
- 本套件特有: 資料庫檔之資料表鍵為 `<db>:<cl>`(如 `worm:cc`);快取是否重設以「快取為熱時自實例外改寫 JSON 檔,其後 `select` 讀到檔案內容即已重設」觀測(`readData` 每次 `lowdb.read()` 重讀檔案);無 `close()`,測試無「已關閉」案.
- 探針與測試派生: w-orm-lowdb `tmp/probe-claim.mjs` 由 w-orm-level 版以 `sed` 改匯入與 `mk` 派生;測試檔 `test/unit-write-pre-error.test.mjs` 由 w-orm-level 版派生後改 `mk`/`before`/`after`/快取觀測並去掉已關閉案,修正外審意見時兩檔以同一份文字修補腳本(w-orm-level `tmp/patch-tests-r2.mjs`,錨點恰一處)施作,避免兩版分歧.

## 第 66 項批 1c 字串良構接線之經驗(2026-10-20)

- 與 w-orm-level 之批 1b 同一規則同一改法,通用經驗見 w-orm-lmdb 帳本 R-ORMSTR-01 與其經驗節、w-orm-level 經驗節(複製時點與 `mutate-after-call` 之偏離、save 合併只檢輸入側 `vIn`、Date 與良構檢核之順序)。
- **本套件特性**: lowdb 以 JSON 檔存放,孤立代理字元於鍵、值、比較皆保真,本批無缺陷可修,價值在系列一致;測試以「被拒之寫入不落盤(檔案位元組全等、不含 `\ud800` 類轉義)」證明檢核先於寫檔。舊資料因保真而留存,以直接寫 JSON 檔造夾具(`JSON.stringify` 將孤立代理寫為轉義,讀回仍為孤立代理)。
- **測試快**: 全檔約 25 秒(每案一個獨立 JSON 檔,案後刪除);變異全檔執行,約 3 分鐘跑完全部變異。
- **範圍外觀察(未修)**: 與 level 同,`haskey(kp, v.id)` 之 `in` 語意使 id 為 `constructor` 等 Object.prototype 成員名時 `insert` 回 `nInserted:0`(探測 `tmp/probe-proto-id.mjs`:insert `nInserted:0`、save `nInserted:1`),已列入報告待主控處置。**已於 2026-10-21 第 66 項批 1c run02 修正**(見下節與帳本 R-PKMAP-01)。

## 第 66 項批 1c run02:主鍵存在性對照表改 Map(R-PKMAP-01)(2026-10-21)

- **判斷成員勿用 `in`(含 wsemi `haskey`)、勿以一般物件存使用端字串為鍵**: 與 w-orm-lmdb(2026-10-12)、w-orm-level 同一規則同一改法(`getKpPk` 回 `Map`)。盤點以「對照表所有讀寫站點」為單位(`haskey`、`get(kp, …)`、`kp[id] =`、`delete kp[id]`),不只找 `haskey`;模組層 `kpGqueue`(鍵為絕對路徑)、`readData` 之 `haskey(lowdb.data, key)`(鍵 `db:cl` 恆含冒號)、`kpDel`(鍵為陣列索引)皆因鍵不可能等於原型成員名而**刻意不套**,以測試佐證(`db`/`cl`/檔名為原型成員名可正常往返),避免為不可觀測之處改碼。
- **修前探針先量清楚各站點實況,不憑推論寫帳本**: 本套件 `save`/`del`/`selectByPk` 因 `get(kp, id, null)` 搭 `iseobj` 對缺席之原型成員名恰回非物件而修前即正確,真正錯的是 `insert`/`insertBulk` 之 `haskey`,以及 `kp['__proto__'] = {k, v}` 改寫原型後主鍵 `k`、`v` 被判存在(`selectByPk('v')` 回 `2`、`del` 誤報已刪、`save` 誤報 `nModified`)。初稿帳本曾臆測「`save` 結果不穩定」而被探針推翻,已更正。
- **變異初版 3 項存活是測試缺格的訊號**: 把 `kp.get` 改回物件取值(D03–D05)原先存活,因缺席之原型成員名不可觀測;補 `__proto__` 列存在時之欄位名交叉案(`name`、`k`、`v` × `selectByPk`/`save`/`del`)後全紅。變異輔助 `inKp`/`getKpObj`/`ObjKp` 以**賦值語意**重建一般物件(`o[a] = b`,含 `__proto__` 改寫原型之特性),才與修前行為完全同義;`Object.fromEntries` 以 CreateDataProperty 建立自有屬性,不重現該特性。
- **兩套件共用測試主體**: `test/unit-protokey.test.mjs` 以標記行 `//=== 以下兩套件相同 ===` 分隔差異處(`mk`、`closeWo`、`before`/`after`)與主體,lowdb 版由 level 版經 `tmp/gen-lowdb-protokey.mjs` 產生,改測試只改 level 版再重新產生。level 因每案開關 LevelDB(約 200 ms)全檔約 57 秒,lowdb 約 2 秒。
- **作業事故(已清除)**: 以 `for p in "路徑:檔名"` 之 `${p%%:*}` 拆分時被磁碟機代號 `C:` 之冒號截斷,於 lmdb 工作目錄誤建空資料夾 `./C/tmp/pre/{src,test}`(無檔案),已即時 `rmdir` 清除並回驗;含磁碟機代號之路徑勿以冒號作分隔符。

## 診斷輸出單一出口(第 153 項,R-DIAG-01)(2026-10-28,lowdb-run01)

- 與 w-serv-orm 1.1.20、w-orm-reladb 1.1.16 同一介面(`opt.logDetail`、`opt.funLog(label, safe, detail)`),**各套件自行實作**;本套件由 w-orm-reladb 之 `src/getDiag.mjs` 精簡派生(去掉 SQL、`PRAGMA key`、`maskUrl`、`sequelize` 專屬之 `original.code`/`parent.code`、單引號加倍形式).
- **先量站點再動手**: lowdb 只有 2 個實際執行之 console 站點(訂閱函數拋錯),底層 `lowdb`/`steno`/`mingo`/`eventemitter3` 皆無日誌;不必為「與 reladb 對稱」硬造其他站點.連線字串在本套件是檔案路徑,無帳密,故以 `opt.url` 原值與 `path.resolve(url)` 當秘密,不另寫 `maskUrl`(建構函式錯誤訊息本即固定詞彙).
- **`logDetail` 要還原「舊格式」須實測 `util.format` 逐字相同,不能只看有沒有標籤**: reladb 的 `new Error()` 副本在 `TypeError`、`RangeError`、自訂 Error 類別時,`util.inspect` 首行變 `Error [TypeError]: …` 或 `Error: …`(修前 `TypeError: …`、`SubErr [Error]: …`).原因是 `inspect` 的 `improveStack` 看 **`constructor.name`** 與 `err.name`.解法: 副本之原型設為 `Error.prototype` 之子物件、只帶一個 `constructor`(名稱同原建構子,只讀自有資料屬性),`instanceof Error` 仍真且不沿用使用端原型.探測腳本比對 `util.format(原值)` 與 `util.format(cpMask(原值))`,修前 7 項差異、修後 2 項(非 Error 類別實例、原型為 null 之錯誤,文件化).**此點 reladb 外審(F18)只抓到「標籤」,未抓到子類別首行**,日後同型套件宜一併檢查.
- **回傳契約 golden 要用「修改前 HEAD 程式」產生**: `tmp/…/genGolden.mjs <HEAD 副本> <輸出>`,情境用固定主鍵(避免 `genIDSeq` 隨機),並納入失敗操作(重複主鍵、非法條件、範圍外 Date、孤立代理主鍵、`del` 空 id);golden 內若出現本機路徑則產生腳本拒絕寫出.訂閱函數拋錯之 console 行數(17)與首行也一併凍結,供 `logDetail` 對照.
- **修前紅的做法**: 修前版 `WOrmLowdb.mjs` 放 `tmp/…/red/src/`,測試複製到 `red/test/`,以 `runIn.mjs`(`spawnSync(cmd, args, { cwd })`)在副本根執行 mocha(測試讀 `./src`、`./test/tools` 相對於工作目錄;守門 hook 禁 `cd`).Node 的裸引用會自 `tmp/…/red/` 向上解析到 repo 根 `node_modules`,不需複製套件.
- **變異腳本**: 以字串取代施加變異並要求 `from` 恰出現 1 次(0 次=未套用,>1 次=不明確),先正規化 `\r\n`(本 repo 檔案皆 CRLF).初跑 `G16`(單引號加倍)存活 → 該形式屬 SQL 專屬,刪碼而非補測;`W10` 因寫錯檔案名而「未套用」,屬變異腳本自身之錯,以「未套用數」欄位才看得出來.
- **外審**: terra 於派工探測即回 `You've hit your usage limit … try again at 10:56 AM`(stderr),依任務書遞補改派 Argon(`agy` `gemini-4-argon-high`、`skipPermissions: true`、`addDirs` 只含審查夾;參考實作副本放審查包 `pkg/ref/` 而非開放其他 repo 目錄);審查包只放本次改動檔與副本,提示詞以功能正確性措辭並要求探測限 `work/` 副本.
- **外審實況與教訓**(lowdb-run01): 第 1 輪 Argon 12 條多屬「首版自審沒想到的形態」——steno 寫檔暫存檔 `.<檔名>.tmp`(真實寫檔失敗時系統錯誤訊息帶它,而 `opt.url` 與 `path.resolve(url)` 都不含它)、Proxy 使原型鏈走訪無窮迴圈、預設摘要的 `code` 欄位取自一般物件、陣列附加鍵與 `new String` 包裝物件、`byteLength` 可被覆寫;**遮罩清單要從「該路徑會經過哪些底層模組」推導,不能只列使用端傳入的字串**.一輪外審耗盡 Argon 週額度 99%,第 2 輪只能改派 agy-flash(它仍找到 5 條,含一個假陽性測試與陣列索引上限),**複審前先以 `quota-agy.mjs` 看額度,重大改寫後的複審優先排在 terra 額度恢復後**.
- **`util.types` 可用**: rollup 對 Node 內建模組不要求列入 external(`rollupFiles` 文件明載「Node內建模組除外」,實建置僅警告 `output.globals` 未命名 `util`),reladb 首版因誤以為不可用而棄用 `util.types`,致無法安全辨識 Proxy/包裝物件/二進位內部槽;本套件改用後與 w-serv-orm 一致.不用 `instanceof`(會觸發原型鏈上 Proxy 的 trap)是同一道理.
- **假陽性測試的辨認法**: 把「被測分支整個拿掉」做成變異;thenable 測試曾因 reject promise 在 `then` 內才建立而對「移除 thenable 分支」仍全綠.凡「應被吞下的 rejection」測試,promise 須在被測呼叫**之前**建立,並斷言 `then` 確被呼叫.
- **等價變異要明示**: 放一個確定等價的變異(如多一個 microtask)確認變異腳本能報「存活」,並在報告註記,不要把它當缺口去補測.
- 本輪探針/變異/golden 產生腳本已備份於 `C:\opensrcOper\dnow\20261028054319\agent-out\lowdb-run01-evidence\tools\`(`genGolden.mjs`、`mutate.mjs`、`mutate2.mjs`、`probeFmt.mjs`、`buildDist.mjs`、`demo.mjs`、`runIn.mjs`、`listLinks.mjs`、`verifyRound2.mjs`),本機 `./tmp/` 已清除.
- **Edit/Write 工具在本 repo 皆保持 CRLF**(`grep -c $'\r$'` 全檔等於行數);勿以腳本改檔造成混合換行.
- 作業: 守門 hook 禁 `cd`、heredoc、`node -e` 寫檔;`node -e` 僅用於讀取(JSON 摘要).

## 診斷與遮罩遷移至 wsemi 共用實作(第 161 項,mig-lowdb)(2026-10-29)

- **迴避的坑:不得自行補遮罩邏輯**.遷移時唯一新增之判斷是「哪些 reject 是外來值、哪些是套件固定詞彙」,以 module 層 `WeakSet`(`mkErr` 登錄、`isOwnErr` 判定)解,不讀錯誤物件任何屬性(Proxy 亦安全);所有遮罩仍經 `diag.err`/`diag.mask`.catch 站點內同時會收到自身 `throw`(固定詞彙)與外來值,不能一律包 `diag.err`,否則含憑證樣式之鍵名/主鍵(如 `password=…`)會被誤遮.
- **lowdb 之 reject 清單為空**:儲存路徑以 `paths` 宣告只入 detail 清單(Q3 對外錯誤值不遮路徑),故 `diag.err` 在本套件只靠樣式規則(網址帳密、`password=`/`token=`/`"password":` 鍵值對、Bearer)生效.測試探針須用樣式型憑證,不能用「登錄的密碼」(語料之 `ctx.sec.password` 無法登錄於 lowdb).
- **真實外來錯誤源**(不 mock):① 損毀之資料庫檔使 `lowdb.read()` 拋 `SyntaxError`,V8 訊息在內容 ≤ 約 20 字元時整段帶出(`Unexpected token 'p', "password=… }" is not valid JSON`),可一次打到整批 7 站;**測試須先自檢前提**(`JSON.parse` 該內容之訊息含憑證),以免他版 Node 訊息格式改變而空轉.② 逐筆站:del 用「原型上可列舉存取器 `id`」(`get(v,'id')` 首讀即拋);save 用「合併階段才拋」之存取器——getter 內以 `new Error().stack.indexOf('merge')` 判斷呼叫端為 lodash `merge`,避免依賴讀取次數.
- **語料 wire 案怎麼接**:語料以 `ctx.sec.password` 當秘密,lowdb 之秘密是檔案路徑,故令 `ctx.sec.password = 一個不存在之相對 url`(`zzWireQ9x7Kd/zzDbQ9fileK`,從不讀寫)並由 `select({ $foo: 1 })` 觸發 error 訂閱函數(`procFind` 在讀檔前拒收,零磁碟存取)再拋 `make(ctx)` 之值,取 funLog 之 detail 給 `verify`.**不要用 repo 內真實路徑當「密碼」**:語料以 5 字元窗比對,`file:///C:/opensrc/…` 之堆疊行會與路徑片段誤報洩漏.新增之 wire 案未登錄於處置表時,第一個測試判紅(強迫逐案處置).
- **wire 案處置表紅燈時以失敗訊息之差集為準**(orm233,wsemi 1.9.36: 派工說新增 A11,實際差集為 A11、C14、U22 三案,語料 wire 案共 23): 判定是否適用須追診斷輸出路徑——查 `src` 的 import(只有 `getDiag`、`getDiagSecrets`)與 wsemi `getDiag.mjs`、`getDiagSecrets.mjs` 之 import 皆不含 `genDiagFunLog`,再看本套件 `getDiag(opt, {…})` 之宣告(有 `paths`、`safeKeys`;無 `codes`、`types`、`conns`),不只 Grep `src` 有無字樣.處置表測試內寫死之案數(`20`)與 `na` 計數須同步改.
- **fail-closed 之外顯影響**:`diag.err` 對「自有存取器屬性之物件」回副本(`{ message: '[Getter/Setter]' }`),使 `unit-write-pre-error` 之「拋出 `{ get message() { throw } }` → reject 為拋出者本身、事件訊息 `unknown error`」型不再成立(getter 不被執行是改善);該案期望依新規則更新並載入 README/帳本,不是放寬.
- **logDetail 之 util.inspect 差異**:wsemi 副本不沿用使用端原型,`class MyErr extends Error {}` 之副本 `name` 屬性保留為 `MyErr`,但 `util.inspect` 依 `constructor.name` 顯示 `Error: …`(第 153 項自製版曾以子原型保留);屬規格明定之取捨(副本原型一律內建),已入 README 與接線測試,**未**當作 wsemi 缺陷.
- **變異腳本**:`mocha --reporter json --reporter-option output=<檔>` 取失敗標題,以標題前綴 `[靜態]` 分開計「行為測試殺死」與「靜態盤點殺死」;每變異用「`from` 恰出現 1 次」之取代並要求原始碼確有變動.等價變異(`procPk` 之固定訊息不含資料)僅靜態盤點抓到,於報告明示.
- **打包驗證**:以 `toolg/gDistRollup.mjs` 同設定建到 tmp 並實跑 UMD(insert、change 訂閱函數拋錯之 funLog、損毀檔之 reject 遮罩);wsemi 之診斷模組不含靜態 Node 內建 import,UMD 內唯一之 `require("util")` 來自 lodash 之 `nodeUtil`.
- 測試鎖等待:本機常有他套件持鎖,單次 `--lock` 等 1.5–2 分鐘,合併成少次執行(變異腳本內部串行跑 27 變體 + 基準,一次 33 秒).
- 本輪探針/變異/建置腳本備份於 `C:\opensrcOper\dnow\20261029002013\agent-out\mig-lowdb-evidence\`,本機 `./tmp/mig-lowdb/` 已清除.

## wsemi 判斷函數不拋錯後之防線修復(olw492i)(2026-11-19)

- **症狀與成因**: wsemi 1.9.69 起判斷函數(`isestr`、`isbol`、`iseobj`、`isearr`、`haskey`)對讀取即拋錯之值回 `false`;本庫之「error 事件恰一次後 reject」等防線有一部分是借判斷函數之拋錯成立,連動跟跑時 `unit-write-pre-error` 轉紅 12 案.**只修紅燈會漏站點**: 測試只紅在寫入入口之 `data`,實際行為差異於探測集合(21 種敵意值 × 29 個入口呼叫形 = 609 格)共 123 格,其中 111 格(`selectByPk` 之 pk、`insert` 之 `option.returnList`、建構函式 5 個選項、`getErrMsg`、其餘敵意值之 `data`)無任何既有測試.
- **找站點之法(新舊並跑)**: `npm pack wsemi@<舊版>` 解到 `./tmp/<任務>/old/node_modules/wsemi`,把 `src/` 複本放 `./tmp/<任務>/old/src/`(裸引用自 `./tmp/…` 向上解析到 repo 之 `node_modules`,不需 junction),以同一支探測腳本對「舊 wsemi」「HEAD + 新 wsemi」「修後」三者各跑一次,逐入口餵敵意值,比對行為(resolve/reject、事件、資料庫).`git archive HEAD src test` 解到 `./tmp/` 作修前紅.修後與舊 wsemi 之差異須只剩訊息文字與自動產生之主鍵.
- **探針之讀取範圍須逐判斷函數對齊修前**(外審一輪即指出首版範圍有偏): 首版以「標籤 + `ownKeys` 等」一體之探針涵蓋所有站點,實測 `isbol`(修前為 lodash `isBoolean`,另讀 `Symbol.toStringTag` 之 `has` 陷阱與屬性描述子,函數值不讀)、`isestr`(標籤式,標籤為 `String` 者另讀 `length`)、`iseobj`(for…in,含原型鏈上之 Proxy,只走字串鍵)之讀取集合各不同,一體探針會在某些值上「多拋」(修前可讀者變不可讀)或「少拋」.改為 `probeReadable(值, kind)` 三種 kind 後,對 21 種敵意值 × 13 站點之 R/. 表與修前舊 wsemi **逐格相同**(`tmp` 表 `table.mjs` 之輸出).
- **探針放在判斷函數回 `false` 之後,不放前面**: 放前面會多讀一次——「第 2 次讀取才拋錯」之值(單元素陣列之 `[0]` getter、`ownKeys` 陷阱)原本為「判斷函數第 1 次讀成功而有效 → `cloneDeep` 第 2 次讀拋錯 → 原通道」,探針先讀第 1 次後判斷函數讀第 2 次拋錯被吞成 `false` 而早退,**探針自己造成回歸**(變異 P01 驗證).放後面另有好處: 有效資料之路徑零額外讀取與成本.以「同形陣列單獨呼叫 `isearr` + `cloneDeep` 之 getter 讀取次數」為基準鎖定讀取次數(不寫死數字,wsemi 內部讀取數改變時不致誤紅).
- **容易漏之站點**: `getErrMsg` 之 `isestr(message)`——呼叫端拋出之值其 `message` 為不可讀者(已撤銷之 Proxy 等),修前 `del` 逐筆之 `procMsg`(不包 `try`)拋錯使整批 reject,修後(未探針)改為該筆 `ok:0` 附 `[object Object]`.只靠「新舊並跑」之敵意值集合含「拋出值之 `message` 為敵意值」才掃得到(`emitError` 有 `try` 與 `diag.err` 先處理,走它掃不到).
- **等價/不測之處**: 拋出者為 `Reflect.has` 陷阱而其他讀取皆可者,於 `isestr` 站點修前不讀(`has` 陷阱拋錯之 Proxy 當 `pk` 修前回 `null`),探針依 kind 不讀,對照案鎖定.包裝物件(`new String`/`new Boolean`)之行為改變來自 wsemi 1.9.69 之「只收原始值」(`{ id: new String('x') }` 修前 reject `invalid id: not a string`,現被視為無有效主鍵而改用自動產生之主鍵;`opt.db` 為 `new String` 修前建構時 throw,現用預設),非探針所致,不在規則 7 範圍;依 dspec〈輸入參數之檢測機制〉(使用者 2026-11-16 定甲,W-20)判斷函數只收原始值、以其守門者收到包裝物件依失敗通道處理(opt 視為未給),屬預期,非缺陷.
- **變異之設計**: 以 `quiet-run --lock` 逐變異各跑一次,變異置於 `./tmp/…/mut/<編號>/src` 副本(不動 repo);除「各站點移除探針」外,另做「探針本體缺一項讀取」「過度擴大(讀函數值、`str` 讀 `has`、`data` 對非 Array 標籤皆走訪、陣列讀全部元素、改含 Symbol 鍵)」「次序(探針移到判斷函數之前)」「種類誤用」四類;過度擴大類須有對照案才殺得死,故對照案刻意含: `Map` 標籤之 Proxy 其 `ownKeys` 拋錯者、只有 Symbol 鍵之 Proxy、`[1]` 讀取次數、有效單元素陣列之讀取次數.
- **本 repo 之工作樹換行為 LF**(`autocrlf` 為 true,提交時由 git 轉換): 前述「Edit/Write 皆保持 CRLF」已過時,以 `grep -c "$(printf '\r')$"` 實測為 0.

## 主鍵「給了而非字串」拒絕與改用 wsemi `chkReadable`(第 557 項,oro557a)(2026-11-20)

- **「未帶」只能用 `===` 判,不可再借判斷函數**: 1.9.69 起 `isestr` 只收原始值,原 `procPk` 之 `!isestr(v.id)` 把 `5`、`new String('a')` 等「給了」之值當成「未帶」靜默換成新主鍵(`autoGenPk` 為 `true` 時)或以「缺主鍵」訊息拒絕(`false` 時).改為 `isNoPk`(`id === undefined || null || ''`),其餘一律原樣交給後續 `chkPk`(`getWellFormedMsg`)依既有通道拒絕: `insert`/`insertBulk` 整批 reject、`save` 逐筆 `ok:0`——`save` 於 `autoGenPk:false` 時原為整批 reject,現為逐筆,屬隨「給了」而非「未帶」之自然結果(與 w-orm-mongodb 之 `api-pk-given` 同).
- **先用探針量修前,別憑推論**: 修前表(`tmp` 之 `probe.mjs`,入口 × 輸入 × `autoGenPk`,128 列)顯示 `del`/`selectByPk` 修前已拒(`ok:0`/回 `null`),只有 `insert`/`insertBulk`/`save` 靜默換 id;資料內「讀取即拋錯之 id 值」(已撤銷之 Proxy、`toStringTag` 拋錯、`ownKeys` 拋錯)修前即由 `cloneDeep` 拋出而 reject(訊息為拋出者之原訊息,非固定詞彙),不在判斷函數站點內,維持.
- **`chkReadable` 不呼叫存取器**: 原本地探針於 `length` 為 1 之陣列自讀 `[0]`(`isearr` 也讀,getter 拋錯即回 `false`),`chkReadable(v, { elements: 'first' })` 對存取器元素只取描述子不呼叫,偵測不到;規則二.3 允許於呼叫端 try 內自讀,故 `assertReadableData` 於 `chkReadable` 通過後以標籤為 `[object Array]` 且 `length === 1` 時 `Reflect.get(v, 0)`,失敗同為不可讀(固定詞彙).檢核之標籤須取自 `chkReadable` 已讀成功者,不重新讀不可讀之值.
- **讀取範圍跟著判斷函數之語意走,不跟舊探針走**: 舊探針之 `'bol'` 讀 `has` 陷阱與屬性描述子、`'str'` 對 `String` 標籤另讀 `length`,是為對齊 wsemi 1.9.68 之 lodash `isBoolean`/標籤式 `isstr`;1.9.70 之 `isbol`/`isestr` 為 `typeof`,規則二.4 對照為 `chkReadable(v)`(只標籤),故這幾種值由「不可讀」變「可讀而型別不符」(用預設);函數值則由「不讀」變「讀標籤」(已撤銷之函數 Proxy 作布林選項改為拒絕);空陣列 Proxy 之 `getOwnPropertyDescriptor` 於讀 `length` 時拋錯者作 `data` 由「早退」變「拒絕」(`elements:'first'` 以描述子讀).測試 `KINDS` 之 `str`/`bol`/`data` 旗標依 `chkReadable` 之文件化讀取範圍手寫,不由被測函數產生,再與實測核對一致.
- **`ownKeys:true` 對大型別陣列有成本,須以標籤先行**(唯讀複審實測發現,首版照規則字面對所有標籤給 `ownKeys:true`): `chkReadable` 之 `ownKeys` 對任何標籤皆讀 `Reflect.ownKeys`,`insertBulk(Buffer.alloc(1e7))`(可讀而型別不符,應早退)約 6.7 秒、堆積增 845MB,5e7 者配置失敗而被誤判為不可讀;舊本地探針與 `iseobj` 都只對 `[object Object]` 讀鍵.改為先讀標籤、只對 Object 標籤給 `ownKeys`,並以「標籤偽裝為 `Uint8Array`/`Map`/`Date` 之物件其 `ownKeys` 陷阱計次為 0」鎖定(只看耗時之測試不穩,計次才有鑑別力).已回饋 wsemi(提供淺選項或略過 ArrayBuffer 視圖).教訓: 規則字面之呼叫形(`{ ownKeys: true }`)未必等於舊探針之範圍,**移除本地探針前先以「大型/特殊標籤之無效輸入」量成本與行為**.
- **改測試須分辨「依舊行為之斷言」與「真缺陷」**: `unit-wellformed` 之一案以 `{ id: 12345 }` 當「未帶有效 id」驗證補主鍵(即 1.9.69 之靜默換 id 被寫成預期),規則一明令禁止,故改 `{ id: null }`(仍屬未帶);非放寬,是規格翻譯修正,並於 README 不相容變更與帳本載明.
- **變異腳本之測試集不必含全套**: 含 `unit-wellformed`(每案約 45 秒)使單一變異逾 50 秒,36 項須半小時;只取 `unit-pk-given`、`unit-readable-probe`、`unit-write-pre-error`、`unit-autogenpk` 約 8 秒/項.

## 全族對齊輪 A1–A6(第 557 項,oro557a2)(2026-11-20)

- **先以同一探針逐代號實測修前,再只改不合者**: 276 格探針(代號 × 入口 × 輸入形狀,修前取 `git archive HEAD` 之 `src`)顯示 A5(`selectByPk` 不可讀 `pk`)、A6(主鍵給了而非字串)修前已合,只補測試;A1–A4 不合.不合者之改法共四個單一來源(`mkReadErr`/`isReadErr`、`getOptVal`、`cloneInput`),站點不逐點改寫語意.
- **A4 以「錯誤種類」登錄而非逐點傳 `null`**: 入口階段拒絕皆為固定詞彙之「不可讀」錯誤,於 `mkReadErr` 登錄 `WeakSet`,`emitError`(單一發射點)見 `isReadErr` 即傳 `null`;各 `*Core` 之 `emitError('insert', data, res)` 呼叫不動.代價: 以種類判定,故 `err.message` 不可讀者(複製之後拋出)之事件 `data` 亦為 `null`(已入帳本已知限制⑤).變異 A4-01/03/04/05/06 證明站點與登錄缺一即紅.
- **A1/A2 之分辨**: `get(容器, 鍵)` 拋錯時以 `chkReadable(容器)`(只讀標籤)判斷,非空即容器不可讀(`invalid opt`/`invalid option`),否則視為成員存取器(`invalid opt.<鍵>`/`invalid option.<鍵>`).`chkReadable` 不呼叫存取器、不拋錯,故可放在 `catch` 內.只對字串鍵拋錯之 `get` 陷阱 Proxy 會判為成員(與系列參考實作同,見帳本限制⑥).
- **複製處之 catch 不分辨原因 = 無法複製者之訊息一併改**: `cloneInput` 之 catch 無從分辨「呼叫端存取器拋出」與「lodash/引擎自拋」(原型為 `null` 之 Date 之 `Cannot convert object to primitive value`、20000 層巢狀之 `Maximum call stack size exceeded`),故一併轉固定詞彙(README 不相容變更已載).
- **舊測試承擔了兩種職責,改釘時須分開**: `unit-write-pre-error` 之 `thrownValues`(8 種拋出值型別 × 4 入口)與 `unit-diaglog-wire` 之 R01/B 組,原以「資料內自有存取器拋出」為外來錯誤之觸發,同時驗證(i)入口階段拒絕之通道與(ii)外來錯誤之身分/遮罩(R-DIAG-01、fail-closed 副本).A3 後自有存取器於複製階段即轉固定詞彙,(i)改釘固定詞彙,(ii)改以**複製之後才讀取之原型上 `id` 存取器**觸發(`Object.create({ get id() { throw … } }, …)`;`del` 之逐筆讀取另有既有案),不可直接刪案而失去(ii).
- **失敗斷言勿對不可讀之值用 `assert.equal(值, null)`**: 修前紅時 `ev.data` 為敵意物件(已撤銷 Proxy、`get` 陷阱拋錯之 Proxy),`assert.strict.equal` 產生訊息時檢視該值,mocha 於中途無摘要即以離開碼 0 結束(`quiet-run` 警告「未見測試摘要行」);改 `assert.ok(值 === null, 訊息)`(布林比對)後修前紅正常報 293 案.
- **A1–A4 變異之設計**: 44 項(`./tmp` 副本,`unit-diaglog-wire` 不列入——其靜態計數 `throw mkErr(`/`throw mkReadErr(` 會被任何改動擊殺而掩蓋行為測試之鑑別力);站點移除/改回舊寫法逐點(建構 5、`insert`、`save`、複製 4)、單一來源改壞(`getOptVal` 4 種、`cloneInput` 3 種、`emitError`/`mkReadErr` 登錄)、名稱改錯、過度擴大;另重跑既有規則二變異 24 項,唯 R-26(標籤讀取失敗改吞掉,其後 `chkReadable` 自行再讀而同樣判不可讀)為等價存活.
- **派工條款不適用本庫時,以「實測前提 + 偵測器」收尾,不補功能**(oro557a3): 條款「已關閉之實例收到不可讀之資料容器 → error 事件 `data` 為 `null`」依 w-orm-level、w-orm-lmdb 之 `procClosed` 擬定;本庫無 `close()`(實測 `Object.keys(wo)` 只有 `select`/`selectByPk`/`insert`/`insertBulk`/`save`/`del`/`delAll` 與事件發射器之 `_events`/`_eventsCount`),故 `src` 0 改動、不補 `close()`(補了即新增公開入口,逾出「上列以外之行為不變」).以 `unit-readable-align` A7 組(成員名全集 + `Symbol.dispose`/`asyncDispose` + 一案對照)釘住前提;偵測器之鑑別力以 5 項加入終態入口之變異(轉紅)與 2 項對照(未變異、加入非終態成員 `count` 仍綠)證明,故不用「恰為 7 個入口」之成員快照(那會把任何合法新增入口也判為紅,屬現狀指紋).
- **唯讀複審(sonnet)之處置**: 未給結論,回報 D1(複製之後讀取之外來值:原型 `id` 存取器、可列舉繼承存取器、巢狀 `Error` 值之 `message` 存取器〔`cloneDeep` 對 `Error` 以參照帶過〕仍轉出原文)、D2(只對字串鍵拋錯之 `get` 陷阱 Proxy 判為成員)、D3(`err.message` 不可讀者 `data` 亦為 `null`)——皆非回歸(新舊相同或條款解釋差異),已入帳本限制①⑤⑥並列需裁示,不擅自擴大條款範圍.
