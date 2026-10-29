# w-orm-lowdb
An operator for lowdb in nodejs.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-orm-lowdb.svg?style=flat)](https://npmjs.org/package/w-orm-lowdb
[![license](https://img.shields.io/npm/l/w-orm-lowdb.svg?style=flat)](https://npmjs.org/package/w-orm-lowdb
[![npm download](https://img.shields.io/npm/dt/w-orm-lowdb.svg)](https://npmjs.org/package/w-orm-lowdb
[![npm download](https://img.shields.io/npm/dm/w-orm-lowdb.svg)](https://npmjs.org/package/w-orm-lowdb
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-orm-lowdb.svg)](https://www.jsdelivr.com/package/npm/w-orm-lowdb

## Keypoint

本套件之寫入為「整檔讀出、記憶體修改、整檔寫回」，lowdb 本身無條件寫入亦無檔案鎖，故原子性須由套件自行提供，其適用範圍如下。

### 跨行程併發不成立

已確認跨行程併發不成立，因序列化佇列為 module 層之變數，僅同一行程內共享；不同行程各持一份而完全不互斥，lowdb 亦未使用任何檔案鎖。**多個行程操作同一資料庫檔案時，請自行確保同時只有一個寫入者。**

失效之具體後果有二，兩者皆已實機重現：

1. **整批遺失（lost update）**：兩行程各自持有寫入前之整檔快照，後寫者將自己的快照整檔覆蓋回去，前寫者於其間所寫入之數據**整筆消失**，非個別欄位失準。
2. **寫檔拋錯而整批 reject**：lowdb 之寫檔委由 steno，其暫存檔名由資料庫檔名推導（`db.json` 對應 `.db.json.tmp`），故兩行程**共用同一個暫存檔**；一方完成 rename 後，另一方之 rename 即因來源已不存在而拋 `ENOENT`，該次操作整批 reject。

實測依據（Windows 11、Node v24.19.0、lowdb 7、steno 4.0.2）：兩個獨立行程對同一檔案各循序 `insert` 200 筆（共 400 筆），以同一時間點起跑，連續 3 輪皆有一方以 `ENOENT: no such file or directory, rename '....db.json.tmp' -> '...db.json'` 中止，最終資料表分別為 200、200、281 筆（遺失 200、200、119 筆），發生率 3/3。

**建議之迴避方式**：

- 單一寫入者：由單一行程負責全部寫入，其餘行程僅讀取。
- 呼叫端自備跨行程鎖，包覆每一次寫入呼叫。
- 確需多行程寫入者，改用具備跨行程原子性之後端，如 w-orm-mongodb 或 w-orm-postgresql。

### 快取

`opt.useCache` 開啟時，`select` 與 `selectByPk` 之快取為行程內狀態：本行程之寫入會重設快取，他行程之寫入則不會，故縱使僅由他行程寫入亦可能讀到過期數據。該選項預設關閉，僅適用於單程序操作。

### 條件(find)白名單 (Condition whitelist)

`select` 與 `delAll` 共用同一個 `find` 條件與同一道檢核，於呼叫入口執行(任何讀取之前，不占用序列化佇列)。檢核為 `wsemi` 之 `cvOrmFind`(w-orm 系列共用)，其後查詢與刪除只使用檢核所回傳之複本，不再讀取呼叫端傳入之物件。條件不在白名單內者整批 reject，訊息為 `invalid find: <原因> at [<路徑>]`，於 reject 之前發出一次 `error` 事件，不讀取資料庫檔案、不刪除任何數據，亦不發出 `change` 事件。

接受：

- 未給、`undefined`、`{}`：全部數據。`delAll()` 不給條件即刪除全部，須審慎使用、非必要不用；可先以 `select(find)` 確認 `delAll(find)` 之命中範圍(`useCache` 開啟且他行程已寫入時，`select` 可能回傳快取而與 `delAll` 直讀資料庫所見不同)。
- 欄位等值 `{ 欄: 純量 }`，多欄為 AND。純量為字串(不含 NUL 字元與孤立代理字元)、有限數字、布林、有效 `Date`(年份須介於 0000–9999，範圍外 reject，見下方 Date 節)；`null` 僅可用於欄位等值、`$eq`、`$ne`。
- 欄位運算子 `$eq $ne $gt $gte $lt $lte`(值為純量)與 `$in $nin`(值為純量陣列；`$in: []` 恆假、不命中任何數據，`$nin: []` reject)。同欄多個運算子為 AND。
- 文件層 `$and`、`$or`：值為條件物件之非空陣列，可巢狀。
- 欄名須符合 `^[\p{L}_][\p{L}\p{M}\p{N}_]*$`，長度不超過 128，且不為 `__proto__`；`'o.k'` 之點路徑不是欄名。
- 上限：巢狀深度 32、`$and`/`$or` 項數 1000、`$in`/`$nin` 項數 10000、節點總數 100000。

整批 reject：非條件物件之值(`null`、陣列、字串、數值、布林、函數、`Date`、`RegExp`、`Map`、`Set`、類別實例等)；白名單外之運算子(`$not $nor $regex $options $exists $where $expr $type $mod $elemMatch $size $all` 等)；欄位層 `$and/$or`；`undefined`、`NaN`、`Infinity`、無效 `Date`、年份小於 0 或大於 9999 之 `Date`(如 `new Date(8.64e15)`)、`BigInt`、函數、`Symbol`、`RegExp` 之值；陣列值或巢狀物件之等值；`$nin: []`、`$and: []`、`$or: []`、`$and`/`$or` 內之 `{}`、`{ 欄: {} }`；`$gt $gte $lt $lte $in $nin` 內之 `null`；Symbol 鍵、存取器、不可列舉鍵、稀疏陣列。

Date：本套件以 JSON 存檔，Date 存入後為 ISO 字串(`toISOString()`)；條件內之 Date 於入口檢核之後、查詢之前轉為同一格式之 ISO 字串(只轉換檢核所回傳之複本，不改動呼叫端之物件)，故 `{ d: new Date(...) }`、`$gte`、`$in` 等皆可命中。注意 Date 條件等同於其 ISO 字串條件，以字串字典序比較：① 與字串型欄位亦會比較(`{ d: { $lt: new Date(...) } }` 可能命中 `d` 為字典序較小之字串的數據)，欄位混放 Date 與字串時請勿用 Date 條件刪除；② 字典序僅在 Date 介於西元 0000–9999 年時等於時間序(此範圍內 `toISOString()` 恆為 24 字元 `YYYY-MM-DDTHH:mm:ss.sssZ`；範圍外輸出 `+yyyyyy-`、`-yyyyyy-` 前綴，字典序與時間序顛倒)。

- **條件側 fail-closed**：條件內任何位置(欄位等值、`$eq $ne $gt $gte $lt $lte`、`$in $nin` 之元素、`$and`/`$or` 內)之 `Date` 年份小於 0 或大於 9999(如 `new Date(8.64e15)`、`new Date(-8.64e15)`、`-000001` 年、`+010000` 年)，`select` 與 `delAll` 皆整批 reject，訊息為 `invalid find: Date year is out of range 0000-9999 at [<路徑>]`(不回顯值)，於讀檔之前 reject，不讀檔、不刪除、不改寫資料庫檔、不發出 `change` 事件。邊界 `0000-01-01T00:00:00.000Z` 與 `9999-12-31T23:59:59.999Z` 接受。此檢核屬本套件轉譯層(共用檢核 `cvOrmFind` 接受一切有效 `Date`)。例如修正前 `delAll({ t: { $gt: new Date(8.64e15) } })`(意為「晚於最大日期」，應無命中)會因字典序顛倒而刪除所有帶日期之數據，現改為 reject。
- **數據側**：寫入(`insert`、`insertBulk`、`save`)範圍外 `Date` 自 1.0.34 起整批 reject，見下節「寫入數據之 Date」。**資料庫檔內既有之範圍外 `Date` 字串(舊版存入者)仍無法以 `Date` 條件正確比較**：例如舊版以 `new Date(8.64e15)` 作「永不過期」哨兵存入之 `'+275760-…'`，範圍內之條件 `{ expireAt: { $lt: 現在 } }` 仍會因字典序命中哨兵(`'+275760-…' < '2026-…'`)，`delAll` 會將其刪除。此限制是雙向的：既可能誤命中(上例)，亦可能漏命中(例如 `{ t: { $gt: new Date('9999-12-31T23:59:59.999Z') } }` 不會命中 `'+275760-…'` 之資料)，範圍外資料彼此間的順序亦不可靠。請自行清理或改寫既有資料，清理方式見下節。

### 寫入數據之 Date (Date in written data)

自 1.0.34 起，`insert`、`insertBulk`、`save`(含自動插入、更新既有與合併)於寫入前檢核數據內**任何深度**(頂層欄位、巢狀物件、陣列內)之 `Date`：年份須介於 0000–9999(此範圍內序列化後恆為 24 字元 `YYYY-MM-DDTHH:mm:ss.sssZ`，字典序等於時間序)。年份小於 0 或大於 9999 者(如 `new Date(8.64e15)`、`new Date(-8.64e15)`、`-000001` 年、`+010000` 年)整批 reject(fail-closed，與條件側一致)：

- 訊息為 `invalid data: Date year is out of range 0000-9999 at [<路徑>]`，路徑形如 `data[0].expireAt`、`data[2].list[1].t`(輸入為單一物件時視為長度 1 之陣列；物件之鍵非一般識別字者以 `["a.b"]` 表示)，不回顯值。於 reject 之前發出一次 `error` 事件，不發出 `change` 事件。
- 整批中任一筆含範圍外 `Date` 即整批 reject，不讀檔、不寫檔，資料庫檔不變。`save` 即使因 `autoInsert: false` 而主鍵不存在(不會寫入)亦先經同一檢核。`autoGenPk: false` 而缺主鍵者仍先以缺主鍵訊息 reject。
- 邊界 `0000-01-01T00:00:00.000Z` 與 `9999-12-31T23:59:59.999Z` 接受。無效 `Date`(`Invalid Date`)處置不變，序列化為 `null` 存入。
- 只檢核 `Date` 物件，以 `JSON.stringify`(即實際寫入之序列化)之結果判定：已是字串者(如讀出後再存回之 `'+275760-09-13T00:00:00.000Z'`)、`Map`/`Set` 內之 `Date`(序列化為 `{}`)、非 `Date` 之 `toJSON` 物件(含 `Buffer`)之輸出皆不檢核；`TypedArray`、`DataView` 的自有屬性照常序列化，其內之 `Date` 會檢核。刻意構造之物件(自訂 `toJSON` 回傳含 `Date` 之物件、依屬性鍵或狀態回傳不同值之 `toJSON`、`Proxy` 包裝之 `Date`、`cloneDeep` 不複製之物件)不在檢核範圍。
- 原因：範圍外 `Date` 存為 `+yyyyyy-…`、`-yyyyyy-…` 字串後，字典序與時間序顛倒。例如以 `new Date(8.64e15)` 作「永不過期」哨兵，`delAll({ t: { $lt: new Date() } })` 會因字典序把它當成過去而刪除。「永不過期」請改用 `null`，或範圍內之 `new Date('9999-12-31T23:59:59.999Z')`(此二者不會被 `{ t: { $lt: 現在 } }` 命中，但仍會被 `$ne`、`$nin` 命中，依條件自行斟酌)。

**既有資料不遷移、不改讀取**：1.0.34 起寫入拒收，但資料庫檔內已存在之範圍外 `Date` 字串仍有字典序風險，請自行清理或改寫。例如 `let rows = (await wo.select()).filter((v) => /^[+-]\d{6}-/.test(v.t))` 找出欄位 `t` 為範圍外字串者(巢狀欄位同理自行走訪)，再 `for (let v of rows) { await wo.save({ id: v.id, t: null }) }` 或以範圍內之值覆寫。

語意為 MongoDB 式：`{ f: null }` 命中 `f` 為 `null` 或缺欄之數據，`$ne: x`(x 非 `null`)與 `$nin` 亦命中欄位為 `null` 或缺欄之數據，`$ne: null` 則排除之。欄名同於 `Object.prototype` 成員者(`constructor`、`toString`、`hasOwnProperty` 等)，數據無此自有欄位時視為缺欄。欄位值為陣列時，純量與 `$in` 條件仍以元素比對(`{ tags: 'x' }` 命中 `tags: ['x', 'y']`)。欲在 `w-orm-*` 各後端得到相同結果，請明確寫出：排除 null/缺欄用 `{ $and: [{ f: { $ne: null } }, { f: { $ne: x } }] }`，含 null/缺欄用 `{ $or: [{ f: null }, { f: { $ne: x } }] }`。

### 字串良構 (Well-formed strings)

JavaScript 字串可含孤立代理字元(lone surrogate，即成對代理被拆開後只剩一半，如 `'a\uD800'`，`isWellFormed()` 為 `false`)。lowdb 以 JSON 檔存放，孤立代理字元可保真(寫入以 `\ud800` 轉義，讀回仍為孤立代理)，本身不會造成主鍵相撞；但 w-orm 系列其他後端(UTF-8、BSON 儲存)會把它改寫為 U+FFFD，使不同主鍵寫成同一鍵、文件內相異鍵名撞鍵、寫入值與讀回值不同。為使同一應用更換後端時資料行為一致，系列規則為一律拒收，本套件亦同，於任何讀取與寫入之前檢核，檢核為 `wsemi` 之 `chkOrmStr`、`chkOrmData`(w-orm 系列共用)：

- **主鍵 `id`**：不得含孤立代理字元，亦不得含 NUL 字元(U+0000)，與 `find` 同標準；不隨 `autoGenPk` 改變。
- **寫入資料**(`insert`、`insertBulk`、`save`)：任何字串值與鍵名(含巢狀物件、陣列元素、`Map`/`Set` 項目、`Error`/`RegExp` 之文字)不得含孤立代理字元；值與鍵名內之 NUL 不在此規則拒收範圍。
- **`opt.url`、`opt.db`、`opt.cl`**：含孤立代理字元者建構時 throw `invalid opt.<名>: string contains lone surrogate`，不建立任何檔案。
- U+FFFD 本身與成對代理(emoji、CJK 擴充 B 區以後之罕用字)為良構，照常接受。

拒收之處置與既有「無效主鍵」同形，訊息為固定詞彙、不回顯值：

| 呼叫 | 結果 |
|---|---|
| `insert`、`insertBulk` | 整批 reject，不寫入任何一筆；於 reject 之前發出一次 `error` 事件 |
| `save`、`del` | 該筆 `ok: 0` 附 `err`，同批其他筆照常處理 |
| `selectByPk` | 回傳 `null`(不 reject、不發事件) |
| `select`、`delAll` | 不變：`invalid find: <原因> at [<路徑>]` |

訊息為 `invalid id: <原因> at [data[<k>].id]` 與 `invalid data: <原因> at [data[<k>].<路徑>]`(`<k>` 為批次索引，單一物件呼叫為 `data[0]`；不合格之鍵名以 `<invalid key>` 表示)，`<原因>` 為 `string contains lone surrogate`、`string contains NUL`(僅主鍵)、`not a string` 或 `string is empty`(`del` 之 `id` 未給、非字串或空字串；取代原本回顯值之 `can not delete by invalid id[...]`)。同批以索引最小之不合格筆為準，同一筆內主鍵先於資料；與 Date 範圍檢核並存時，Date 範圍檢核先於良構檢核。

**既有資料不遷移、不改讀取**：本規則實施前以孤立代理字元為主鍵寫入者，因本套件保真而仍留在檔案內，`select` 仍讀得到。檢出：`(await wo.select()).filter((r) => typeof r.id === 'string' && !r.id.isWellFormed())`。因孤立 `id` 本身已不可作為 `del`、`selectByPk` 之參數(被拒)，清除須依該列之其他欄位 `delAll({ 欄: 值 })`，或 `delAll()` 清空整表，或直接改檔；若該列只有 `id` 欄，則僅能 `delAll()` 或改檔。已存入之值內孤立代理字元仍保真，對該列未含該欄之 `save` 更新照常成功(只檢核本次寫入之內容，不連坐檢核既有內容)。**主鍵含 NUL 之舊列**(原可保真存入)亦不再可由主鍵定址(`selectByPk` 回 `null`、`del` 該筆 `ok: 0`)；其 `id` 為良構故上述 `isWellFormed` 檢出法不涵蓋，可改以 `r.id.includes('\u0000')` 檢出，清除同樣須依其他欄位 `delAll({ 欄: 值 })`、`delAll()` 或改檔。

已知限制：`String` 包裝物件(`new String('...')`)僅檢核其字串值、不解包；`toJSON` 或自訂序列化之輸出不檢核。

### 診斷輸出與錯誤值之遮罩：`opt.logDetail` 與 `opt.funLog` (Diagnostic output)

遮罩與診斷輸出之實作為 **wsemi 之共用函數**(`getDiag`、`getDiagSecrets`、`maskDiagText`、`maskDiagCopy`、`maskDiagErr`、`getDiagBriefErr`)，本套件只宣告「秘密來源(資料庫檔案位置)、`safeKeys` 與呼叫點」，不自行實作遮罩。選項語意、摘要規則、細節拷貝之形態處置與上限、已知限制，以 wsemi 之 `getDiag` 等函數之 JSDoc 與其規則帳本為準，本節只述本套件之接線。

本套件唯一會寫 console 之情形，是 `change` 或 `error` 事件之**訂閱函數自行拋錯**(拋錯不影響該次操作之結果，只輸出一則診斷；兩站皆輸出至 stdout，即 `console.log`)。服務之 console 常被日誌系統收集，而訂閱函數拋出之錯誤常夾帶它剛處理的資料(主鍵、使用者識別、欄位值)與堆疊，故預設只輸出固定標籤與不含個資之摘要：

| 項目 | 預設 | 說明 |
|---|---|---|
| 訂閱函數拋錯時 | `change handler threw { mode: 'insert', errType: 'Error' }` 或 `error handler threw { mode: 'select', errType: 'Error' }` | 摘要只含操作別(`mode`)、錯誤類別名稱(`errType`，僅內建錯誤類別名〔`Error`、`TypeError`、`RangeError`、`SyntaxError`、`ReferenceError`、`EvalError`、`URIError`、`AggregateError`〕照列，自訂類別名一律列 `Error`；拋出之值非錯誤者為 `string`、`object`、`null` 等型別，`Proxy` 為 `Proxy`)與機器代碼(`errCode`，只取自 `Error` 之自有屬性 `code`，且限系統錯誤名〔`ENOENT`、`EACCES`、`EAI_AGAIN`、`E2BIG` 等〕與 Node 內部代碼之明確集合；整數、`E` 後接數字者〔如 `E123456789`〕、不在集合內之字串、一般物件之 `code` 一律不列，有才列)；**不含**資料值、`id`、訊息文字與堆疊 |
| `opt.logDetail` | `false` | 須為 `true` 才生效，其餘值忽略。`true` 時改為 `console.log(標籤, 細節)`，細節為訂閱函數拋出之值的**遮罩拷貝**(見下)。可能含資料值與 `id`，**僅供除錯** |
| `opt.funLog` | 無 | 函數 `(label, safe, detail)`，須為函數才生效，其餘值忽略。給予時診斷輸出**只**交給它、不寫 console：`label` 為固定標籤，`safe` 為上述摘要，`detail` 為完整細節(訂閱函數拋出之值之**遮罩拷貝**)，可由使用端遮罩後轉送至自己的日誌。`funLog` 拋錯，或回傳 reject 之 promise，皆不影響操作 |

**資料庫檔案位置於診斷輸出一律遮罩**：本套件無帳號與密碼，`opt.url`(資料庫檔案路徑)即連線字串，以 `paths` 向 wsemi 宣告。`opt.url` 之原值、其絕對路徑、`path.normalize` 後之相對路徑、lowdb 底層寫檔所用之暫存檔路徑(`<目錄>/.<檔名>.tmp`，寫檔失敗之系統錯誤訊息會帶它)，及其斜線與反斜線互換、磁碟機代號大小寫互換、UNC 命名空間、JSON 跳脫、`encodeURI`(`file:///` 網址之路徑段)、`encodeURIComponent` 之形式，出現在 `logDetail` 之輸出或 `funLog` 之 `detail`(含字串值、屬性鍵、Symbol 描述與值、巢狀物件、陣列之附加屬性、`cause`、包裝物件)時，皆以 `***` 取代(`file:///` 等前綴不屬路徑而保留)。路徑大小寫其餘部分之改寫、`8.3` 短檔名不在遮罩範圍。建構函式之錯誤訊息(`invalid opt.url: string contains lone surrogate` 等)本為固定詞彙，不回顯 `opt.url`。

**對外之錯誤值(reject、`error` 事件之訊息、`save` 與 `del` 逐筆之 `err`)只遮憑證，不遮儲存路徑**：外來值(lowdb 與檔案系統之錯誤，或你的資料觸發之拋錯，如損毀之資料庫檔之 JSON 剖析錯誤帶出檔案內容片段)其內之憑證——`scheme://帳密@網址`、`password=`、`token=`、`"password":` 一類憑證鍵值對、`Bearer` 權杖——以 `***` 取代。無須遮罩者 reject 之錯誤物件**身分不變**；含憑證者 reject 同類別之副本(`instanceof` 與 `code` 等自有屬性同，訊息與 `stack` 已遮罩，不改動你的原物件)。儲存路徑不屬憑證，故檔案系統錯誤之 `err.path` 與訊息中的路徑照舊完整(需要時請由你自己的日誌策略處理)。套件自身以固定詞彙組成之錯誤(`invalid data: <原因> at [<路徑>]`、`can not insertBulk by existed id[<主鍵>]`、`invalid find: …` 等)**原樣、不經遮罩**。

`detail` 為遮罩拷貝，不執行你的程式(不呼叫 getter 與自訂 `inspect`，不觸發 `Proxy` 的 trap)，大小有界(深度、節點數上限，超過者以 `'[Truncated]'` 標記)，副本不沿用你的原型：自訂 `Error` 子類別之副本其 `name` 屬性保留類別名，但 `util.inspect` 顯示為 `Error`；非 `Error` 之類別實例成為普通物件；函數、`Proxy`、二進位資料、`Promise` 等以標記字串代替。形態處置之完整規則與已知限制(私有欄位無法複製、`Error.prepareStackTrace` 之使用端 hook、短於 4 字元之憑證於對外錯誤值不遮、Node 低於 20.16 時 `Proxy` 不可偵測等)見 wsemi 之 `maskDiagCopy`、`maskDiagErr` 與 `getDiag` 之 JSDoc。

```alias
// 預設：console 只有標籤與摘要
let w = WOrmLowdb({ url: './db.json' })
w.on('change', () => { throw new Error('handler failed for user a@b.c') })
// console: change handler threw { mode: 'insert', errType: 'Error' }

// 除錯：console.log(標籤, 細節)，細節含 Error: handler failed for user a@b.c 與堆疊，資料庫檔案位置仍遮罩
let wd = WOrmLowdb({ url: './db.json', logDetail: true })

// 轉送至自己的日誌：細節請於送出前自行遮罩
let wf = WOrmLowdb({
    url: './db.json',
    funLog: (label, safe, detail) => {
        logger.info({ label, safe }) // safe 不含個資
        // detail 含完整原文，送出前請自行遮罩
    },
})
```

不在範圍：底層 `lowdb`、`mingo` 不自行輸出日誌；Node 本身之警告(如 `MaxListenersExceededWarning`)不經本出口。摘要之 `errType` 僅列內建錯誤類別名、`errCode` 僅列明確集合內之系統代碼，皆不是資料。

### 破壞性變更 (Breaking changes)

原本被接受或被靜默放行之條件，現改為 reject，不設過渡期。

- 移除：白名單以外之全部 `mingo` 運算子(`$not $nor $regex $options $exists $type $mod $elemMatch $size $all $expr $where $bitsAllSet` 等)；`RegExp` 值(`{ name: /x/i }`、`$in: [/x/]`)；陣列字面值之等值、巢狀物件等值(`{ tags: ['x', 'y'] }`、`{ o: { k: 1 } }`)與 `$elemMatch`、`$all`、`$size`(欄位值為陣列時，純量與 `$in` 條件之元素比對語意仍保留)；點路徑(`{ 'o.k': 1 }`)。需要時請 `select()` 後於記憶體過濾。
- 改為 reject(原本靜默放行)：不是條件物件之 `find`(`null`、`[]`、`'x'`、`123`、`true`、函數、`Date`、`Map`、`Set`、僅含 Symbol 鍵之物件、條件在原型上之物件)，原本 `select(find)` 回傳全部數據、`delAll(find)` 刪除全部數據(帶自有鍵之類別實例原本即由 `mingo` 拒收，訊息為 `query criteria must be an object`，現統一為 `invalid find`)；`undefined` 值(`{ age: undefined }`、`$eq: undefined` 原本命中欄位為 null 或缺欄之數據，`$in: [undefined]` 原本無命中，稀疏陣列之洞原被當缺欄)；`NaN`、`Infinity`、函數、`Symbol` 之值；`$nin: []`、`$and: []`、`$or: []`、`$and: [{}]`、`$or: [{}]`、`{ age: {} }`；不合文法之欄名、存取器與不可列舉鍵；巢狀深度超過 32、`$in` 超過 10000 項。
- 新行為：條件內之 Date 可命中(原本因數據為 ISO 字串而條件為 Date，`$eq`、`$gt`、`$gte`、`$lt`、`$lte`、`$in` 恆不命中，`$ne`、`$nin` 恆命中，`delAll` 因而可能刪除全部)；Date 範圍比較之限制見上。
- 改為 reject(Date 範圍)：條件內任何位置之 `Date` 年份小於 0 或大於 9999(如 `new Date(8.64e15)`)，原本轉為帶正負號之 ISO 字串後以字典序比較，結果與時間序顛倒(`$gt` 哨兵命中所有帶日期之數據、`$lt` 哨兵恆無命中)，現整批 reject；數據側見下一條。
- 改為 reject(寫入 Date 範圍，1.0.34 起)：`insert`、`insertBulk`、`save` 寫入之數據內任何深度之 `Date` 年份小於 0 或大於 9999(如以 `new Date(8.64e15)` 作「永不過期」哨兵)，原本照存為 `+yyyyyy-…`、`-yyyyyy-…` 字串(其後會被 `{ t: { $lt: 現在 } }` 因字典序命中而遭 `delAll` 刪除)，現整批 reject，訊息為 `invalid data: Date year is out of range 0000-9999 at [<路徑>]`；請改用 `null` 或 `new Date('9999-12-31T23:59:59.999Z')`。既有資料不遷移，仍有字典序風險，請自行清理或改寫(見上方「寫入數據之 Date」)。
- 錯誤訊息為 `invalid find: <原因> at [<路徑>]`；原本由 `mingo` 拋出錯誤者，現統一為此訊息。
- 改為 reject(字串良構)：主鍵含孤立代理字元或 NUL；寫入資料之字串值或鍵名含孤立代理字元；`opt.url`、`opt.db`、`opt.cl` 含孤立代理字元(建構時 throw)。原本 lowdb 以 JSON 保真而照存，現為系列一致而拒收，見上節「字串良構」。`del` 未給有效 `id` 之 `err` 由 `can not delete by invalid id[<值>]` 改為 `invalid id: <原因> at [data[<k>].id]`(不回顯值)。
- 變更(診斷輸出)：`change` 或 `error` 事件之訂閱函數拋錯時，console 輸出由原本的 `console.log(拋出之值)`(整個錯誤含訊息與堆疊，可能夾帶資料值與 `id`)改為 `change handler threw { mode, errType }`(`error handler threw` 同)。**要看原文：加 `logDetail: true`(輸出為遮罩拷貝，`Error` 與純值之文字與舊版相同；資料庫檔案位置以 `***` 取代，限制見上節)，或由 `funLog` 取得。** 只有輸出變動，各操作之 resolve/reject 內容、`change` 與 `error` 事件之參數及發出時機皆不變。新增選項 `opt.logDetail`、`opt.funLog`，見上節「診斷輸出」。(其中 `logDetail` 之輸出格式已由下一條改變。)
- 變更(診斷輸出與錯誤值之遮罩改用 wsemi 共用實作，不保留舊行為、不設別名)：本套件不再自行實作遮罩與診斷輸出(刪除 `src/getDiag.mjs`，其為內部模組、未對外匯出；若你曾直接引用 `w-orm-lowdb/src/getDiag.mjs` 將失效)，改用 wsemi 之 `getDiag` 等函數。對外可觀察之變化：
  1. `opt.logDetail: true` 之輸出由「只輸出細節、不加標籤」(同舊版 `console.log(拋出之值)`)改為 `console.log(標籤, 細節)`，如 `change handler threw Error: …`；細節為遮罩拷貝，自訂 `Error` 子類別於 `util.inspect` 顯示為 `Error`(類別名保留於副本之 `name` 屬性)。
  2. 預設摘要：`errType` 只列內建錯誤類別名，使用端自訂之類別名一律列 `Error`(原本列出符合識別字樣式之類別名)；`errCode` 只列系統錯誤名與 Node 內部代碼之明確集合，原本以樣式放行之字串(`E` 後接大寫英文字母者，不在集合內)不再列。
  3. 對外之錯誤值：外來值內之憑證(`scheme://帳密@網址`、`password=`、`token=` 一類鍵值對、`Bearer` 權杖)原本原樣交出，現以 `***` 取代，含憑證者 reject 之錯誤物件為同類別之副本(身分與你拋出者不同；無憑證者身分不變)；套件自身以固定詞彙組成之錯誤原樣。`save`、`del` 逐筆 `err` 與 `error` 事件之訊息同。儲存路徑不遮(仍完整)。無法在不執行你的程式下檢查者亦視為需處理(fail-closed)：拋出之物件帶自有存取器屬性時，reject 其副本(存取器以 `'[Getter/Setter]'` 取代、getter 不被執行；例：資料觸發 `{ get message() { throw … } }` 之拋出，原本 reject 該物件本身且 `error` 事件之訊息為 `unknown error`，現 reject `{ message: '[Getter/Setter]' }`，事件之訊息為 `[Getter/Setter]`)，可偵測之 `Proxy` 為 `new Error('***')`。
  4. Node 低於 20.16 時 `Proxy` 不可偵測(原本以靜態 `import 'util'` 偵測)，細節拷貝於該環境可能觸發 `Proxy` 之 trap；其餘行為不變。
  各操作之 resolve/reject 成敗、事件參數與發出時機不變。
- 修正(主鍵為 `Object.prototype` 成員名)：主鍵為 `constructor`、`toString`、`valueOf`、`hasOwnProperty`、`__proto__` 等時，原本 `insert` 回 `{ n: 1, nInserted: 0, ok: 1 }` 而靜默不寫入，`insertBulk` 誤報 `can not insertBulk by existed id[...]`，以 `__proto__` 為主鍵之紀錄其欄位名(及 `k`、`v`)還會被誤認為其他主鍵(同批之後筆被判已存在、`del` 誤報已刪)；現主鍵存在與否以 `Map` 判定，與一般字串主鍵行為相同。

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-orm-lowdbOrm.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-orm-lowdb
```

#### Example
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-lowdblob/master/g-basic.mjs)]
```alias
import WOrm from './src/WOrmLowdb.mjs'
//import WOrm from './dist/w-orm-lowdb.umd.js'
// import w from 'wsemi'

// w.fsDeleteFile('./db.json')

let opt = {
    url: './db.json',
    db: 'worm',
    cl: 'users',
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

let rsa = [
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 654.321,
    },
]

async function test() {

    //wo
    let wo = WOrm(opt)

    //on
    wo.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    wo.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })

    //delAll
    await wo.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })

    //insert
    await wo.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })

    //insert by returnList, 回傳與輸入等長保序之逐筆結果, nInserted為1即該筆為新增
    await wo.insert([{ id: 'id-peter' }, { id: 'id-new' }], { returnList: true })
        .then(function(msg) {
            console.log('insert(returnList) then', msg)
        })
        .catch(function(msg) {
            console.log('insert(returnList) catch', msg)
        })

    //insertBulk, 全有全無, 任一筆主鍵已存在即整批reject且不寫入任何一筆
    await wo.insertBulk([{ id: 'id-bulk1' }, { id: 'id-bulk2' }])
        .then(function(msg) {
            console.log('insertBulk then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk catch', msg.toString())
        })

    //insertBulk by existed id
    await wo.insertBulk([{ id: 'id-bulk3' }, { id: 'id-peter' }])
        .then(function(msg) {
            console.log('insertBulk(existed) then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk(existed) catch', msg.toString())
        })

    //save
    await wo.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })

    //selectByPk
    let sp = await wo.selectByPk('id-rosemary')
    console.log('selectByPk', sp)

    //selectByPk by non-existed id
    let spn = await wo.selectByPk('id-non-existed')
    console.log('selectByPk(non-existed)', spn)

    //del by id-new, id-bulk1, id-bulk2
    await wo.del([{ id: 'id-new' }, { id: 'id-bulk1' }, { id: 'id-bulk2' }])
        .then(function(msg) {
            console.log('del(clean) then', msg)
        })
        .catch(function(msg) {
            console.log('del(clean) catch', msg)
        })

    //select all
    let ss = await wo.select()
    console.log('select all', ss)

    //select
    let so = await wo.select({ id: 'id-rosemary' })
    console.log('select', so)

    //select by $and, $gt, $lt
    let spa = await wo.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)

    //select by $or, $gte, $lte
    let spb = await wo.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    console.log('select by $or, $gte, $lte', spb)

    //select by $or, $and, $ne, $in, $nin
    let spc = await wo.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
    console.log('select by $or, $and, $ne, $in, $nin', spc)

    // //select by regex //系列條件白名單不支援$regex(含$options), 會整批reject(invalid find: unsupported operator), 須改為select後自行過濾
    // let sr = await wo.select({ name: { $regex: 'PeT', $options: '$i' } })
    // console.log('selectReg', sr)

    //save
    await wo.save(rsa, { autoInsert: true })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })

    //del
    let d = ss.filter(function(v) {
        return v.name === 'kettle'
    })
    await wo.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })

    //del by invalid id, 未帶有效主鍵者為該筆ok為0並附err, 整批仍resolve
    await wo.del([{ name: 'no-id' }])
        .then(function(msg) {
            console.log('del(invalid id) then', msg)
        })
        .catch(function(msg) {
            console.log('del(invalid id) catch', msg)
        })

    //delAll by find
    await wo.delAll({ value: { '$gte': 600 } })
        .then(function(msg) {
            console.log('delAll(find) then', msg)
        })
        .catch(function(msg) {
            console.log('delAll(find) catch', msg)
        })

}
test()
// change delAll
// delAll then { n: 2, nDeleted: 2, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change insert
// insert(returnList) then [ { n: 1, nInserted: 0, ok: 1 }, { n: 1, nInserted: 1, ok: 1 } ]
// change insertBulk
// insertBulk then { n: 2, nInserted: 2, ok: 1 }
// error insertBulk can not insertBulk by existed id[id-peter]
// insertBulk(existed) catch Error: can not insertBulk by existed id[id-peter]
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 }
// ]
// selectByPk { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// selectByPk(non-existed) null
// change del
// del(clean) then [
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 },
//   { n: 1, nDeleted: 1, ok: 1 }
// ]
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   {
//     id: {auto gen id},
//     name: 'kettle',
//     value: 456
//   }
// ]
// select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]
// select by $and, $gt, $lt [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]
// select by $or, $gte, $lte [
//   {
//     id: {auto gen id},
//     name: 'kettle',
//     value: 456
//   }
// ]
// select by $or, $and, $ne, $in, $nin [
//   {
//     id: 'id-rosemary',
//     name: 'rosemary(modify)',
//     value: 123.456
//   },
//   {
//     id: {auto gen id},
//     name: 'kettle',
//     value: 456
//   }
// ]
// change save
// save then [ { n: 1, nInserted: 0, nModified: 1, ok: 1 } ]
// change del
// del then [ { n: 1, nDeleted: 1, ok: 1 } ]
// error del invalid id: not a string at [data[0].id]
// change del
// del(invalid id) then [ { n: 0, nDeleted: 0, ok: 0, err: 'invalid id: not a string at [data[0].id]' } ]
// change delAll
// delAll(find) then { n: 1, nDeleted: 1, ok: 1 }
```
