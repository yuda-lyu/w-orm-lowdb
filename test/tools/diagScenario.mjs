//診斷輸出測試(R-DIAG-01)之共用情境: 對一個WOrmLowdb實例依序執行各操作(成功與失敗), 回傳各結果、事件payload與兩者交錯之時序, 供回傳契約之比對
//同一情境亦於修改前之程式(git HEAD)執行以產生固定預期值(golden), 故此檔不得依賴R-DIAG-01之任何新功能


let ID = 'u-secret-001@example.com'
let PW = 'S3cretPw'


//settle, reject記錄訊息、錯誤名稱與是否為Error實例(使reject值之型別改變可被偵測)
let settle = async (pm) => {
    try {
        return { ok: await pm }
    }
    catch (err) {
        return { err: String(err && err.message ? err.message : err), name: err && err.name, isError: err instanceof Error }
    }
}


//scenario, withBadListener為true時change與error訂閱函數皆拋錯(觸發診斷輸出之站點); 全程使用固定主鍵(不依賴自動產生之主鍵), 結果才可逐值比對;
//seq為事件與結果交錯之時序(['ev', 事件別, 操作別]與['res', 第幾步]), 用以偵測事件發出時機之改變
async function scenario(w, withBadListener) {
    let evs = []
    let seq = []
    let out = []
    w.on('change', (m, d, r) => {
        evs.push(['change', m, d, r])
        seq.push(['ev', 'change', m])
        if (withBadListener) {
            throw new Error(`listener ${ID} ${PW}`)
        }
    })
    w.on('error', (m, d, e) => {
        evs.push(['error', m, d, e])
        seq.push(['ev', 'error', m])
        if (withBadListener) {
            throw new Error(`listener ${ID} ${PW}`)
        }
    })
    let step = async (pm) => {
        let r = await settle(pm)
        out.push(r)
        seq.push(['res', out.length - 1])
    }
    await step(w.delAll({}))
    await step(w.insert([{ id: 'a1', name: 'n1', value: 1 }, { id: 'a2', name: 'n2', value: 2 }]))
    await step(w.insert({ id: 'a1', name: 'dup' }))
    await step(w.insert({ id: 'a7', name: 'n7' }, { returnList: true }))
    await step(w.insertBulk([{ id: 'a1', name: 'dup' }]))
    await step(w.insertBulk([{ id: 'a3', name: 'n3' }, { id: 'a4', name: 'n4' }]))
    await step(w.save([{ id: 'a1', name: 'n1x' }, { id: 'a5', name: 'n5' }]))
    await step(w.save({ id: 'a1', name: 'n1y' }, { autoInsert: false }))
    await step(w.save({ id: 'a8', t: new Date(-8.64e15) }))
    await step(w.select({ id: 'a1' }))
    await step(w.select({ $foo: 1 }))
    await step(w.select())
    await step(w.selectByPk('a2'))
    await step(w.selectByPk('nothing'))
    await step(w.selectByPk('a\ud800b'))
    await step(w.insert({ id: 'a6', t: new Date(8.64e15) }))
    await step(w.insert({ id: 'a\ud800b', name: 'x' }))
    await step(w.del({ id: 'a2' }))
    await step(w.del([{ id: 'a3' }, { id: '' }]))
    await step(w.delAll({ name: 'n4' }))
    await step(w.delAll({ $foo: 1 }))
    await step(w.delAll())
    return { out, evs, seq }
}


export { scenario, settle }
