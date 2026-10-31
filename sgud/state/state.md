# 現況(state)

本檔記 w-orm-lowdb 當前已開發功能之最新狀態(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本).只記現況、不寫過程,過程寫入 `sgud/exp/experience.md`;規則細節見 `sgud/rule/rulebook.md`.

- 套件版本: `package.json` 為 1.0.39(版號與發布由使用者統籌,agent 不改);依賴 `wsemi ^1.9.31`(診斷與遮罩共用實作自 1.9.31 起).
- 最近一次全套驗證: 2026-11-01(orm233,wsemi 1.9.36),`npm test`(quiet-run,`--lock`)**3849 passing / 210 pending / 0 failing**(較 3846 多出之 3 案為處置表每個 `na` 項動態生成之 `[靜態] … 不適用本套件`);前次 2026-10-29(mig-lowdb),`npm test`(quiet-run,`--lock`)**3846 passing / 210 pending / 0 failing**(測試本體約 19 秒);210 pending 為 `unit-wellformed` 之 GridFS 案(略過並以計數斷言).
- 語料 wire 案處置(2026-11-01,orm233): `unit-diaglog-wire` 之 `WIRE` 對 wsemi 1.9.36 語料 wire 案 23 個全數登錄(D 9、S 1、L 1、static 1、R 1、R-fs 1、na 9);新增之 A11(`genDiagFunLog` 之 `opt.safeKeys`)、C14(`getDiagBriefErr` 之 `types`,pg `DatabaseError` 形態)、U22(`getDiagSecrets` 之 `conns`)皆判不適用: `src/WOrmLowdb.mjs` 只引入 `getDiag`(:25)與 `getDiagSecrets`(:26),兩者不引入 `genDiagFunLog`;宣告為 `paths` 與 `safeKeys:['mode']`(:186-189),無 `codes`、`types`、`conns`.
- 測試目錄: `test/*.test.mjs` 皆為 `unit-` 前綴(以真實 JSON 檔驗證,無 HTTP/RPC 端點);共用 `test/lib/`(`mkObserver.mjs`、`leaves.mjs`、`procConcurrency.mjs`)與 `test/tools/`(`diagScenario.mjs`、`diagGolden.json`).

## 功能與狀態

| 功能 | 狀態 | 帳本條目 | 測試檔 |
|---|---|---|---|
| 基本操作(`select`、`selectByPk`、`insert`、`insertBulk`、`save`、`del`、`delAll`)、`returnList`、`autoGenPk`、`useCache`、`change`/`error` 事件、序列化佇列(同檔案路徑) | 已完成 | — | `unit-basic`、`unit-insert`、`unit-insertbulk`、`unit-save`、`unit-del`、`unit-delall`、`unit-selectbypk`、`unit-returnlist`、`unit-autogenpk`、`unit-cache`、`unit-event`、`unit-concurrency` |
| 條件(find)白名單與 Date 轉 ISO、範圍外 Date fail-closed | 已套(2026-10-17、10-19) | R-FIND-01、R-FIND-02 | `unit-find-whitelist` |
| 寫入數據之 Date 範圍檢核(0000–9999) | 已套(2026-10-19) | R-DATE-01 | `unit-date-write` |
| 寫入入口之前置處理移入 `try`(error 事件恰一次) | 已套(2026-10-20) | R-WRITE-ERR-01 | `unit-write-pre-error` |
| 字串良構(主鍵、寫入資料、`opt.url`/`db`/`cl`) | 已套(2026-10-20) | R-ORMSTR-01 | `unit-wellformed` |
| 主鍵存在性對照表改 `Map` | 已套(2026-10-21) | R-PKMAP-01 | `unit-protokey` |
| 診斷輸出與對外錯誤值之遮罩(wsemi 共用實作)、`opt.logDetail`/`opt.funLog` | 已套(2026-10-29,mig-lowdb;第 161 項,取代第 153 項之自製 `getDiag.mjs`) | R-DIAG-01(依 dspec〈診斷輸出與遮罩〉與 wsemi R-DIAG-01) | `unit-diaglog-wire`(接線 46 案)、`unit-diaglog-wo`(WOrmLowdb 整體 25 案) |

## 診斷輸出(R-DIAG-01)現況

- 實作在 wsemi(`getDiag`、`getDiagSecrets`、`diag.err/mask/brief/copy`),本套件 `src/` 僅 `WOrmLowdb.mjs` 一檔,只宣告與呼叫: `paths`(`opt.url` 原值、絕對路徑、normalize 後、steno 暫存檔)、`safeKeys: ['mode']`;診斷站點恰 2 處(`emitChange`、`emitError` 之 `catch`,即訂閱函數自行拋錯),皆 stdout.預設只輸出標籤與 `{ mode, errType, errCode? }`;`logDetail:true` 為 `console.log(標籤, 細節)`;`funLog(label, safe, detail)` 取代 console.
- 對外錯誤值: 外來值(lowdb/steno/fs 錯誤、資料觸發之拋錯)整批站點 7 處經 `procErr`(`diag.err`)、逐筆 `err` 2 處經 `procMsg`(`diag.mask`),只遮憑證(網址帳密、`password=` 類鍵值對、Bearer),**不遮儲存路徑**(Q3);套件固定詞彙之錯誤以 `mkErr` 登錄、原樣.站點全集表見帳本 R-DIAG-01.
- 儲存路徑於診斷輸出(細節)一律 `***`;建構函式錯誤訊息本為固定詞彙,不回顯 `opt.url`.
- 回傳契約以修改前(git HEAD)產生之 `test/tools/diagGolden.json` 對照(22 步 × 4 變體,含 reject 之錯誤名稱與型別、事件與結果交錯時序)完全相同;唯一例外為「拋出物件帶自有存取器」型,reject 改為 fail-closed 副本(`unit-write-pre-error` 已更新,README〈Breaking changes〉已載明).
- `src/` 不再靜態 import `util`(`toolg/gDistRollup.mjs` 不需列 `util`;以相同設定建到 tmp 實測可打包並實跑 UMD).
- 發布時之版本號與 README〈破壞性變更〉之「診斷輸出與錯誤值之遮罩」一條須由使用者統籌.

## 已知缺口與待辦

- 診斷輸出: 副本不沿用使用端原型(自訂 Error 子類別於 `util.inspect` 顯示為 `Error`、`name` 屬性保留;非 `Error` 之類別實例為普通物件),儲存路徑不遮於對外錯誤值(Q3),Node < 20.16 時 Proxy 不可偵測;其餘限制見 wsemi 規格 §5 與帳本 R-DIAG-01.
- find: 規則在 wsemi(`cvOrmFind`),其調整時本套件案例表測試為偵測器;資料庫檔內既有之範圍外 Date 字串仍有字典序風險(R-FIND-02 規則 5);shared 缺口(`cvOrmFind` 對 Proxy/null 原型物件之接受)已回報主控(R-FIND-01 已知限制⑤).
- 併發: 佇列為 module 層,跨行程併發不成立(README 已宣告).
