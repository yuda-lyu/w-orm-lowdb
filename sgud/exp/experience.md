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
