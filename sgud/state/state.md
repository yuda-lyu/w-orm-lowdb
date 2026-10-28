# 現況(state)

本檔記 w-orm-lowdb 當前已開發功能之最新狀態(各功能做到哪裡、對應之規則帳本條目與測試檔、已知缺口與待辦、最近一次驗證或發布之版本).只記現況、不寫過程,過程寫入 `sgud/exp/experience.md`;規則細節見 `sgud/rule/rulebook.md`.

- 套件版本: `package.json` 為 1.0.38(版號與發布由使用者統籌,agent 不改).
- 最近一次全套驗證: 2026-10-28(lowdb-run01),`npm test`(quiet-run,`--lock`)**3844 passing / 210 pending / 0 failing**(測試本體約 20 秒;基準 3775 + 本輪新增 69);210 pending 為 `unit-wellformed` 之 GridFS 案(略過並以計數斷言),非本輪新增.
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
| 診斷輸出單一出口、預設安全、`opt.logDetail`/`opt.funLog` | 已套(2026-10-28,lowdb-run01;第 153 項) | R-DIAG-01 | `unit-diaglog`(getDiag 純函數 44 案)、`unit-diaglog-wo`(WOrmLowdb 整體 25 案) |

## 診斷輸出(R-DIAG-01)現況

- `src/getDiag.mjs` 為唯一可寫 console 之處;`src/WOrmLowdb.mjs` 之 `diag` 呼叫恰 2 處(`emitChange`、`emitError` 之 `catch`,即訂閱函數自行拋錯).預設只輸出標籤與 `{ mode, errType, errCode? }`;`logDetail:true` 還原 `console.log(拋出之值)`;`funLog(label, safe, detail)` 取代 console.
- `opt.url`(資料庫檔案路徑,本套件之連線字串)原值與其絕對路徑於三管道之細節一律 `***`.建構函式錯誤訊息本為固定詞彙,不回顯 `opt.url`.
- 回傳契約以修改前(git HEAD)產生之 `test/tools/diagGolden.json` 對照(22 步 × 4 變體,含 reject 之錯誤名稱與型別、事件與結果交錯時序)完全相同.
- 錯誤摘要之 `errCode` 只取自 `Error`、僅字串系統代碼(整數與一般物件之 `code` 不取);細節拷貝不觸發 Proxy trap、不執行 getter,2000 節點上限附 `[Truncated]` 標記.
- `getDiag.mjs` 使用 `util.types`(同 w-serv-orm);`toolg/gDistRollup.mjs` 未列 `util`,建置僅警告 `output.globals`,待主控裁示是否補.
- 發布時之版本號與 README〈破壞性變更〉之「診斷輸出」一條須由使用者統籌(輸出變動、回傳不變).

## 已知缺口與待辦

- 診斷輸出: 非 `Error` 之類別實例在 `logDetail`/`funLog` 細節中複製為普通物件、原型為 `null` 之錯誤複製為一般 `Error`(不標示 `null prototype`),與舊版 `console.log(值)` 文字不同(文件化,見 R-DIAG-01 已知限制);路徑大小寫其餘部分之改寫與 8.3 短檔名不在遮罩範圍.
- find: 規則在 wsemi(`cvOrmFind`),其調整時本套件案例表測試為偵測器;資料庫檔內既有之範圍外 Date 字串仍有字典序風險(R-FIND-02 規則 5);shared 缺口(`cvOrmFind` 對 Proxy/null 原型物件之接受)已回報主控(R-FIND-01 已知限制⑤).
- 併發: 佇列為 module 層,跨行程併發不成立(README 已宣告).
