import assert from 'assert'
import fs from 'fs'
import path from 'path'
import w from 'wsemi'
import cvStrCases from 'wsemi/src/_cvOrmStrCases.mjs'
import chkOrmData from 'wsemi/src/chkOrmData.mjs'
import WOrm from '../src/WOrmLowdb.mjs'


//字串良構(帳本R-ORMSTR-01; 規則: C:\opensrcOper\dspec\w-orm系列條件語法支援盤點.md〈一之三〉9.)
//共用檢核為wsemi之chkOrmStr、chkOrmData, 契約案例表為wsemi之_cvOrmStrCases(各w-orm-*逐案對公開API執行, 每案全新資料表),
//本檔驗證各入口(insert、insertBulk、save、del、selectByPk與建構)確實呼叫共用檢核並只使用複製後之複本;
//lowdb以JSON檔存放, 孤立代理字元可保真(鍵、值、比較三者皆不改寫), 故本批無修缺陷, 價值在[系列一致]: 使同一應用更換後端時資料行為一致(使用者D1: 全系列一律拒收)
//lowdb能力: doc=可帶任意欄位名與巢狀結構; 無GridFS(group='gfs'與need含'gfs'者略過)
describe('wellformed', function() {
    let root = './test/_tmp/wellformed'
    let { cases, forms, reasons } = cvStrCases

    //mk, 案例表之文件工廠(夾具: 字串型主鍵欄id與字串欄name)
    let mk = (id, extra) => ({ id, name: 'n', ...extra })

    //msgOf, 取reject值之訊息
    let msgOf = (err) => (err instanceof Error ? err.message : String(err))

    //assertPartial, 取回文件須含期望之各鍵且深度相等(其餘鍵不論)
    let assertPartial = (actual, part) => {
        assert.strict.ok(actual !== null && actual !== undefined, 'row should exist')
        for (let [k, v] of Object.entries(part)) {
            assert.strict.deepStrictEqual(actual[k], v, `row field [${k}]`)
        }
    }

    let seq = 0
    let nSkipGfs = 0
    let nRan = 0
    let nInvariant = 0

    //freshBackend, 每案全新資料表(獨立之JSON檔); 回傳wo, 其done()刪除該檔
    let freshBackend = (extraOpt = {}) => {
        seq++
        let fp = path.join(root, `c${seq}.json`)
        let wo = WOrm({ url: fp, db: 'worm', cl: 'test', ...extraOpt })
        wo.done = () => {
            fs.rmSync(fp, { force: true })
        }
        wo.fp = fp
        return wo
    }

    before(function() {
        w.fsDeleteFolder(root)
        fs.mkdirSync(root, { recursive: true })
    })

    after(function() {
        w.fsDeleteFolder(root)
        assert.strict.ok(!fs.existsSync(root), 'test folder should be removed')
    })

    //runCase, 依案例表檔頭[後端套用方式]逐案執行; caseOpt為建構之額外設定
    let runCase = async function(ctx, c, caseOpt = {}) {

        //caps, lowdb: doc可、gfs無
        if (c.need.includes('gfs')) {
            nSkipGfs++
            return ctx.skip()
        }
        nRan++
        let baseOpt = { url: path.join(root, 'cbase.json'), db: 'worm', cl: 'cbase', ...caseOpt }
        let e = c.expect
        let args = c.args(mk, baseOpt)

        //建構之案例: 同步throw, 訊息全等
        if (e.kind === 'throw') {
            assert.throws(() => WOrm(...args), (err) => msgOf(err) === e.msg)
            return
        }

        let wo = freshBackend(caseOpt)
        try {
            await wo.insertBulk(c.pre(mk))

            let before = {}
            for (let id of (e.unchanged || [])) {
                before[id] = await wo.selectByPk(id)
            }

            //evs, 記錄呼叫期間之error事件
            let evs = []
            wo.on('error', (mode, data, err) => evs.push({ mode, err }))

            let r = null
            let rej = null
            try {
                let p = wo[c.api](...args)
                if (c.afterCall) {
                    c.afterCall(args)
                }
                r = await p
            }
            catch (err) {
                rej = err
            }

            if (c.afterCall) {
                //呼叫後立即改動原輸入(group='toctou' mutate-after-call): lowdb於操作開始(序列化佇列輪到時)才cloneDeep輸入(帳本R-WRITE-ERR-01規則1: 前置處理全在Core之try內,
                //外殼不讀輸入值; R-DATE-01之TOCTOU不變式同此), 故呼叫後立即改動之輸入可能被取用, 與案例表預期之[呼叫當時之值]不同(lmdb於呼叫內同步複製故可);
                //本批要求之不變式為[檢查之值即寫入之值]: 無論取到改動前或改動後之值, 寫入者必經檢核, 資料庫內不得出現孤立代理字元, 失敗者以invalid data回報
                nInvariant++
                if (rej) {
                    assert.strict.ok(/^invalid data: string contains lone surrogate at \[data\[1\]\.name\]$/.test(msgOf(rej)), `unexpected rejection: ${msgOf(rej)}`)
                }
                else if (Array.isArray(r)) {
                    for (let x of r) {
                        if (x.ok === 0) {
                            assert.strict.ok(/^invalid data: string contains lone surrogate at \[data\[1\]\.name\]$/.test(String(x.err)), `unexpected item error: ${x.err}`)
                        }
                    }
                }
                for (let row of await wo.select()) {
                    assert.strict.equal(chkOrmData(row), null, 'database should not contain lone surrogate')
                }
                for (let id of (e.unchanged || [])) {
                    assert.strict.deepStrictEqual(await wo.selectByPk(id), before[id], `unchanged [${id.length}]`)
                }
                return
            }

            if (e.kind === 'free') {
                //值與鍵名之NUL不屬共用檢核: 可接受, 亦可因自身限制拒收, 但拒收訊息不得為共用檢核之詞彙
                let re = new RegExp(e.notMsg)
                if (rej) {
                    assert.strict.ok(!re.test(msgOf(rej)), `free case should not be rejected by shared check: ${msgOf(rej)}`)
                }
                else if (Array.isArray(r)) {
                    for (let x of r) {
                        if (x.ok === 0) {
                            assert.strict.ok(!re.test(String(x.err)), `free case item should not be rejected by shared check: ${x.err}`)
                        }
                    }
                }
            }
            else if (e.kind === 'rejectAll') {
                assert.strict.ok(rej, 'should reject')
                assert.strict.equal(msgOf(rej), e.msg)
            }
            else {
                assert.strict.ok(!rej, `must not reject: ${rej ? msgOf(rej) : ''}`)
                if (e.kind === 'null') {
                    assert.strict.equal(r, null)
                }
                if (e.kind === 'itemErr') {
                    assert.strict.ok(Array.isArray(r), 'result should be array')
                    r.forEach((x, i) => {
                        if (e.bad.includes(i)) {
                            assert.strict.deepStrictEqual([x.ok, x.err], [0, e.msgs ? e.msgs[e.bad.indexOf(i)] : e.msg], `item ${i}`)
                        }
                        else {
                            assert.strict.equal(x.ok, 1, `item ${i} should be ok`)
                        }
                    })
                }
            }
            //error事件(統一規格T10): 整批reject者於reject之前恰一次且訊息全等reject; 逐筆失敗者依序各一次且訊息全等該筆err; 回null與成功者無
            if (e.kind === 'rejectAll') {
                assert.strict.deepStrictEqual(evs, [{ mode: c.api, err: e.msg }], 'error event')
            }
            else if (e.kind === 'itemErr') {
                assert.strict.deepStrictEqual(evs, e.bad.map((v, j) => ({ mode: c.api, err: e.msgs ? e.msgs[j] : e.msg })), 'error events')
            }
            else if (e.kind === 'null' || e.kind === 'ok') {
                assert.strict.deepStrictEqual(evs, [], 'no error event')
            }
            if (e.kind === 'ok' && /^insert/.test(c.api)) {
                assert.strict.equal(r.ok, 1)
            }
            if (e.ids) {
                assert.strict.deepStrictEqual((await wo.select()).map((v) => v.id).sort(), e.ids)
            }
            for (let id of (e.unchanged || [])) {
                assert.strict.deepStrictEqual(await wo.selectByPk(id), before[id], `unchanged [${id.length}]`)
            }
            if (e.kind === 'ok' && e.result) {
                assertPartial(r, e.result)
            }
            for (let [id, part] of Object.entries(e.rows || {})) {
                assertPartial(await wo.selectByPk(id), part)
            }
        }
        finally {
            wo.done()
        }
    }

    //案例分組: 單元層(group='str'與'data')由wsemi自身測試執行, 本套件只跑API層
    let apiCases = cases.filter((v) => v.group !== 'str' && v.group !== 'data')
    let againCases = apiCases.filter((v) => ['id', 'single', 'val', 'order'].includes(v.group))

    describe('cases(autoGenPk預設)', function() {
        for (let c of apiCases) {
            it(c.id, async function() {
                await runCase(this, c)
            })
        }
    })

    describe('cases(autoGenPk:false; 檢核不隨autoGenPk改變, 規則9.6)', function() {
        for (let c of againCases) {
            it(c.id, async function() {
                await runCase(this, c, { autoGenPk: false })
            })
        }
    })

    describe('案例完整度與略過計數', function() {
        it('API層案例皆被執行, 僅need含gfs者(GridFS, 本後端無)略過', function() {
            let all = [...apiCases, ...againCases]
            let nGfs = all.filter((v) => v.need.includes('gfs')).length
            assert.strict.ok(nGfs > 0 && nGfs < all.length)
            assert.strict.equal(nSkipGfs, nGfs)
            assert.strict.equal(nRan, all.length - nGfs)
            assert.strict.ok(nRan > 1000, `ran ${nRan}`)

            //mutate-after-call 3案(insert、insertBulk、save)改以不變式斷言(見runCase), 計數固定
            assert.strict.equal(nInvariant, all.filter((v) => v.afterCall).length)
            assert.strict.equal(nInvariant, 3)
        })
    })

    describe('lowdb特有: JSON檔不產生孤立代理轉義(被拒之寫入不落盤)', function() {
        it('被拒之insert、insertBulk、save(孤立主鍵、值、鍵名)後, 檔案不含孤立代理之轉義且內容不變', async function() {
            let wo = freshBackend()
            try {
                await wo.insert({ id: 'k0', name: 'pre' })
                let text0 = fs.readFileSync(wo.fp, 'utf8')
                let H = 'a\uD800'
                await assert.rejects(() => wo.insert({ id: H, name: 'x' }))
                await assert.rejects(() => wo.insertBulk([{ id: 'g1', name: H }]))
                await assert.rejects(() => wo.insertBulk([{ id: 'g2', meta: { [H]: 1 } }]))
                let rs = await wo.save([{ id: H, name: 'x' }, { id: 'g3', tags: ['ok', H] }])
                assert.strict.deepStrictEqual(rs.map((v) => v.ok), [0, 0])
                let text1 = fs.readFileSync(wo.fp, 'utf8')
                assert.strict.equal(text1, text0)
                assert.strict.ok(!/\\ud[89a-f][0-9a-f]{2}/i.test(text1), 'file should not contain surrogate escapes')
            }
            finally {
                wo.done()
            }
        })

        it('良構之emoji、CJK擴充B區、U+FFFD主鍵與值照常存檔與讀回', async function() {
            let wo = freshBackend()
            try {
                let okIds = ['a\u{1F600}', '\u{20BB7}野', 'a\uFFFD', 'a\uFFFD\uFFFD\uFFFD']
                await wo.insertBulk(okIds.map((id) => ({ id, name: id, [id]: id })))
                for (let id of okIds) {
                    assert.strict.deepStrictEqual(await wo.selectByPk(id), { id, name: id, [id]: id })
                }
                let rs = await wo.del([{ id: 'a\uD800' }, { id: 'a\u{1F600}' }])
                assert.strict.deepStrictEqual(rs.map((v) => v.ok), [0, 1])
                assert.strict.deepStrictEqual((await wo.select()).map((v) => v.id).sort(), ['a\uFFFD', 'a\uFFFD\uFFFD\uFFFD', '\u{20BB7}野'].sort())
            }
            finally {
                wo.done()
            }
        })
    })

    describe('lowdb特有: 舊資料(孤立主鍵於修正前寫入, 因保真而存在, D8不遷移)', function() {
        //以JSON檔直接造修正前寫入之舊列: JSON.stringify把孤立代理寫為轉義(\ud800), 讀回仍為孤立代理(保真)
        let legacyId = 'a\uD800'

        //seedLegacy, 直接寫檔; 回傳檔案路徑
        let seedLegacy = () => {
            seq++
            let fp = path.join(root, `legacy${seq}.json`)
            fs.writeFileSync(fp, JSON.stringify({ 'worm:test': [{ id: legacyId, name: 'legacy' }, { id: 'plain', name: 'plain' }, { id: 'a\uFFFD', name: 'fffd' }, { id: 'n\u0000x', name: 'nul' }] }))
            return fp
        }

        it('select仍讀得到舊列(id為孤立代理): README之檢出法可檢出', async function() {
            let fp = seedLegacy()
            let wo = WOrm({ url: fp, db: 'worm', cl: 'test' })
            try {
                let rs = await wo.select()
                let bad = rs.filter((r) => typeof r.id === 'string' && !r.id.isWellFormed())
                assert.strict.deepStrictEqual(bad.map((v) => v.name), ['legacy'])
            }
            finally {
                fs.rmSync(fp, { force: true })
            }
        })

        it('以孤立id定址之selectByPk、del被拒(null、逐筆ok:0), 其他列照常; 舊列留存', async function() {
            let fp = seedLegacy()
            let wo = WOrm({ url: fp, db: 'worm', cl: 'test' })
            try {
                assert.strict.equal(await wo.selectByPk(legacyId), null)
                let r = await wo.del([{ id: legacyId }, { id: 'plain' }])
                assert.strict.deepStrictEqual(r.map((v) => v.ok), [0, 1])
                assert.strict.equal(r[0].err, 'invalid id: string contains lone surrogate at [data[0].id]')
                assert.strict.deepStrictEqual((await wo.select()).map((v) => v.name).sort(), ['fffd', 'legacy', 'nul'])

                //含NUL之舊主鍵同樣被拒(D2): selectByPk回null、del逐筆ok:0, 舊列留存
                assert.strict.equal(await wo.selectByPk('n\u0000x'), null)
                let rn = await wo.del({ id: 'n\u0000x' })
                assert.strict.equal(rn[0].err, 'invalid id: string contains NUL at [data[0].id]')
                assert.strict.deepStrictEqual((await wo.select()).map((v) => v.name).sort(), ['fffd', 'legacy', 'nul'])
            }
            finally {
                fs.rmSync(fp, { force: true })
            }
        })

        it('舊列之值含孤立代理(保真留存): 對該列save未含該欄之更新照常成功(不連坐檢核既有內容), 舊值原樣保留; save若寫入孤立代理則仍拒收', async function() {
            seq++
            let fp = path.join(root, `legacyval${seq}.json`)
            fs.writeFileSync(fp, JSON.stringify({ 'worm:test': [{ id: 'p2', note: 'x\uD800', n: 1 }] }))
            let wo = WOrm({ url: fp, db: 'worm', cl: 'test' })
            try {
                let r = await wo.save([{ id: 'p2', k: 1 }])
                assert.strict.deepStrictEqual(r.map((v) => v.ok), [1])
                assert.strict.deepStrictEqual(await wo.selectByPk('p2'), { id: 'p2', note: 'x\uD800', n: 1, k: 1 })
                let r2 = await wo.save([{ id: 'p2', note2: 'y\uDC00' }])
                assert.strict.deepStrictEqual(r2.map((v) => v.ok), [0])
                assert.strict.equal(r2[0].err, 'invalid data: string contains lone surrogate at [data[0].note2]')
            }
            finally {
                fs.rmSync(fp, { force: true })
            }
        })

        it('清除路徑: 依他欄之delAll或delAll()可刪除舊列', async function() {
            for (let way of ['byField', 'all']) {
                let fp = seedLegacy()
                let wo = WOrm({ url: fp, db: 'worm', cl: 'test' })
                try {
                    if (way === 'byField') {
                        let r = await wo.delAll({ name: 'legacy' })
                        assert.strict.deepStrictEqual(r, { n: 1, nDeleted: 1, ok: 1 })
                        assert.strict.deepStrictEqual((await wo.select()).map((v) => v.name).sort(), ['fffd', 'nul', 'plain'])
                    }
                    else {
                        let r = await wo.delAll()
                        assert.strict.deepStrictEqual(r, { n: 4, nDeleted: 4, ok: 1 })
                        assert.strict.deepStrictEqual(await wo.select(), [])
                    }
                }
                finally {
                    fs.rmSync(fp, { force: true })
                }
            }
        })
    })

    describe('lowdb特有: save合併路徑之繼承存取器(檢查之值即寫入之值)', function() {
        //類別實例(原型非Object.prototype)上之可列舉存取器: cloneDeep保留原型故仍在複本上, lodash merge(keysIn)於合併時讀取之;
        //存取器每次讀取可回不同值, 故合併後之最終物件(實際寫入者)須再檢核一次
        let mkInh = (id, vals) => {
            let n = 0
            let proto = {
                get flip() {
                    let v = vals[Math.min(n, vals.length - 1)]
                    n++
                    return v
                }
            }
            let d = Object.create(proto)
            d.id = id
            d.name = 'n'
            return d
        }

        it('繼承存取器首次讀回良構值、其後讀回孤立代理: 該筆ok:0附err, 原記錄不變', async function() {
            let wo = freshBackend()
            try {
                await wo.insert({ id: 'g1', name: 'pre' })
                let r = await wo.save([mkInh('g1', ['ok', 'bad\uD800'])])
                assert.strict.deepStrictEqual(r.map((v) => v.ok), [0])
                assert.strict.equal(r[0].err, 'invalid data: string contains lone surrogate at [data[0].flip]')
                assert.strict.deepStrictEqual(await wo.selectByPk('g1'), { id: 'g1', name: 'pre' })
            }
            finally {
                wo.done()
            }
        })

        it('繼承存取器自第k次讀取起回孤立代理(k=1..6): 寫入者不得為孤立代理(該筆拒收且原記錄不變, 或寫入檢核所讀之良構值)', async function() {
            let nRej = 0
            let nOk = 0
            for (let kBad = 1; kBad <= 6; kBad++) {
                let wo = freshBackend()
                try {
                    await wo.insert({ id: 'g1', name: 'pre' })
                    let n = 0
                    let proto = {
                        get flip() {
                            n++
                            return n >= kBad ? 'bad\uD800' : 'ok'
                        }
                    }
                    let d = Object.create(proto)
                    d.id = 'g1'
                    d.name = 'n'
                    let r = await wo.save([d])
                    let row = await wo.selectByPk('g1')
                    if (r[0].ok === 0) {
                        nRej++
                        assert.strict.equal(r[0].err, 'invalid data: string contains lone surrogate at [data[0].flip]', `k=${kBad}`)
                        assert.strict.deepStrictEqual(row, { id: 'g1', name: 'pre' }, `k=${kBad}`)
                    }
                    else {
                        nOk++
                        assert.strict.equal(row.flip, 'ok', `k=${kBad}`)
                    }
                }
                finally {
                    wo.done()
                }
            }
            assert.strict.ok(nRej >= 1 && nOk >= 1, `both outcomes should occur: rejected ${nRej}, written ${nOk}`)
        })

        it('繼承存取器恆回良構值: 照常合併存入(既有行為不變)', async function() {
            let wo = freshBackend()
            try {
                await wo.insert({ id: 'g1', name: 'pre' })
                let r = await wo.save([mkInh('g1', ['ok'])])
                assert.strict.deepStrictEqual(r.map((v) => v.ok), [1])
                assert.strict.deepStrictEqual(await wo.selectByPk('g1'), { id: 'g1', name: 'n', flip: 'ok' })
            }
            finally {
                wo.done()
            }
        })

        it('繼承存取器於檢核時即回孤立代理: 該筆ok:0附err(檢核先於讀取與寫入)', async function() {
            let wo = freshBackend()
            try {
                await wo.insert({ id: 'g1', name: 'pre' })
                let r = await wo.save([mkInh('g1', ['bad\uD800'])])
                assert.strict.deepStrictEqual(r.map((v) => v.ok), [0])
                assert.strict.equal(r[0].err, 'invalid data: string contains lone surrogate at [data[0].flip]')
                assert.strict.deepStrictEqual(await wo.selectByPk('g1'), { id: 'g1', name: 'pre' })
            }
            finally {
                wo.done()
            }
        })
    })

    describe('事件、時序與呼叫形式', function() {
        let H = 'a\uD800'

        it('insert/insertBulk整批reject: error事件於reject前恰一次, 訊息同reject, 不發change', async function() {
            for (let fn of ['insert', 'insertBulk']) {
                let wo = freshBackend()
                try {
                    let evs = []
                    wo.on('error', (mode, data, err) => evs.push({ t: 'error', mode, err }))
                    wo.on('change', (mode) => evs.push({ t: 'change', mode }))
                    let rej = null
                    try {
                        await wo[fn]([mk('g0'), mk(H)])
                    }
                    catch (err) {
                        rej = err
                    }
                    assert.strict.ok(rej)
                    assert.strict.deepStrictEqual(evs, [{ t: 'error', mode: fn, err: 'invalid id: string contains lone surrogate at [data[1].id]' }], fn)
                    assert.strict.equal(msgOf(rej), 'invalid id: string contains lone surrogate at [data[1].id]')
                    assert.strict.deepStrictEqual(await wo.select(), [])
                }
                finally {
                    wo.done()
                }
            }
        })

        it('insert之returnList:true遇壞列: 仍整批reject(不回逐筆清單), error事件恰一次', async function() {
            let wo = freshBackend()
            try {
                let evs = []
                wo.on('error', (mode, data, err) => evs.push({ mode, err }))
                await assert.rejects(() => wo.insert([mk('g0'), mk(H)], { returnList: true }), (err) => msgOf(err) === 'invalid id: string contains lone surrogate at [data[1].id]')
                assert.strict.deepStrictEqual(evs, [{ mode: 'insert', err: 'invalid id: string contains lone surrogate at [data[1].id]' }])
                assert.strict.deepStrictEqual(await wo.select(), [])
            }
            finally {
                wo.done()
            }
        })

        it('save/del逐筆: 各壞筆error事件一次(訊息含該筆索引), 其餘筆照常', async function() {
            let wo = freshBackend()
            try {
                await wo.insertBulk([mk('k1')])
                let evs = []
                wo.on('error', (mode, data, err) => evs.push({ t: 'error', mode, err }))
                wo.on('change', (mode) => evs.push({ t: 'change', mode }))
                let rs = await wo.save([mk(H, { name: 'x' }), mk('k1', { name: 'y' }), mk('b\uDC00', { name: 'z' })])
                assert.strict.deepStrictEqual(rs.map((v) => v.ok), [0, 1, 0])
                assert.strict.deepStrictEqual(evs.filter((v) => v.t === 'error').map((v) => v.err), [
                    'invalid id: string contains lone surrogate at [data[0].id]',
                    'invalid id: string contains lone surrogate at [data[2].id]',
                ])
                evs.length = 0
                let rd = await wo.del([{ id: H }, { id: 'k1' }, { id: 'b\uDC00' }])
                assert.strict.deepStrictEqual(rd.map((v) => v.ok), [0, 1, 0])
                assert.strict.deepStrictEqual(evs.filter((v) => v.t === 'error').map((v) => v.err), [
                    'invalid id: string contains lone surrogate at [data[0].id]',
                    'invalid id: string contains lone surrogate at [data[2].id]',
                ])
            }
            finally {
                wo.done()
            }
        })

        it('selectByPk孤立或含NUL之主鍵回null且不發error事件', async function() {
            let wo = freshBackend()
            try {
                await wo.insert({ id: 'a\uFFFD', name: 'fffd' })
                let n = 0
                wo.on('error', () => n++)
                assert.strict.equal(await wo.selectByPk(H), null)
                assert.strict.equal(await wo.selectByPk('a\u0000b'), null)
                assert.strict.equal(n, 0)
            }
            finally {
                wo.done()
            }
        })

        it('建構時孤立代理於同步throw, 且不建立任何檔案', function() {
            let fp = path.join(root, 'ctor-nocreate.json')
            assert.throws(() => WOrm({ url: fp, db: 'd\uD800', cl: 'c' }), (err) => msgOf(err) === 'invalid opt.db: string contains lone surrogate')
            assert.throws(() => WOrm({ url: fp, db: 'd', cl: 'c\uDC00' }), (err) => msgOf(err) === 'invalid opt.cl: string contains lone surrogate')
            assert.throws(() => WOrm({ url: `${fp}\uD800`, db: 'd', cl: 'c' }), (err) => msgOf(err) === 'invalid opt.url: string contains lone surrogate')
            assert.strict.equal(fs.existsSync(fp), false)
            assert.strict.equal(fs.readdirSync(root).filter((n) => n.startsWith('ctor-nocreate')).length, 0)
        })

        it('autoGenPk為true時未帶有效id之筆先補主鍵再檢核: 照常寫入; 其資料不合格者仍拒收(訊息為資料路徑)', async function() {
            for (let fn of ['insert', 'insertBulk', 'save']) {
                let wo = freshBackend()
                try {
                    let r = await wo[fn]([{ name: 'a' }, { id: '', name: 'b' }, { id: 12345, name: 'c' }])
                    if (fn === 'save') {
                        assert.strict.deepStrictEqual(r.map((v) => v.ok), [1, 1, 1], fn)
                    }
                    else {
                        assert.strict.equal(r.ok, 1, fn)
                    }
                    let rows = await wo.select()
                    assert.strict.equal(rows.length, 3, fn)
                    assert.strict.deepStrictEqual(rows.map((v) => v.name).sort(), ['a', 'b', 'c'], fn)
                    for (let x of rows) {
                        assert.strict.ok(typeof x.id === 'string' && x.id !== '' && x.id.isWellFormed(), fn)
                    }

                    //資料不合格: 主鍵已補(良構), 故訊息為資料路徑
                    if (fn === 'save') {
                        let rs = await wo.save([{ name: 'x\uD800' }])
                        assert.strict.equal(rs[0].err, 'invalid data: string contains lone surrogate at [data[0].name]', fn)
                    }
                    else {
                        await assert.rejects(() => wo[fn]([{ name: 'ok' }, { name: 'x\uD800' }]), (err) => msgOf(err) === 'invalid data: string contains lone surrogate at [data[1].name]', fn)
                    }
                }
                finally {
                    wo.done()
                }
            }
        })

        it('Date範圍外與孤立代理並存: 先報Date(帳本R-DATE-01之既有行為不變), 兩者單獨存在時各自拒收', async function() {
            for (let fn of ['insert', 'insertBulk']) {
                let wo = freshBackend()
                try {
                    await assert.rejects(() => wo[fn]([{ id: 'x', t: new Date(8.64e15), name: 'a\uD800' }]), (err) => /^invalid data: Date year is out of range 0000-9999 at \[data\[0\]\.t\]$/.test(msgOf(err)), fn)
                    await assert.rejects(() => wo[fn]([{ id: 'x', t: new Date(0), name: 'a\uD800' }]), (err) => msgOf(err) === 'invalid data: string contains lone surrogate at [data[0].name]', fn)
                    await assert.rejects(() => wo[fn]([{ id: 'x', t: new Date(8.64e15), name: 'ok' }]), (err) => /^invalid data: Date year is out of range/.test(msgOf(err)), fn)
                    assert.strict.deepStrictEqual(await wo.select(), [], fn)
                }
                finally {
                    wo.done()
                }
            }
        })

        it('單一物件(非陣列)呼叫之批次索引為data[0]', async function() {
            let wo = freshBackend()
            try {
                await assert.rejects(() => wo.insert(mk(H)), (err) => msgOf(err) === 'invalid id: string contains lone surrogate at [data[0].id]')
                let rs = await wo.save(mk(H))
                assert.strict.equal(rs[0].err, 'invalid id: string contains lone surrogate at [data[0].id]')
                let rd = await wo.del(mk(H))
                assert.strict.equal(rd[0].err, 'invalid id: string contains lone surrogate at [data[0].id]')
            }
            finally {
                wo.done()
            }
        })

        it('del之非字串或空主鍵之訊息不回顯值, 含批次索引', async function() {
            let wo = freshBackend()
            try {
                let rd = await wo.del([{ id: 123456 }, { id: '' }, { name: 'noid' }, { id: { secret: 'S3CR3T' } }])
                assert.strict.deepStrictEqual(rd.map((v) => v.ok), [0, 0, 0, 0])
                for (let x of rd) {
                    assert.strict.ok(!/123456|S3CR3T|noid/.test(x.err), x.err)
                    assert.strict.ok(/^invalid id: .+ at \[data\[\d\]\.id\]$/.test(x.err), x.err)
                }
            }
            finally {
                wo.done()
            }
        })
    })

    describe('案例表契約', function() {
        it('forms與reasons詞彙存在(案例表契約)', function() {
            assert.strict.ok(Object.keys(forms).length >= 33)
            assert.strict.deepStrictEqual(Object.keys(reasons).sort(), ['lone', 'notStr', 'nul'])
        })
    })
})
