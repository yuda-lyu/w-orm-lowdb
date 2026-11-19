import assert from 'assert'
import w from 'wsemi'
import fs from 'fs'
import WOrm from '../src/WOrmLowdb.mjs'
import { mkObserver } from './lib/mkObserver.mjs'


//寫入入口之前置處理與錯誤路徑(帳本R-WRITE-ERR-01, 排程第80項; 來源為第77項外審Argon F-03(a))
//寫入入口insert、insertBulk、save、del於try之外原有讀取呼叫端輸入之前置處理(讀option、iseobj/isearr判定、cloneDeep(data)),
//其拋錯者(原型為null或constructor為null之Date、存取器拋錯、Proxy trap拋錯、深度過大之stack overflow等)修前reject但不發error事件,
//規則: 任何因輸入導致之失敗皆走同一錯誤路徑, 即「error事件恰一次且先於reject, 不發change, 資料庫不變, 訊息不回顯值」
//第557項對齊輪(A1~A4, 帳本R-WRITE-ERR-01規則8)起: 入口階段(option之讀取, data之判定與複製)之失敗, 訊息一律為本套件之固定詞彙invalid <名稱>: must be a readable value
//(option容器本身不可讀為invalid option: …, 成員為拋錯之存取器為invalid option.<鍵>: …, 資料內之巢狀不可讀值或無法複製者為invalid data: …), 不轉出拋出者之原訊息與值,
//reject為本套件之Error而非拋出者本身, error事件之data引數為null; 複製之後(procPk讀取原型上之存取器等)拋出之外來值維持原通道與原行為(經診斷遮罩, 見unit-diaglog-wire)
describe('write-pre-error', function() {
    let url = './test/_tmp/write-pre-error'

    //MARK, 放進紀錄內之標記字串, 錯誤訊息不得回顯資料值(帳本規則2)
    let MARK = 'SECRET-MARK-9f3a'

    //msgGetterHits, thrownValues內message存取器被執行之次數(fail-closed之副本不得執行它)
    let msgGetterHits = 0

    //壞輸入之建構器: 皆使lodash cloneDeep或其前之iseobj/isearr同步拋錯
    let nullProtoDate = () => {
        let d = new Date(0)
        Object.setPrototypeOf(d, null)
        return d
    }
    let nullCtorDate = () => {
        let d = new Date(0)
        Object.defineProperty(d, 'constructor', { value: null })
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

    //throwingGetter, 讀取欄位x時拋出v(v可為任意型別之值)
    let throwingGetter = (v) => {
        return {
            get x() {
                throw v
            },
        }
    }
    let arr1Getter = () => {
        let a = [0]
        Object.defineProperty(a, '0', {
            get() {
                throw new Error('elem-getter-boom')
            },
            enumerable: true,
        })
        return a
    }
    let proxyOwnKeysThrows = () => {
        return new Proxy({ id: 'z1' }, {
            ownKeys() {
                throw new Error('ownKeys-boom')
            },
        })
    }
    let proxyTagThrows = () => {
        return new Proxy({ id: 'z1' }, {
            get(t, k) {
                if (k === Symbol.toStringTag) {
                    throw new Error('tag-boom')
                }
                return t[k]
            },
        })
    }

    //optGetterThrows, option之key欄位讀取時拋錯
    let optGetterThrows = (key) => {
        let o = {}
        Object.defineProperty(o, key, {
            get() {
                throw new Error('opt-boom')
            },
            enumerable: true,
        })
        return o
    }

    //inputs, data型之壞輸入(每次呼叫重建, 以便驗證error事件之data引數為呼叫端傳入之同一物件)
    let inputs = [
        { key: 'null-proto Date (field in batch)', mk: () => [{ id: 'z1', secret: MARK, t: nullProtoDate() }] },
        { key: 'null-proto Date (single object)', mk: () => ({ id: 'z1', secret: MARK, t: nullProtoDate() }) },
        { key: 'null-proto Date (3rd record of batch)', mk: () => [{ id: 'z1', secret: MARK }, { id: 'z2' }, { id: 'z3', t: nullProtoDate() }] },
        { key: 'Date with null constructor', mk: () => [{ id: 'z1', secret: MARK, t: nullCtorDate() }] },
        { key: 'throwing getter (nested field)', mk: () => [{ id: 'z1', secret: MARK, o: throwingGetter(new Error('getter-boom')) }] },
        { key: 'deep nesting (stack overflow)', mk: () => [{ id: 'z1', secret: MARK, o: deepObj(50000) }] },
        { key: 'Proxy whose ownKeys throws (iseobj)', mk: proxyOwnKeysThrows },
        { key: 'Proxy whose toStringTag read throws (iseobj)', mk: proxyTagThrows },
        { key: 'one-element array whose [0] getter throws (isearr)', mk: arr1Getter },
    ]

    //FIXED, 本套件之固定詞彙(帳本規則7、8): invalid <名稱>: must be a readable value, 不含拋出者之原訊息與值
    let FIXED = (name) => `invalid ${name}: must be a readable value`

    //inputMsgs, 各壞輸入之訊息: 第557項對齊輪A3起一律為固定詞彙invalid data: must be a readable value(複製處之catch不分辨頂層與巢狀、不分辨拋出之原因),
    //不轉出拋出者之原訊息(引擎/lodash之訊息、呼叫端存取器之訊息); 原訊息以rawMsgs記錄, 供斷言其不被轉出
    let inputMsgs = {
        'null-proto Date (field in batch)': FIXED('data'),
        'null-proto Date (single object)': FIXED('data'),
        'null-proto Date (3rd record of batch)': FIXED('data'),
        'Date with null constructor': FIXED('data'),
        'throwing getter (nested field)': FIXED('data'),
        'deep nesting (stack overflow)': FIXED('data'),
        'Proxy whose ownKeys throws (iseobj)': FIXED('data'),
        'Proxy whose toStringTag read throws (iseobj)': FIXED('data'),
        'one-element array whose [0] getter throws (isearr)': FIXED('data'),
    }

    //rawMsgs, 拋出者之原訊息(引擎/lodash之訊息以關鍵字比對, 不綁死版本); 不得出現於reject之訊息與error事件之訊息
    let rawMsgs = {
        'null-proto Date (field in batch)': /primitive/i,
        'null-proto Date (single object)': /primitive/i,
        'null-proto Date (3rd record of batch)': /primitive/i,
        'Date with null constructor': /constructor/i,
        'throwing getter (nested field)': /getter-boom/,
        'deep nesting (stack overflow)': /call stack/i,
        'Proxy whose ownKeys throws (iseobj)': /ownKeys-boom/,
        'Proxy whose toStringTag read throws (iseobj)': /tag-boom/,
        'one-element array whose [0] getter throws (isearr)': /elem-getter-boom/,
    }

    //thrownValues, 呼叫端存取器拋出之值之型別(帳本規則1: 含拋出值本身無法轉為字串者, error事件仍恰一次): reject之值為拋出者本身, 事件之訊息為字串(msg)
    let thrownValues = [
        { key: 'Error', mk: () => new Error('plain-boom'), msg: 'plain-boom' },
        { key: 'string', mk: () => 'str-boom', msg: 'str-boom' },
        { key: 'number', mk: () => 42, msg: '42' },
        { key: 'null', mk: () => null, msg: 'null' },
        { key: 'undefined', mk: () => undefined, msg: 'undefined' },
        { key: 'null-proto object (not convertible to string)', mk: () => Object.create(null), msg: 'unknown error' },
        {
            key: 'object whose message getter throws',
            mk: () => {
                return {
                    get message() {
                        msgGetterHits++
                        throw new Error('message-getter-boom')
                    },
                }
            },
            msg: 'unknown error',
            //帳本R-DIAG-01(對外錯誤值經wsemi之diag.err, fail-closed): 自有存取器屬性無法在不執行使用端程式下檢查, 視為需處理:
            //reject之值為副本(存取器以'[Getter/Setter]'取代, getter不被執行), error事件之訊息取自副本; 修改前為拋出者本身且事件訊息為unknown error(README〈Breaking changes〉)
            failClosed: '[Getter/Setter]',
        },
        {
            key: 'object whose toString throws',
            mk: () => {
                return {
                    toString() {
                        throw new Error('toString-boom')
                    },
                }
            },
            msg: 'unknown error',
        },
    ]

    //entries, 寫入入口(4格). key為資料庫資料夾用之唯一名稱, valid為可成功寫入(或刪除)之數據
    let entries = [
        { key: 'insert', fn: 'insert', call: (wo, d, o) => wo.insert(d, o), early: () => ({ n: 0, nInserted: 0, ok: 1 }), valid: () => ({ id: 'valid-1' }) },
        { key: 'insertBulk', fn: 'insertBulk', call: (wo, d) => wo.insertBulk(d), early: () => ({ n: 0, nInserted: 0, ok: 1 }), valid: () => ({ id: 'valid-2' }) },
        { key: 'save', fn: 'save', call: (wo, d, o) => wo.save(d, o), early: () => [], valid: () => ({ id: 'valid-3' }) },
        { key: 'del', fn: 'del', call: (wo, d) => wo.del(d), early: () => [], valid: () => ({ id: 'seed1' }) },
    ]

    //optCases, option型之壞輸入(搭配合法data): 讀option亦為try之外之前置處理; 第557項對齊輪A2: 成員為拋錯之存取器者轉固定詞彙invalid option.<鍵>: must be a readable value, 不轉出拋出者之原訊息,
    //event之data引數為null(A4; insert先讀option再複製, save先複製再讀option, 皆為入口階段)
    let optCases = [
        { fn: 'insert', key: 'option.returnList getter throws', mkOpt: () => optGetterThrows('returnList'), msg: FIXED('option.returnList') },
        { fn: 'save', key: 'option.autoInsert getter throws', mkOpt: () => optGetterThrows('autoInsert'), msg: FIXED('option.autoInsert') },
    ]

    //mk: 於測試資料夾下建立資料庫檔(url為檔案路徑)
    let mk = (name, opt = {}) => {
        let file = `${url}/${name}.json`
        w.fsDeleteFile(file)
        return WOrm({ url: file, db: 'worm', cl: name, ...opt })
    }

    //snap, 資料庫現況(升冪)
    let snap = async(wo) => (await wo.select()).sort((a, b) => (a.id < b.id ? -1 : 1))

    //seed, 寫入前之數據
    let seed = () => [{ id: 'seed1', a: 1 }, { id: 'seed2', a: 2 }]

    before(function() {
        w.fsDeleteFolder(url)
        fs.mkdirSync(url, { recursive: true })
    })

    after(function() {
        w.fsDeleteFolder(url)
    })

    //chkEv, 錯誤路徑之共同斷言(帳本規則1、4): error事件於reject前恰一次(mode為該入口), 不發change; 回傳該error事件
    let chkEv = (out, entry) => {
        assert.strict.equal(out.ok, false, `${entry.fn} should reject`)
        let evErr = out.evs.filter((v) => v.t === 'error')
        let evChg = out.evs.filter((v) => v.t === 'change')
        assert.strict.equal(evErr.length, 1, `${entry.fn} should emit error exactly once`)
        assert.strict.equal(out.nAtSettle, 1, `${entry.fn} should emit error before reject`)
        assert.strict.equal(evErr[0].settledAtEmit, false, `${entry.fn} should emit error before reject`)
        assert.strict.equal(evErr[0].mode, entry.fn)
        assert.strict.equal(evChg.length, 0, `${entry.fn} should not emit change`)
        return evErr[0]
    }

    //chkRej, 入口階段拒絕之共同斷言(帳本規則1、2、4、8): reject為本套件之Error(非拋出者本身), 事件之訊息同reject之message,
    //訊息為預期之固定詞彙(msg, 全等; 不轉出拋出者之原訊息raw), 事件之data引數為null(第557項對齊輪A4), 訊息不回顯資料值
    let chkRej = (out, entry, msg, raw) => {
        let ev = chkEv(out, entry)
        assert.strict.ok(out.err instanceof Error, `${entry.fn} should reject with Error`)
        assert.strict.equal(ev.err, out.err.message, `${entry.fn} error event should carry the reject message`)
        assert.strict.equal(out.err.message, msg, `${entry.fn} message should be the fixed vocabulary, got "${out.err.message}"`)
        if (raw !== undefined) {
            assert.strict.ok(!raw.test(out.err.message) && !raw.test(ev.err), `${entry.fn} should not echo the thrower's message`)
        }
        assert.strict.ok(ev.data === null, `${entry.fn} error event data should be null (A4)`) //boolean比對: 失敗時斷言訊息不致檢視不可讀之值
        assert.strict.ok(!String(out.err.message).includes(MARK), `${entry.fn} message should not echo data values`)
    }

    for (let entry of entries) {
        describe(entry.key, function() {
            let wo = null
            let ob = null
            let nNext = 0

            before(async function() {
                wo = mk(entry.key)
                ob = mkObserver(wo)
                await wo.insertBulk(seed())
            })

            //chkAfter, 失敗後資料庫逐筆不變, 且其後之寫入照常(佇列未被卡住)
            let chkAfter = async(snapBefore) => {
                assert.deepStrictEqual(await snap(wo), snapBefore, `${entry.fn} database should be unchanged`)
                let id = `next-${nNext++}`
                let r = await wo.insert({ id })
                assert.strict.equal(r.nInserted, 1, `${entry.fn} following insert should work`)
            }

            for (let input of inputs) {
                it(`${input.key}: rejects with one error event before reject, no change, database unchanged`, async function() {
                    //對應建議書驗證建議1: 修前紅為無error事件
                    let snapBefore = await snap(wo)
                    let d = input.mk()
                    let out = await ob.run(() => entry.call(wo, d))
                    chkRej(out, entry, inputMsgs[input.key], rawMsgs[input.key])
                    await chkAfter(snapBefore)
                })
            }

            for (let oc of optCases.filter((v) => v.fn === entry.fn)) {
                it(`${oc.key}: rejects with one error event before reject, no change, database unchanged`, async function() {
                    let snapBefore = await snap(wo)
                    let d = [{ id: 'o1', secret: MARK, a: 1 }]
                    let out = await ob.run(() => entry.call(wo, d, oc.mkOpt()))
                    chkRej(out, entry, oc.msg, /opt-boom/)
                    await chkAfter(snapBefore)
                })
            }

            for (let tv of thrownValues) {
                it(`thrown value (${tv.key}) from a nested accessor: rejects with the fixed vocabulary (the thrown value is never read nor echoed), one error event with data null, no change`, async function() {
                    //帳本規則1、8(第557項對齊輪A3): 資料內巢狀存取器拋出之值(含無法轉為字串者: null原型物件、message存取器拋錯、toString拋錯)於複製階段被攔下,
                    //reject為本套件之固定詞彙Error而非拋出者, 拋出者之message與toString不被執行, error事件仍恰一次
                    let snapBefore = await snap(wo)
                    msgGetterHits = 0
                    let thrown = tv.mk()
                    let d = [{ id: 'z1', secret: MARK, o: throwingGetter(thrown) }]
                    let out = await ob.run(() => entry.call(wo, d))
                    let ev = chkEv(out, entry)
                    assert.strict.equal(typeof ev.err, 'string', `${entry.fn} error event message should be a string`)
                    assert.strict.ok(!Object.is(out.err, thrown), `${entry.fn} should not reject with the thrown value itself`)
                    chkRej(out, entry, FIXED('data'))
                    assert.strict.equal(msgGetterHits, 0, `${entry.fn} the caller's getter must not run`)
                    await chkAfter(snapBefore)
                })
            }

            //複製之後讀取原型上之id存取器而拋出之外來值(procPk): 不屬入口階段之複製處, 維持原通道與原行為(reject為拋出者本身或fail-closed副本, 訊息原樣經診斷遮罩, error事件之data為複製);
            //del之id於逐筆讀取(ok為0, 見unit-diaglog-wire), 不在此列
            if (entry.fn !== 'del') {
                for (let tv of thrownValues) {
                    it(`thrown value (${tv.key}) from an inherited id accessor (read after the copy): rejects with the thrown value, one error event with string message "${tv.msg}", data is the copy, no change`, async function() {
                        //帳本規則1: 拋出值本身無法轉為字串者(null原型物件、message存取器拋錯、toString拋錯)亦須恰發出一次error事件(外審agy-opus F-01), reject之值為拋出者本身
                        let snapBefore = await snap(wo)
                        msgGetterHits = 0
                        let thrown = tv.mk()
                        let d = Object.create({
                            get id() {
                                throw thrown
                            },
                        }, { secret: { value: MARK, enumerable: true } })
                        let out = await ob.run(() => entry.call(wo, d))
                        let ev = chkEv(out, entry)
                        assert.strict.equal(typeof ev.err, 'string', `${entry.fn} error event message should be a string`)
                        if (tv.failClosed === undefined) {
                            assert.strict.ok(Object.is(out.err, thrown), `${entry.fn} should reject with the thrown value itself`)
                            assert.strict.equal(ev.err, tv.msg, `${entry.fn} error event message`)
                        }
                        else {
                            assert.strict.ok(!Object.is(out.err, thrown), `${entry.fn} should reject with the fail-closed copy, not the thrown value`)
                            assert.strict.equal(Object.getPrototypeOf(out.err), Object.prototype, `${entry.fn} copy keeps the built-in prototype`)
                            assert.strict.equal(out.err.message, tv.failClosed, `${entry.fn} copy message`)
                            assert.strict.equal(ev.err, tv.failClosed, `${entry.fn} error event message comes from the copy`)
                            assert.strict.equal(msgGetterHits, 0, `${entry.fn} the caller's getter must not run`)
                        }
                        assert.strict.ok(!ev.err.includes(MARK), `${entry.fn} message should not echo data values`)
                        assert.strict.ok(ev.data !== null && ev.data !== d, `${entry.fn} error event data is the copy (not an entry-stage rejection, unchanged)`)
                        await chkAfter(snapBefore)
                    })
                }
            }

            if (entry.fn === 'insert') {
                it('bad data with bad option: reports the option error (option is read before the data is copied)', async function() {
                    //insert讀option先於複製data(與修前之讀取順序相同), 兩者皆壞時回報option之錯
                    let snapBefore = await snap(wo)
                    let d = inputs[0].mk()
                    let out = await ob.run(() => wo.insert(d, optGetterThrows('returnList')))
                    chkRej(out, entry, FIXED('option.returnList'), /opt-boom/)
                    await chkAfter(snapBefore)
                })
                it('invalid data with bad option: still rejects with the option error (option is read before the validity check)', async function() {
                    let snapBefore = await snap(wo)
                    let out = await ob.run(() => wo.insert(null, optGetterThrows('returnList')))
                    chkRej(out, entry, FIXED('option.returnList'), /opt-boom/)
                    await chkAfter(snapBefore)
                })
            }

            if (entry.fn === 'save') {
                it('bad data with bad option: reports the data error (data is copied before the option is read)', async function() {
                    //save先複製data再讀option(與修前相同), 兩者皆壞時回報data之錯
                    let snapBefore = await snap(wo)
                    let d = inputs[0].mk()
                    let out = await ob.run(() => wo.save(d, optGetterThrows('autoInsert')))
                    chkRej(out, entry, FIXED('data'), /primitive/i)
                    assert.strict.notEqual(out.err.message, FIXED('option.autoInsert'))
                    await chkAfter(snapBefore)
                })
                it('invalid data with bad option: returns [] without reading the option (control, unchanged)', async function() {
                    let snapBefore = await snap(wo)
                    let out = await ob.run(() => wo.save(null, optGetterThrows('autoInsert')))
                    assert.strict.equal(out.ok, true)
                    assert.deepStrictEqual(out.val, [])
                    assert.strict.equal(out.evs.length, 0)
                    await chkAfter(snapBefore)
                })
            }
        })
    }

    //對照組(修前即綠): 帳本規則3, 輸入無效之早退結果不變, 不發任何事件
    describe('control: invalid input returns early (unchanged)', function() {
        let invalids = [
            { key: 'null', v: null },
            { key: 'undefined', v: undefined },
            { key: 'string', v: 'str' },
            { key: 'number', v: 123 },
            { key: 'empty array', v: [] },
            { key: 'empty object', v: {} },
            { key: 'null-proto Date as data (not an object/array, so invalid input)', v: nullProtoDate() },
        ]
        for (let entry of entries) {
            describe(entry.fn, function() {
                let wo = null
                let ob = null
                before(async function() {
                    wo = mk(`early-${entry.key}`)
                    ob = mkObserver(wo)
                    await wo.insertBulk(seed())
                })
                for (let inv of invalids) {
                    it(`${inv.key}: resolves ${JSON.stringify(entry.early())}, no events, database unchanged`, async function() {
                        let snapBefore = await snap(wo)
                        let out = await ob.run(() => entry.call(wo, inv.v))
                        assert.strict.equal(out.ok, true)
                        assert.deepStrictEqual(out.val, entry.early())
                        assert.strict.equal(out.evs.length, 0)
                        assert.deepStrictEqual(await snap(wo), snapBefore)
                    })
                }
            })
        }
        describe('insert with returnList:true', function() {
            let wo = null
            let ob = null
            before(function() {
                wo = mk('early-insert-list')
                ob = mkObserver(wo)
            })
            for (let inv of invalids) {
                it(`${inv.key}: resolves [], no events`, async function() {
                    let out = await ob.run(() => wo.insert(inv.v, { returnList: true }))
                    assert.strict.equal(out.ok, true)
                    assert.deepStrictEqual(out.val, [])
                    assert.strict.equal(out.evs.length, 0)
                })
            }
        })
    })

    //對照組(修前即綠): 一般輸入之行為不變, error為0次, change為各入口原有之事件
    describe('control: normal input unchanged', function() {
        let cases = [
            { fn: 'insert', call: (wo) => wo.insert({ id: 'n1', a: 1 }), val: { n: 1, nInserted: 1, ok: 1 }, changes: ['insert'] },
            { fn: 'insertBulk', call: (wo) => wo.insertBulk([{ id: 'n1', a: 1 }, { id: 'n2', a: 2 }]), val: { n: 2, nInserted: 2, ok: 1 }, changes: ['insertBulk'] },
            { fn: 'save', call: (wo) => wo.save({ id: 'n1', a: 1 }), val: [{ n: 1, nInserted: 1, nModified: 0, ok: 1 }], changes: ['insert', 'save'] },
            { fn: 'del', call: (wo) => wo.del({ id: 'seed1' }), val: [{ n: 1, nDeleted: 1, ok: 1 }], changes: ['del'] },
        ]
        for (let c of cases) {
            it(`${c.fn}: resolves, no error event, change events ${JSON.stringify(c.changes)}`, async function() {
                let wo = mk(`normal-${c.fn}`)
                let ob = mkObserver(wo)
                await wo.insertBulk(seed())
                let out = await ob.run(() => c.call(wo))
                assert.strict.equal(out.ok, true)
                assert.deepStrictEqual(out.val, c.val)
                assert.strict.equal(out.evs.filter((v) => v.t === 'error').length, 0)
                assert.deepStrictEqual(out.evs.filter((v) => v.t === 'change').map((v) => v.mode), c.changes)
            })
        }
    })

    //useCache之快取(帳本規則3、5): 前置處理失敗與其他整批性錯誤一致須重設快取, 輸入無效之早退不重設
    //觀測法: 快取為熱時自實例外改寫資料庫檔(內容換成ext1), 其後select若讀到檔案內容(含ext1、不含seed)即快取已重設, 讀到舊內容(seed1、seed2)即快取仍在
    describe('useCache: a failed write resets the cache, an early return keeps it (external review agy-opus F-02)', function() {
        for (let entry of entries) {
            describe(entry.fn, function() {
                //arm, 建立使用快取之實例, 令快取為熱(內容為seed), 再自外部改寫檔案為ext1
                let arm = async(tag) => {
                    let name = `cache-reset-${entry.key}-${tag}`
                    let wo = mk(name, { useCache: true })
                    await wo.insertBulk(seed())
                    await wo.select()
                    fs.writeFileSync(`${url}/${name}.json`, JSON.stringify({ [`worm:${name}`]: [{ id: 'ext1' }] }))
                    return wo
                }
                let ids = async(wo) => (await wo.select()).map((v) => v.id).sort()

                it('control: without any write the cache still serves the old content', async function() {
                    let wo = await arm('ctl')
                    assert.deepStrictEqual(await ids(wo), ['seed1', 'seed2'])
                })

                it('control: a successful write resets the cache (next select reads the file)', async function() {
                    let wo = await arm('ok')
                    await entry.call(wo, entry.valid())
                    let r = await ids(wo)
                    assert.strict.ok(r.includes('ext1') && !r.includes('seed1'), `select should read the file, got ${JSON.stringify(r)}`)
                })

                it('a write rejected by bad input resets the cache (next select reads the file)', async function() {
                    let wo = await arm('bad')
                    await entry.call(wo, inputs[0].mk()).then(() => assert.fail('should reject'), () => {})
                    let r = await ids(wo)
                    assert.strict.ok(r.includes('ext1') && !r.includes('seed1'), `select should read the file, got ${JSON.stringify(r)}`)
                })

                it('an early return (invalid input) keeps the cache (next select still serves the old content)', async function() {
                    let wo = await arm('early')
                    await entry.call(wo, null)
                    assert.deepStrictEqual(await ids(wo), ['seed1', 'seed2'])
                })
            })
        }
    })

    //對照組(修前即綠): useCache熱快取後前置處理失敗, 再select與先前一致(失敗不使快取失真)
    describe('control: useCache stays coherent after a failed write', function() {
        for (let entry of entries) {
            it(`${entry.fn}: select after failure equals select before`, async function() {
                let wo = mk(`cache-${entry.key}`, { useCache: true })
                await wo.insertBulk(seed())
                let before = await snap(wo) //填入快取
                let d = inputs[0].mk()
                await entry.call(wo, d).then(() => assert.fail('should reject'), () => {})
                assert.deepStrictEqual(await snap(wo), before)
            })
        }
    })

})
