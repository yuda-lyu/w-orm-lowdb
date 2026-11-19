import assert from 'assert'
import fs from 'fs'
import w from 'wsemi'
import WOrm from '../src/WOrmLowdb.mjs'


//主鍵(id)之「未帶」與「給了而不合格」之判定, 規則見sgud/rule/rulebook.md R-PKGIVEN-01(第557項, 全w-orm系列共同規則一)
//規格(主控裁示; wsemi 1.9.69起判斷函數只收原始值, 使procPk之isestr判定把給了之數字、String包裝物件等靜默換成新id):
//  S1 只有undefined、null、空字串(含鍵不存在)視為未帶主鍵: autoGenPk為true自動產生, 為false整批reject(既有訊息can not <入口> by data[k] without valid id when autoGenPk is false)
//  S2 給了而非字串(數字、布林、物件、陣列、String包裝物件、Symbol、BigInt等)一律依chkPk拒絕invalid id: not a string at [data[k].id], 不回顯值, 不得靜默替換為新id, 且不隨autoGenPk改變
//  S3 涵蓋所有收主鍵之入口(insert、insertBulk、save、del、selectByPk), 依各入口既有之失敗通道: insert與insertBulk整批reject(error事件恰一次後reject)、save與del逐筆ok為0附err(該筆各一次error事件)、selectByPk回null(不發事件)
//  S4 執行參數(opt.autoGenPk、option.returnList)給了非布林值者依K3取預設, 不拒絕
//每案使用全新資料庫檔; 驗證一律直讀資料庫檔(不經被測物件之讀取函數)
describe('pk given', function() {
    let url = './test/_tmp/pk-given'
    let nFile = 0

    //reUuid, genIDSeq產生之主鍵(UUIDv7)
    let reUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

    let msgOf = (err) => (err instanceof Error ? err.message : String(err))

    before(function() {
        w.fsDeleteFolder(url)
        fs.mkdirSync(url, { recursive: true })
    })
    after(function() {
        w.fsDeleteFolder(url)
    })

    //mk, 每案全新資料庫檔(檔案鍵為worm:<cl>)
    let mk = (opt = {}) => {
        nFile++
        let name = `c${nFile}`
        let file = `${url}/${name}.json`
        w.fsDeleteFile(file)
        let wo = WOrm({ url: file, db: 'worm', cl: name, ...opt })
        let evs = []
        wo.on('error', (mode, data, err) => {
            evs.push({ type: 'error', mode, data, err })
        })
        wo.on('change', (mode, data, res) => {
            evs.push({ type: 'change', mode, data, res })
        })
        return { wo, evs, file, key: `worm:${name}` }
    }

    //rawIds, 直讀資料庫檔取全部主鍵(升冪); 檔不存在或無此資料表為[]
    let rawIds = (c) => {
        if (!fs.existsSync(c.file)) {
            return []
        }
        let o = JSON.parse(fs.readFileSync(c.file, 'utf8'))
        return (o[c.key] || []).map((v) => v.id).sort()
    }

    //seed, 以另一實例直接寫入既有列(good), 其後之事件記錄重設
    let seed = async (c) => {
        await c.wo.insert({ id: 'good', name: 'g' })
        c.evs.length = 0
    }

    let nType = (evs, type, mode) => evs.filter((v) => v.type === type && (mode === undefined || v.mode === mode)).length

    //給了而非字串之id(S2)與其不得被回顯之標記; 以工廠函數取值使每案皆為全新值
    let badIds = [
        { name: 'number 5', make: () => 5 },
        { name: 'number 0', make: () => 0 },
        { name: 'NaN', make: () => NaN },
        { name: 'boolean true', make: () => true },
        { name: 'boolean false', make: () => false },
        { name: 'plain object', make: () => ({ a: 'SECRET-OBJ' }), secret: 'SECRET-OBJ' },
        {
            name: 'object with toString',
            make: () => ({
                toString() {
                    return 'SECRET-TS'
                },
            }),
            secret: 'SECRET-TS',
        },
        { name: 'array', make: () => ['SECRET-ARR'], secret: 'SECRET-ARR' },
        { name: 'empty array', make: () => [] },
        { name: 'String wrapper', make: () => new String('wrap'), secret: 'wrap' }, // eslint-disable-line no-new-wrappers
        { name: 'Number wrapper', make: () => new Number(5) }, // eslint-disable-line no-new-wrappers
        { name: 'Boolean wrapper', make: () => new Boolean(true) }, // eslint-disable-line no-new-wrappers
        { name: 'Symbol', make: () => Symbol('SYM-ID'), secret: 'SYM-ID' },
        { name: 'BigInt', make: () => 10n },
        { name: 'function', make: () => () => 'f' },
        { name: 'Date', make: () => new Date(0) },
    ]

    //讀取即拋錯或已撤銷之id值(S2之特例: 於資料複製階段cloneDeep即拋出, 屬既有行為, 訊息為拋出者之原訊息, 仍為reject而非補值)
    let genTagThrow = () => {
        let o = { a: 'SECRET-TAG' }
        Object.defineProperty(o, Symbol.toStringTag, {
            get() {
                throw new Error('TAG-BOOM')
            },
        })
        return o
    }
    let genRevoked = () => {
        let r = Proxy.revocable({}, {})
        r.revoke()
        return r.proxy
    }
    let genOwnKeysThrow = () => new Proxy({ a: 'SECRET-KEYS' }, {
        ownKeys() {
            throw new Error('KEYS-BOOM')
        },
    })
    let hostileIds = [
        { name: 'revoked Proxy', make: genRevoked },
        { name: 'Symbol.toStringTag getter throws', make: genTagThrow },
        { name: 'Proxy whose ownKeys throws', make: genOwnKeysThrow },
    ]

    let mkDoc = (hasId, id, extra) => (hasId ? { id, name: 'n', ...extra } : { name: 'n', ...extra })

    //callApi, 以單筆數據呼叫各寫入入口
    let callApi = (wo, api, hasId, id) => {
        if (api === 'insert') {
            return wo.insert([mkDoc(hasId, id)])
        }
        if (api === 'insertBulk') {
            return wo.insertBulk([mkDoc(hasId, id)])
        }
        if (api === 'save') {
            return wo.save([mkDoc(hasId, id)], { autoInsert: true })
        }
        throw new Error(`unknown api: ${api}`)
    }

    for (let autoGenPk of [true, false]) {

        describe(`given non-string id is rejected, never replaced (autoGenPk: ${autoGenPk})`, function() {

            //S2、S3: insert、insertBulk整批reject, 不寫入, error事件於reject前恰一次, change不發
            for (let api of ['insert', 'insertBulk']) {
                for (let c of badIds) {
                    it(`${api}: ${c.name}`, async function() {
                        let t = mk({ autoGenPk })
                        let rej = null
                        let r = null
                        try {
                            r = await callApi(t.wo, api, true, c.make())
                        }
                        catch (err) {
                            rej = err
                        }
                        assert.strictEqual(rej === null ? `resolved ${JSON.stringify(r)}` : msgOf(rej), 'invalid id: not a string at [data[0].id]') //S2
                        assert.deepStrictEqual(rawIds(t), []) //不得以新id寫入
                        assert.strictEqual(nType(t.evs, 'error', api), 1) //S3: 整批性錯誤之error事件恰一次
                        assert.strictEqual(nType(t.evs, 'change'), 0)
                        assert.strictEqual(t.evs[0].err, 'invalid id: not a string at [data[0].id]')
                        if (c.secret) {
                            assert.ok(JSON.stringify(t.evs.map((v) => v.err)).indexOf(c.secret) < 0 && msgOf(rej).indexOf(c.secret) < 0) //不回顯值
                        }
                    })
                }
            }

            //S2、S3: save該筆ok為0附err(逐筆通道, 不隨autoGenPk改變而改為整批reject), 不寫入
            for (let c of badIds) {
                it(`save: ${c.name}`, async function() {
                    let t = mk({ autoGenPk })
                    let r = await t.wo.save([mkDoc(true, c.make())], { autoInsert: true })
                    assert.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[0, 'invalid id: not a string at [data[0].id]']]) //S2
                    assert.deepStrictEqual(rawIds(t), [])
                    assert.strictEqual(nType(t.evs, 'error', 'save'), 1) //逐筆失敗之error事件每筆一次
                    if (c.secret) {
                        assert.ok(JSON.stringify(t.evs.map((v) => v.err)).indexOf(c.secret) < 0 && JSON.stringify(r).indexOf(c.secret) < 0)
                    }
                })
            }

            //S2: 讀取即拋錯或已撤銷之id值同樣reject而非補值(於複製階段拋出, 訊息為拋出者之原訊息), 於try內故error事件恰一次, 既有列原樣, 無新id列
            for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                for (let h of hostileIds) {
                    it(`${api}: ${h.name} rejects, writes and deletes nothing`, async function() {
                        let t = mk({ autoGenPk })
                        await seed(t)
                        let rej = null
                        let r = null
                        try {
                            r = await t.wo[api]([{ id: h.make(), name: 'n' }])
                        }
                        catch (err) {
                            rej = err
                        }
                        assert.ok(rej !== null, `must reject, resolved ${JSON.stringify(r)}`)
                        assert.deepStrictEqual(rawIds(t), ['good']) //既有列原樣, 無新id列
                        assert.strictEqual(nType(t.evs, 'error', api), 1)
                        assert.strictEqual(nType(t.evs, 'change'), 0)
                        assert.ok(msgOf(rej).indexOf('SECRET') < 0)
                    })
                }
            }

        })

    }


    describe('del and selectByPk: given non-string id never hits an existing row (unchanged channels)', function() {

        //S3: 此二入口修前即不補值, 本組釘住其行為不隨判斷函數語意改變且不隨autoGenPk改變; 以既有之good列證明不誤中
        for (let [c, autoGenPk] of badIds.flatMap((v) => [[v, true], [v, false]])) {
            it(`${c.name} (autoGenPk: ${autoGenPk})`, async function() {
                let t = mk({ autoGenPk })
                await seed(t)
                let r = await t.wo.del([{ id: c.make() }])
                assert.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[0, 'invalid id: not a string at [data[0].id]']])
                assert.strictEqual(await t.wo.selectByPk(c.make()), null) //selectByPk: 給了而非字串回null, 不reject
                assert.deepStrictEqual(rawIds(t), ['good']) //既有列未被誤刪、未被誤讀
                assert.strictEqual(nType(t.evs, 'error', 'del'), 1)
                assert.strictEqual(nType(t.evs, 'error', 'selectByPk'), 0)
            })
        }

    })


    describe('missing id (absent key, undefined, null, empty string) is not given', function() {

        let missings = [
            { name: 'key absent', has: false },
            { name: 'undefined', has: true, v: undefined },
            { name: 'null', has: true, v: null },
            { name: 'empty string (documented)', has: true, v: '' },
        ]

        for (let api of ['insert', 'insertBulk', 'save']) {
            for (let m of missings) {

                //S1: autoGenPk為true自動產生(UUIDv7)
                it(`${api}: ${m.name} gets a generated id when autoGenPk is true`, async function() {
                    let t = mk({ autoGenPk: true })
                    let r = await callApi(t.wo, api, m.has, m.v)
                    assert.ok(api === 'save' ? r.every((v) => v.ok === 1) : r.ok === 1)
                    let ids = rawIds(t)
                    assert.strictEqual(ids.length, 1)
                    assert.ok(reUuid.test(ids[0]), ids[0])
                })

                //S1: autoGenPk為false整批reject(save亦同, 屬整批性錯誤), 不寫入, 訊息為既有詞彙
                it(`${api}: ${m.name} rejects the batch when autoGenPk is false`, async function() {
                    let t = mk({ autoGenPk: false })
                    await assert.rejects(() => callApi(t.wo, api, m.has, m.v), (err) => msgOf(err) === `can not ${api} by data[0] without valid id when autoGenPk is false`)
                    assert.deepStrictEqual(rawIds(t), [])
                    assert.strictEqual(nType(t.evs, 'error', api), 1)
                })

            }
        }

        //S1: 同批多筆未帶者各得相異之新id, 與帶有效id者並存且有效id原樣
        it('a batch mixing missing ids and a valid id generates distinct ids and keeps the valid id', async function() {
            let t = mk()
            await t.wo.insert([{ name: 'a' }, { id: undefined, name: 'b' }, { id: null, name: 'c' }, { id: '', name: 'd' }, { id: 'good', name: 'e' }])
            let ids = rawIds(t)
            assert.strictEqual(ids.length, 5)
            assert.strictEqual(new Set(ids).size, 5)
            assert.strictEqual(ids.filter((v) => reUuid.test(v)).length, 4)
            assert.ok(ids.includes('good'))
        })

    })


    describe('batches: smallest bad index first, nothing written on whole-batch rejection', function() {

        for (let autoGenPk of [true, false]) {

            //S2、S3: 同批之有效筆數亦不寫入
            for (let api of ['insert', 'insertBulk']) {
                it(`${api}: [valid, non-string, valid] rejects at index 1 and writes nothing (autoGenPk: ${autoGenPk})`, async function() {
                    let t = mk({ autoGenPk })
                    await assert.rejects(() => t.wo[api]([mkDoc(true, 'a'), mkDoc(true, 5), mkDoc(true, 'b')]), (err) => msgOf(err) === 'invalid id: not a string at [data[1].id]')
                    assert.deepStrictEqual(rawIds(t), [])
                })
            }

            //S2: save逐筆, 其餘筆照常, 不得有補值之新id列
            it(`save: [valid, non-string, valid] gives ok 1, 0, 1 and stores only the valid ids (autoGenPk: ${autoGenPk})`, async function() {
                let t = mk({ autoGenPk })
                let r = await t.wo.save([mkDoc(true, 'a'), mkDoc(true, 5), mkDoc(true, 'b')], { autoInsert: true })
                assert.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[1, undefined], [0, 'invalid id: not a string at [data[1].id]'], [1, undefined]])
                assert.deepStrictEqual(rawIds(t), ['a', 'b'])
            })

        }

        //輸入為單一物件(非陣列)時索引為0, 與陣列輸入同
        for (let api of ['insert', 'insertBulk']) {
            it(`${api}: a single object with a non-string id rejects at index 0`, async function() {
                let t = mk()
                await assert.rejects(() => t.wo[api](mkDoc(true, 5)), (err) => msgOf(err) === 'invalid id: not a string at [data[0].id]')
                assert.deepStrictEqual(rawIds(t), [])
            })
        }
        it('save: a single object with a non-string id gives ok 0 at index 0', async function() {
            let t = mk()
            let r = await t.wo.save(mkDoc(true, 5), { autoInsert: true })
            assert.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[0, 'invalid id: not a string at [data[0].id]']])
            assert.deepStrictEqual(rawIds(t), [])
        })

        //option.returnList為true時整批性錯誤仍為reject, 不回逐筆陣列
        it('insert with returnList true still rejects the whole batch for a non-string id', async function() {
            let t = mk()
            await assert.rejects(() => t.wo.insert([mkDoc(true, 'a'), mkDoc(true, 5)], { returnList: true }), (err) => msgOf(err) === 'invalid id: not a string at [data[1].id]')
            assert.deepStrictEqual(rawIds(t), [])
        })

        //同一批內非字串與孤立代理字元皆不合格時以索引最小者為準
        it('insert: the smallest index wins between a non-string and a lone surrogate', async function() {
            let t = mk()
            await assert.rejects(() => t.wo.insert([mkDoc(true, 5), mkDoc(true, 'x\uD800')]), (err) => msgOf(err) === 'invalid id: not a string at [data[0].id]')
            await assert.rejects(() => t.wo.insert([mkDoc(true, 'x\uD800'), mkDoc(true, 5)]), (err) => msgOf(err) === 'invalid id: string contains lone surrogate at [data[0].id]')
            assert.deepStrictEqual(rawIds(t), [])
        })

    })


    describe('execution parameters given as non-boolean take the default (K3), not rejected', function() {

        //S4: opt.autoGenPk非布林值忽略並用預設true(README: 非布林之值一律忽略)
        for (let [nm, v] of [['Boolean wrapper false', new Boolean(false)], ['Boolean wrapper true', new Boolean(true)], ['string false', 'false'], ['number 0', 0], ['null', null]]) { // eslint-disable-line no-new-wrappers
            it(`opt.autoGenPk ${nm} uses the default (true): a missing id is generated`, async function() {
                let t = mk({ autoGenPk: v })
                let r = await t.wo.insert([{ name: 'noid' }])
                assert.strictEqual(r.ok, 1)
                let ids = rawIds(t)
                assert.strictEqual(ids.length, 1)
                assert.ok(reUuid.test(ids[0]))
            })
        }

        //S4: option.returnList非布林值忽略並用預設false(回傳聚合物件)
        for (let [nm, v] of [['Boolean wrapper true', new Boolean(true)], ['Boolean wrapper false', new Boolean(false)], ['string true', 'true'], ['number 1', 1]]) { // eslint-disable-line no-new-wrappers
            it(`option.returnList ${nm} uses the default (false): the aggregate object is returned`, async function() {
                let t = mk()
                let r = await t.wo.insert([{ id: 'a', name: 'n' }], { returnList: v })
                assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
            })
        }

        it('option.returnList true still returns the per-item array (control)', async function() {
            let t = mk()
            let r = await t.wo.insert([{ id: 'a', name: 'n' }], { returnList: true })
            assert.deepStrictEqual(r, [{ n: 1, nInserted: 1, ok: 1 }])
        })

    })


    describe('valid string ids are unchanged (control)', function() {

        for (let autoGenPk of [true, false]) {
            for (let api of ['insert', 'insertBulk', 'save']) {
                it(`${api}: a valid id is stored as given (autoGenPk: ${autoGenPk})`, async function() {
                    let t = mk({ autoGenPk })
                    await callApi(t.wo, api, true, 'good-id')
                    assert.deepStrictEqual(rawIds(t), ['good-id'])
                })
            }
        }

        //save對既有列之更新仍以字串主鍵命中
        it('save: an existing id is still matched and updated (control)', async function() {
            let t = mk()
            await t.wo.insert({ id: 'k1', v: 1 })
            let r = await t.wo.save({ id: 'k1', v: 2 })
            assert.deepStrictEqual(r, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
            assert.deepStrictEqual(await t.wo.selectByPk('k1'), { id: 'k1', v: 2 })
        })

    })

})
