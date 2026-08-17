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

    // //select by regex //mingo不支援regex
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
// error del can not delete by invalid id[]
// change del
// del(invalid id) then [ { n: 0, nDeleted: 0, ok: 0, err: 'can not delete by invalid id[]' } ]
// change delAll
// delAll(find) then { n: 1, nDeleted: 1, ok: 1 }
```
