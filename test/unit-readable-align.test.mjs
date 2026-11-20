import assert from 'assert'
import w from 'wsemi'
import fs from 'fs'
import WOrm from '../src/WOrmLowdb.mjs'
import { mkObserver } from './lib/mkObserver.mjs'


//第557項全族對齊輪(A1~A6)之行為釘住, 規則見sgud/rule/rulebook.md R-WRITE-ERR-01規則8與R-PKGIVEN-01; 條款見該輪之對齊條款
//  A1 選項容器本身不可讀(opt或option為已撤銷之Proxy、get陷阱拋錯等, 讀其成員即拋錯): 固定詞彙invalid option: must be a readable value(建構為invalid opt: …), 走原通道
//     (非同步入口: error事件恰一次後reject; 建構: 同步throw), 讀取在既有try之內
//  A2 存取器拋錯(容器可讀而其成員為拋錯之getter): 於讀取處轉固定詞彙invalid <名稱>: must be a readable value, 不轉出存取器拋出之文字
//  A3 複製階段之巢狀不可讀值(資料內之id、列之成員、陣列其後之元素、各欄位值為已撤銷之Proxy或拋錯之存取器): 轉固定詞彙invalid data: must be a readable value,
//     走與頂層不可讀相同之通道(error事件恰一次、data為null後reject、資料庫不變); 複製處之catch不分辨頂層與巢狀
//  A4 入口階段拒絕之error事件之data為null(不把不可讀之值交給訂閱函數); 入口階段之後之拒絕(如invalid id、Date年份範圍外)不在此列, data維持為複製
//  A5 selectByPk之不可讀pk: reject invalid pk: must be a readable value(error事件恰一次); 可讀而非有效者回null(本套件既有)
//  A6 主鍵給了而非字串: 一律invalid id: not a string at [data[<k>].id], 不隨autoGenPk改變, 不補值
//  A7 已關閉之實例(條款: 不可讀之資料容器 → error事件data為null, 可讀者維持輸入): 本套件之實例無close()與終態, 不適用; 本組為偵測器(新增close類入口即轉紅)
//每案使用全新資料庫檔; 「資料庫不變」以直讀檔案位元組比對(不經被測物件之讀取函數); 敵意值每次呼叫重建
describe('readable-align (A1-A6)', function() {
    let url = './test/_tmp/readable-align'
    let nFile = 0

    //FIXED, 本套件之固定詞彙(不含拋出者之原訊息與值)
    let FIXED = (name) => `invalid ${name}: must be a readable value`

    //敵意值建構器: 皆含SECRET標記, 其不得出現於任何訊息
    let revoked = () => {
        let r = Proxy.revocable({}, {})
        r.revoke()
        return r.proxy
    }
    let revokedArr = () => {
        let r = Proxy.revocable([], {})
        r.revoke()
        return r.proxy
    }
    let revokedU8a = () => {
        let r = Proxy.revocable(new Uint8Array(3), {})
        r.revoke()
        return r.proxy
    }
    let getTrapAll = () => new Proxy({}, {
        get() {
            throw new Error('SECRET-get-all')
        },
    })
    let getTrapStr = () => new Proxy({}, {
        get(t, k) {
            if (typeof k === 'string') {
                throw new Error('SECRET-get-str')
            }
            return t[k]
        },
    })
    let ownKeysThrow = (target = {}) => new Proxy(target, {
        ownKeys() {
            throw new Error('SECRET-ownKeys')
        },
    })
    let tagThrow = () => ({
        get [Symbol.toStringTag]() {
            throw new Error('SECRET-tag')
        },
    })
    let accThrow = (key, extra = {}) => {
        let o = { ...extra }
        Object.defineProperty(o, key, {
            get() {
                throw new Error(`SECRET-acc-${key}`)
            },
            enumerable: true,
        })
        return o
    }
    let nullProtoDate = () => {
        let d = new Date(0)
        Object.setPrototypeOf(d, null)
        return d
    }
    let deepObj = (n) => {
        let o = {}
        let cur = o
        for (let i = 0; i < n; i++) {
            cur.n = {}
            cur = cur.n
        }
        return o
    }

    //mk, 全新資料庫檔
    let mk = (opt = {}) => {
        nFile++
        let file = `${url}/c${nFile}.json`
        w.fsDeleteFile(file)
        let wo = WOrm({ url: file, db: 'worm', cl: `c${nFile}`, ...opt })
        return { wo, file, ob: mkObserver(wo) }
    }
    let bytes = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
    let seed = async(t) => {
        await t.wo.insertBulk([{ id: 'seed1', a: 1 }, { id: 'seed2', a: 2 }])
    }

    before(function() {
        w.fsDeleteFolder(url)
        fs.mkdirSync(url, { recursive: true })
    })
    after(function() {
        w.fsDeleteFolder(url)
    })

    //chkReject, 入口階段拒絕之共同斷言(A1~A4): reject為本套件之Error且訊息全等msg(不含SECRET), error事件恰一次且先於reject, 事件之訊息同reject, data為null, 不發change
    let chkReject = (out, mode, msg) => {
        assert.strict.equal(out.ok, false, `${mode} should reject`)
        assert.strict.ok(out.err instanceof Error, `${mode} should reject with Error`)
        assert.strict.equal(out.err.message, msg)
        assert.strict.ok(!out.err.message.includes('SECRET'), 'the thrower\'s text must not be echoed')
        let evErr = out.evs.filter((v) => v.t === 'error')
        assert.strict.equal(evErr.length, 1, `${mode} should emit error exactly once`)
        assert.strict.equal(out.nAtSettle, 1, `${mode} should emit error before reject`)
        assert.strict.equal(evErr[0].settledAtEmit, false, `${mode} should emit error before reject`)
        assert.strict.equal(evErr[0].mode, mode)
        assert.strict.equal(evErr[0].err, msg)
        //boolean比對(不以equal): 失敗時斷言訊息不致檢視不可讀之值(其檢視本身可能拋錯)
        assert.strict.ok(evErr[0].data === null, `${mode} error event data should be null (A4)`)
        assert.strict.equal(out.evs.filter((v) => v.t === 'change').length, 0, `${mode} should not emit change`)
    }

    //chkThrow, 建構同步throw之斷言
    let chkThrow = (fn, msg) => {
        assert.throws(fn, (err) => {
            assert.strict.ok(err instanceof Error)
            assert.strict.equal(err.message, msg)
            assert.strict.ok(!err.message.includes('SECRET'))
            return true
        })
    }

    let ENTRIES = [
        { fn: 'insert', call: (wo, d, o) => wo.insert(d, o) },
        { fn: 'insertBulk', call: (wo, d) => wo.insertBulk(d) },
        { fn: 'save', call: (wo, d, o) => wo.save(d, o) },
        { fn: 'del', call: (wo, d) => wo.del(d) },
    ]

    //A1: 建構之opt容器
    describe('A1 option container unreadable: constructor', function() {
        let bads = [
            { key: 'revoked Proxy', mk: revoked },
            { key: 'Proxy whose get trap throws (every key)', mk: getTrapAll },
        ]
        for (let b of bads) {
            it(`opt = ${b.key}: throws invalid opt: must be a readable value (synchronously)`, function() {
                chkThrow(() => WOrm(b.mk()), FIXED('opt'))
            })
        }
        //對照: 讀其成員並不拋錯者(ownKeys陷阱拋錯、Symbol.toStringTag拋錯、非物件)行為不變, 照常建構並使用其url
        let controls = [
            { key: 'Proxy whose ownKeys throws', mk: (f) => ownKeysThrow({ url: f }) },
            { key: 'object whose Symbol.toStringTag getter throws', mk: (f) => Object.assign(tagThrow(), { url: f }) },
            { key: 'number', mk: () => 5 },
            { key: 'null', mk: () => null },
        ]
        for (let c of controls) {
            it(`control (readable members): opt = ${c.key} constructs (unchanged)`, function() {
                let f = `${url}/ctl-opt-${nFile++}.json`
                assert.doesNotThrow(() => WOrm(c.mk(f)))
            })
        }
    })

    //A1: 方法之option容器(insert讀option先於data之判定; save先複製data再讀option, data無效者不讀option)
    describe('A1 option container unreadable: methods', function() {
        let bads = [
            { key: 'revoked Proxy', mk: revoked },
            { key: 'Proxy whose get trap throws (every key)', mk: getTrapAll },
        ]
        for (let en of ENTRIES.filter((v) => v.fn === 'insert' || v.fn === 'save')) {
            for (let b of bads) {
                it(`${en.fn}: option = ${b.key}: error once before reject (data null), database unchanged, later insert works`, async function() {
                    let t = mk()
                    await seed(t)
                    let before = bytes(t.file)
                    let out = await t.ob.run(() => en.call(t.wo, [{ id: 'n1', a: 1 }], b.mk()))
                    chkReject(out, en.fn, FIXED('option'))
                    assert.strict.equal(bytes(t.file), before)
                    assert.deepStrictEqual(await t.wo.insert({ id: 'later' }), { n: 1, nInserted: 1, ok: 1 })
                })
            }
            let controls = [
                { key: 'Proxy whose ownKeys throws', mk: () => ownKeysThrow() },
                { key: 'object whose Symbol.toStringTag getter throws', mk: tagThrow },
                { key: 'number', mk: () => 5 },
            ]
            for (let c of controls) {
                it(`control (readable members): ${en.fn}: option = ${c.key} is read as no options (unchanged)`, async function() {
                    let t = mk()
                    let out = await t.ob.run(() => en.call(t.wo, [{ id: 'n1', a: 1 }], c.mk()))
                    assert.strict.equal(out.ok, true)
                    assert.strict.equal(out.evs.filter((v) => v.t === 'error').length, 0)
                    assert.deepStrictEqual((await t.wo.select()).map((v) => v.id), ['n1'])
                })
            }
        }
        it('insert: invalid data with an unreadable option still rejects on the option (option is read before the data is judged)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.insert(null, revoked()))
            chkReject(out, 'insert', FIXED('option'))
        })
        it('control: save with invalid data does not read the option (returns [] without events, unchanged)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.save(null, revoked()))
            assert.strict.equal(out.ok, true)
            assert.deepStrictEqual(out.val, [])
            assert.strict.equal(out.evs.length, 0)
        })
    })

    //A2: 存取器拋錯
    describe('A2 accessor throws', function() {
        for (let k of ['url', 'db', 'cl', 'useCache', 'autoGenPk']) {
            it(`constructor: opt.${k} getter throws: throws invalid opt.${k}: must be a readable value`, function() {
                let f = `${url}/a2-ctor-${nFile++}.json`
                let o = { url: f }
                Object.defineProperty(o, k, {
                    get() {
                        throw new Error('SECRET-ctor-acc')
                    },
                    enumerable: true,
                })
                chkThrow(() => WOrm(o), FIXED(`opt.${k}`))
            })
        }
        it('constructor: opt whose get trap throws for string keys only (container readable): invalid opt.url (the first member read)', function() {
            chkThrow(() => WOrm(getTrapStr()), FIXED('opt.url'))
        })
        it('insert: option.returnList getter throws: invalid option.returnList, error once (data null), database unchanged', async function() {
            let t = mk()
            await seed(t)
            let before = bytes(t.file)
            let out = await t.ob.run(() => t.wo.insert([{ id: 'n1' }], accThrow('returnList')))
            chkReject(out, 'insert', FIXED('option.returnList'))
            assert.strict.equal(bytes(t.file), before)
        })
        it('save: option.autoInsert getter throws: invalid option.autoInsert, error once (data null), database unchanged', async function() {
            let t = mk()
            await seed(t)
            let before = bytes(t.file)
            let out = await t.ob.run(() => t.wo.save([{ id: 'n1' }], accThrow('autoInsert')))
            chkReject(out, 'save', FIXED('option.autoInsert'))
            assert.strict.equal(bytes(t.file), before)
        })
        it('insert/save: option whose get trap throws for string keys only: the member name is reported', async function() {
            let t = mk()
            let out1 = await t.ob.run(() => t.wo.insert([{ id: 'n1' }], getTrapStr()))
            chkReject(out1, 'insert', FIXED('option.returnList'))
            let out2 = await t.ob.run(() => t.wo.save([{ id: 'n2' }], getTrapStr()))
            chkReject(out2, 'save', FIXED('option.autoInsert'))
        })
        for (let en of ENTRIES) {
            it(`${en.fn}: one-element array whose [0] getter throws (read by this package itself): invalid data, error once (data null)`, async function() {
                let t = mk()
                await seed(t)
                let before = bytes(t.file)
                let a = [0]
                Object.defineProperty(a, '0', {
                    get() {
                        throw new Error('SECRET-elem')
                    },
                    enumerable: true,
                })
                let out = await t.ob.run(() => en.call(t.wo, a))
                chkReject(out, en.fn, FIXED('data'))
                assert.strict.equal(bytes(t.file), before)
            })
        }
        it('control: a getter that does not throw is read normally (valid accessor options and data)', async function() {
            let t = mk()
            let opt = {
                get returnList() {
                    return true
                },
            }
            let out = await t.ob.run(() => t.wo.insert([{ id: 'g1' }], opt))
            assert.strict.equal(out.ok, true)
            assert.deepStrictEqual(out.val, [{ n: 1, nInserted: 1, ok: 1 }])
        })
    })

    //A3: 複製階段之巢狀不可讀值
    describe('A3 nested unreadable values at the copy stage', function() {
        let shapes = [
            { key: 'id = revoked Proxy (single object)', mk: () => ({ id: revoked(), a: 1 }) },
            { key: 'id = revoked Proxy (second row)', mk: () => [{ id: 'a1' }, { id: revoked() }] },
            { key: 'id = object whose Symbol.toStringTag getter throws', mk: () => ({ id: tagThrow(), a: 1 }) },
            { key: 'id = own accessor that throws', mk: () => accThrow('id', { a: 1 }) },
            { key: 'field = own accessor that throws', mk: () => ({ id: 'f1', a: accThrow('x') }) },
            { key: 'row member = own accessor that throws', mk: () => accThrow('x', { id: 'f2' }) },
            { key: 'field = revoked Proxy', mk: () => ({ id: 'f3', a: revoked() }) },
            { key: 'u8a field = revoked Proxy of a Uint8Array', mk: () => ({ id: 'f4', u8a: revokedU8a() }) },
            { key: 'array element after the first = revoked Proxy', mk: () => [{ id: 'e1' }, revoked()] },
            { key: 'first of two array elements = revoked Proxy', mk: () => [revoked(), { id: 'e2' }] },
            { key: 'array element after the first = row with a throwing accessor', mk: () => [{ id: 'e3' }, accThrow('x')] },
            { key: 'third array element = object whose Symbol.toStringTag getter throws', mk: () => [{ id: 'e4' }, { id: 'e5' }, tagThrow()] },
            { key: 'array element = Proxy whose ownKeys throws', mk: () => [{ id: 'e6' }, ownKeysThrow()] },
            //複製處之catch不分辨拋出之原因: 非不可讀而無法複製者(原型為null之Date、過深之巢狀)同為固定詞彙
            { key: 'field = Date whose prototype is null (cannot be copied)', mk: () => ({ id: 'd1', t: nullProtoDate() }) },
            { key: 'field = nesting too deep to copy (stack overflow)', mk: () => ({ id: 'd2', o: deepObj(50000) }) },
        ]
        for (let en of ENTRIES) {
            describe(en.fn, function() {
                for (let s of shapes) {
                    it(`${s.key}: invalid data, error once (data null), database unchanged, later insert works`, async function() {
                        let t = mk()
                        await seed(t)
                        let before = bytes(t.file)
                        let out = await t.ob.run(() => en.call(t.wo, s.mk()))
                        chkReject(out, en.fn, FIXED('data'))
                        assert.strict.equal(bytes(t.file), before)
                        assert.deepStrictEqual(await t.wo.insert({ id: 'later' }), { n: 1, nInserted: 1, ok: 1 })
                    })
                }
            })
        }
        it('control: a readable data passes the copy (transparent Proxy row and getter-based id are accepted)', async function() {
            let t = mk()
            let rec = {
                get id() {
                    return 'g1'
                },
                a: 1,
            }
            let out = await t.ob.run(() => t.wo.insert([new Proxy({ id: 'p1' }, {}), rec]))
            assert.strict.equal(out.ok, true)
            assert.deepStrictEqual(out.val, { n: 2, nInserted: 2, ok: 1 })
        })
        it('control: the copy happens before any read of the database (an unreadable data does not touch the file)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.insert([{ id: 'x1', a: revoked() }]))
            chkReject(out, 'insert', FIXED('data'))
            assert.strict.equal(fs.existsSync(t.file), false)
        })
    })

    //A4: 入口階段拒絕之error事件之data為null; 入口階段之後之拒絕不在此列
    describe('A4 error event data is null for entry-stage rejections only', function() {
        let tops = [
            { key: 'revoked Proxy (object)', mk: revoked },
            { key: 'revoked Proxy (array)', mk: revokedArr },
            { key: 'Symbol.toStringTag getter throws', mk: tagThrow },
            { key: 'Proxy whose ownKeys throws', mk: () => ownKeysThrow({ id: 'p1' }) },
            { key: 'Proxy whose get trap throws', mk: getTrapAll },
        ]
        for (let en of ENTRIES) {
            for (let tp of tops) {
                it(`${en.fn}: data = ${tp.key}: error event data is null (not the unreadable value)`, async function() {
                    let t = mk()
                    let out = await t.ob.run(() => en.call(t.wo, tp.mk()))
                    chkReject(out, en.fn, FIXED('data'))
                })
            }
        }
        it('insert: option.returnList value unreadable: error event data is null (the data is readable, the stage is the entry)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.insert([{ id: 'r1' }], { returnList: revoked() }))
            chkReject(out, 'insert', FIXED('option.returnList'))
        })
        it('selectByPk: unreadable pk: error event data is null (unchanged)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.selectByPk(revoked()))
            chkReject(out, 'selectByPk', FIXED('pk'))
        })

        //對照(不變): 入口階段之後之拒絕(資料可讀, 由本套件之檢核拒絕)其data仍為複製, 逐筆失敗之data仍為該筆
        it('control: insert with a given non-string id (rejected after the copy): error event data is the copy, not null', async function() {
            let t = mk()
            let d = [{ id: 'ok1' }, { id: 5, a: 1 }]
            let out = await t.ob.run(() => t.wo.insert(d))
            assert.strict.equal(out.ok, false)
            let ev = out.evs.filter((v) => v.t === 'error')
            assert.strict.equal(ev.length, 1)
            assert.strict.ok(ev[0].data !== null && ev[0].data !== d)
            assert.deepStrictEqual(ev[0].data, [{ id: 'ok1' }, { id: 5, a: 1 }])
        })
        it('control: insert with a Date out of range (rejected after the copy): error event data is the copy, not null', async function() {
            let t = mk()
            let d = [{ id: 'dt1', t: new Date(8.64e15) }]
            let out = await t.ob.run(() => t.wo.insert(d))
            assert.strict.equal(out.ok, false)
            let ev = out.evs.filter((v) => v.t === 'error')
            assert.strict.equal(ev.length, 1)
            assert.strict.ok(ev[0].data !== null && ev[0].data !== d)
        })
        it('control: insert without id while autoGenPk is false (rejected after the copy): error event data is the copy, not null', async function() {
            let t = mk({ autoGenPk: false })
            let out = await t.ob.run(() => t.wo.insert([{ a: 1 }]))
            assert.strict.equal(out.ok, false)
            let ev = out.evs.filter((v) => v.t === 'error')
            assert.strict.equal(ev.length, 1)
            assert.strict.ok(ev[0].data !== null)
        })
        it('control: save per-row failure: error event data is that row (unchanged)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.save([{ id: 'ok2' }, { id: 5 }]))
            assert.strict.equal(out.ok, true)
            let ev = out.evs.filter((v) => v.t === 'error')
            assert.strict.equal(ev.length, 1)
            assert.deepStrictEqual(ev[0].data, [{ id: 5 }])
        })
    })

    //A5: selectByPk
    describe('A5 selectByPk', function() {
        let bads = [
            { key: 'revoked Proxy', mk: revoked },
            { key: 'Symbol.toStringTag getter throws', mk: tagThrow },
            { key: 'Proxy whose get trap throws', mk: getTrapAll },
            {
                key: 'revoked function Proxy',
                mk: () => {
                    let r = Proxy.revocable(function() {}, {})
                    r.revoke()
                    return r.proxy
                },
            },
        ]
        for (let b of bads) {
            it(`pk = ${b.key}: rejects invalid pk: must be a readable value, error once (data null)`, async function() {
                let t = mk()
                await seed(t)
                let out = await t.ob.run(() => t.wo.selectByPk(b.mk()))
                chkReject(out, 'selectByPk', FIXED('pk'))
                assert.strict.equal((await t.wo.selectByPk('seed1')).id, 'seed1', 'later selectByPk works')
            })
        }
        //可讀而非有效者照既有回null(不發事件); ownKeys拋錯之Proxy只讀標籤, 為可讀
        let readables = [
            { key: 'number 5', v: () => 5 },
            { key: 'String wrapper of an existing id', v: () => new String('seed1') }, // eslint-disable-line no-new-wrappers
            { key: 'null', v: () => null },
            { key: 'undefined', v: () => undefined },
            { key: 'empty string', v: () => '' },
            { key: 'empty object', v: () => ({}) },
            { key: 'array of an existing id', v: () => ['seed1'] },
            { key: 'Symbol', v: () => Symbol('s') },
            { key: 'boolean true', v: () => true },
            { key: 'Proxy whose ownKeys throws', v: () => ownKeysThrow() },
        ]
        for (let r of readables) {
            it(`control: pk = ${r.key}: resolves null without events (unchanged)`, async function() {
                let t = mk()
                await seed(t)
                let out = await t.ob.run(() => t.wo.selectByPk(r.v()))
                assert.strict.equal(out.ok, true)
                assert.strict.equal(out.val, null)
                assert.strict.equal(out.evs.length, 0)
            })
        }
        it('control: a valid pk returns the row', async function() {
            let t = mk()
            await seed(t)
            let out = await t.ob.run(() => t.wo.selectByPk('seed2'))
            assert.deepStrictEqual(out.val, { id: 'seed2', a: 2 })
            assert.strict.equal(out.evs.length, 0)
        })
    })

    //A6: 主鍵給了而非字串(完整型別 x 入口 x autoGenPk 見unit-pk-given; 此處釘住批次索引與未帶者之不變)
    describe('A6 given non-string id', function() {
        let bads = [
            { key: 'number 5', mk: () => 5 },
            { key: 'number 0', mk: () => 0 },
            { key: 'boolean false', mk: () => false },
            { key: 'plain object', mk: () => ({ a: 1 }) },
            { key: 'String wrapper', mk: () => new String('a') }, // eslint-disable-line no-new-wrappers
            { key: 'Symbol', mk: () => Symbol('s') },
            { key: 'BigInt', mk: () => 10n },
        ]
        for (let autoGenPk of [true, false]) {
            for (let en of ENTRIES) {
                for (let b of bads) {
                    it(`${en.fn} (autoGenPk ${autoGenPk}): id = ${b.key} at index 1 -> invalid id: not a string at [data[1].id], never replaced`, async function() {
                        let t = mk({ autoGenPk })
                        let before = bytes(t.file)
                        let out = await t.ob.run(() => en.call(t.wo, [{ id: 'first' }, { id: b.mk(), a: 1 }]))
                        let msg = 'invalid id: not a string at [data[1].id]'
                        if (en.fn === 'insert' || en.fn === 'insertBulk') {
                            assert.strict.equal(out.ok, false)
                            assert.strict.equal(out.err.message, msg)
                            assert.strict.equal(bytes(t.file), before, 'nothing written')
                            assert.strict.equal(out.evs.filter((v) => v.t === 'error').length, 1)
                        }
                        else {
                            assert.strict.equal(out.ok, true)
                            assert.strict.equal(out.val[1].ok, 0)
                            assert.strict.equal(out.val[1].err, msg)
                            let ids = (await t.wo.select()).map((v) => v.id)
                            assert.ok(!ids.some((v) => typeof v !== 'string'), 'no replaced id')
                            assert.strict.ok(ids.length <= 1, 'the bad row is not written under a new id')
                        }
                    })
                }
            }
        }
        for (let [key, v] of [['undefined', undefined], ['null', null], ['empty string', '']]) {
            it(`control: missing id (${key}): generated when autoGenPk is true (unchanged)`, async function() {
                let t = mk()
                let out = await t.ob.run(() => t.wo.insert([{ id: v, a: 1 }]))
                assert.strict.equal(out.ok, true)
                let rows = await t.wo.select()
                assert.strict.equal(rows.length, 1)
                assert.strict.ok(typeof rows[0].id === 'string' && rows[0].id.length > 0)
            })
            it(`control: missing id (${key}): rejected when autoGenPk is false (unchanged)`, async function() {
                let t = mk({ autoGenPk: false })
                let out = await t.ob.run(() => t.wo.insert([{ id: v, a: 1 }]))
                assert.strict.equal(out.ok, false)
                assert.strict.equal(out.err.message, 'can not insert by data[0] without valid id when autoGenPk is false')
            })
        }
    })

    //A7: 已關閉之實例(對齊條款「已關閉之實例收到不可讀之資料容器時, error事件之data為null; 可讀者維持為輸入」)對本套件不適用:
    //本套件之實例無close()類入口, 亦無已關閉(終態)之狀態, 故無「已關閉守門」可對齊(規則帳本R-WRITE-ERR-01規則8之〈已關閉之實例〉);
    //本組為偵測器: 日後若新增close類入口(或Symbol.dispose/asyncDispose), 此組轉紅, 須依該條款於守門處(procClosed類)補「不可讀之資料容器 → error事件data為null, 可讀者維持輸入, 巢狀值不探」並改寫本組
    describe('A7 closed instance: not applicable (the instance has no close() and no terminal state)', function() {
        //終態入口之名稱全集(其他w-orm-*套件之close或同義之釋放入口)
        let TERMINAL_NAMES = ['close', 'dispose', 'destroy', 'end', 'disconnect', 'quit', 'shutdown', 'terminate']
        let HINT = 'a close-like entry was added: add the closed-instance guard (error event data is null for an unreadable data container, the input for a readable one, nested values not probed; see rulebook R-WRITE-ERR-01 rule 8) and rewrite this group'

        for (let name of TERMINAL_NAMES) {
            it(`the instance has no "${name}" member (own or inherited)`, function() {
                let t = mk()
                assert.strict.ok(!(name in t.wo), `${name}: ${HINT}`)
                assert.strict.equal(typeof t.wo[name], 'undefined', `${name}: ${HINT}`)
            })
        }
        for (let sym of ['dispose', 'asyncDispose']) {
            it(`the instance has no Symbol.${sym} member (when the runtime defines it)`, function() {
                let t = mk()
                if (typeof Symbol[sym] !== 'symbol') {
                    //執行環境未定義此符號, 無從為成員
                    return
                }
                assert.strict.ok(!(Symbol[sym] in t.wo), `Symbol.${sym}: ${HINT}`)
            })
        }

        //對照: 實例無終態, 入口階段拒絕後同一實例仍照常運作(不因拒絕而轉為拒收一切呼叫之狀態)
        it('control: after an entry-stage rejection the same instance still serves valid calls (no terminal state)', async function() {
            let t = mk()
            let out = await t.ob.run(() => t.wo.insert(revoked()))
            chkReject(out, 'insert', FIXED('data'))
            let out2 = await t.ob.run(() => t.wo.insert([{ id: 'after1', a: 1 }]))
            assert.strict.equal(out2.ok, true)
            assert.strict.equal(out2.evs.filter((v) => v.t === 'error').length, 0)
            let rows = await t.wo.select()
            assert.deepStrictEqual(rows, [{ id: 'after1', a: 1 }])
        })
    })
})
