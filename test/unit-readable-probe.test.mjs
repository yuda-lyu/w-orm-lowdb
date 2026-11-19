import assert from 'assert'
import w from 'wsemi'
import fs from 'fs'
import cloneDeep from 'lodash-es/cloneDeep.js'
import WOrm from '../src/WOrmLowdb.mjs'
import { mkObserver } from './lib/mkObserver.mjs'


//呼叫端給的值之可讀性檢核(帳本R-WRITE-ERR-01規則7; 來源: wsemi 1.9.69起判斷函數對讀取即拋錯之值回false而不拋錯; 第557項起改用wsemi chkReadable, 訊息改固定詞彙)
//讀取即拋錯之值(拋錯之Symbol.toStringTag、已撤銷之Proxy、陷阱拋錯之Proxy、元素getter拋錯之陣列)修前(wsemi 1.9.68以前)因判斷函數拋錯而走原失敗通道:
//  寫入入口(insert、insertBulk、save、del)與selectByPk為「error事件恰一次後reject、不發change、資料庫不變」, 建構函式為同步throw;
//1.9.69起判斷函數不拋錯, 此類值被當成「輸入無效」(寫入入口回n為0或[]、selectByPk回null, 皆不發事件)或選項之預設值, 通道失效;
//本檔驗各站點於判斷函數回false後以wsemi chkReadable區分「可讀而無效」與「不可讀」, 通道恢復, 不可讀者之訊息為固定詞彙invalid <名稱>: must be a readable value(不含拋出者之原訊息與值);
//檢核之讀取範圍(chkReadable之規則二.4對照): 純量站點(str: opt.url/db/cl、pk、錯誤之message; bol: opt.useCache/autoGenPk、option.returnList)只讀型別標籤(物件與函數皆讀),
//資料站點(data: iseobj與isearr)為ownKeys(自有鍵與原型鏈, iseobj之超集)加elements:'first'(length與唯一元素之描述子)再加呼叫端自讀唯一元素(chkReadable不呼叫存取器),
//故每種值於各站點種類之期望不同(KINDS之str、bol、data欄), 期望依chkReadable之文件化讀取範圍手寫(不由被測函數產生); 另含對照組: 可讀而型別不符者行為不變、不擴大、讀取次序與次數同修前
describe('readable-probe', function() {
    let url = './test/_tmp/readable-probe'

    let boom = (m) => () => {
        throw new Error(m)
    }

    //hostile values, 每次呼叫重建(含有狀態者)
    //str/bol: 純量站點(isestr、isbol判為false之分支)是否不可讀(chkReadable回非空, 拋出固定詞彙invalid <名稱>: must be a readable value);
    //data: 於寫入入口之data為'reject'(資料站點檢核判為不可讀而拋出固定詞彙; 或判斷函數讀取成功而其後cloneInput之cloneDeep於try內拋錯, 第557項對齊輪A3起同為固定詞彙, 皆走原通道, error事件之data為null)或'early'(可讀而無效, 早退, 不變)
    //msg為拋出者之原訊息(字串全等, 或RegExp比對), 供斷言其不被轉出(DATA_NATURAL者); dfixed對所有'reject'者皆為true
    let FIXED = (name) => `invalid ${name}: must be a readable value`
    let revoked = (target) => () => {
        let r = Proxy.revocable(target(), {})
        r.revoke()
        return r.proxy
    }
    let KINDS = [
        { key: 'Proxy whose ownKeys throws', msg: 'ownKeys-boom', str: false, bol: false, data: 'reject', mk: () => new Proxy({ id: 'z1' }, { ownKeys: boom('ownKeys-boom') }) },
        { key: 'Proxy whose getOwnPropertyDescriptor throws', msg: 'gopd-boom', str: false, bol: false, data: 'reject', mk: () => new Proxy({ id: 'z1' }, { getOwnPropertyDescriptor: boom('gopd-boom') }) },
        { key: 'Proxy whose getPrototypeOf throws', msg: 'gpo-boom', str: false, bol: false, data: 'reject', mk: () => new Proxy({ id: 'z1' }, { getPrototypeOf: boom('gpo-boom') }) },
        {
            key: 'Proxy whose toStringTag read throws',
            msg: 'tag-boom',
            str: true,
            bol: true,
            data: 'reject',
            mk: () => new Proxy({ id: 'z1' }, {
                get(t, k) {
                    if (k === Symbol.toStringTag) {
                        throw new Error('tag-boom')
                    }
                    return t[k]
                },
            }),
        },
        { key: 'revoked Proxy (object)', msg: /revoked/i, str: true, bol: true, data: 'reject', mk: revoked(() => ({ id: 'z1' })) },
        { key: 'revoked Proxy (array)', msg: /revoked/i, str: true, bol: true, data: 'reject', mk: revoked(() => [{ id: 'z1' }]) },
        {
            key: 'object whose Symbol.toStringTag getter throws',
            msg: 'tagget-boom',
            str: true,
            bol: true,
            data: 'reject',
            mk: () => {
                let o = { id: 'z1' }
                Object.defineProperty(o, Symbol.toStringTag, { get: boom('tagget-boom') })
                return o
            },
        },
        {
            key: 'one-element array whose [0] getter throws',
            msg: 'elem-boom',
            str: false,
            bol: false,
            data: 'reject',
            mk: () => {
                let a = [0]
                Object.defineProperty(a, '0', { get: boom('elem-boom'), enumerable: true })
                return a
            },
        },
        {
            key: 'array Proxy whose length read throws',
            msg: 'len-boom',
            str: false,
            bol: false,
            data: 'reject',
            mk: () => new Proxy([{ id: 'z1' }], {
                get(t, k) {
                    if (k === 'length') {
                        throw new Error('len-boom')
                    }
                    return t[k]
                },
            }),
        },
        {
            key: 'array Proxy whose toStringTag read throws',
            msg: 'atag-boom',
            str: true,
            bol: true,
            data: 'reject',
            mk: () => new Proxy([{ id: 'z1' }], {
                get(t, k) {
                    if (k === Symbol.toStringTag) {
                        throw new Error('atag-boom')
                    }
                    return t[k]
                },
            }),
        },
        //修前(wsemi 1.9.68)isbol(lodash isBoolean)另讀Symbol.toStringTag之has陷阱與其自有屬性描述子; 現行isbol只收原始值而chkReadable預設只讀標籤, 故二者皆為可讀(bol: false);
        //資料站點: 判斷函數(iseobj)讀取成功而有效, 其後cloneDeep讀取(lodash getTag之in運算)觸發has陷阱而拋出原訊息(natural)
        { key: 'Proxy whose has trap throws', msg: 'has-boom', str: false, bol: false, data: 'reject', mk: () => new Proxy({ id: 'z1' }, { has: boom('has-boom') }) },
        {
            key: 'Proxy with an own toStringTag whose descriptor read throws',
            msg: 'gopdtag-boom',
            str: false,
            bol: false,
            data: 'early', //自有標籤為'X'(非Object與Array), 資料型判斷函數只讀標籤即判為無效, 不讀屬性描述子
            mk: () => new Proxy({ id: 'z1', [Symbol.toStringTag]: 'X' }, {
                getOwnPropertyDescriptor(t, k) {
                    if (k === Symbol.toStringTag) {
                        throw new Error('gopdtag-boom')
                    }
                    return Reflect.getOwnPropertyDescriptor(t, k)
                },
            }),
        },
        //修前isestr(標籤式isstr)於標籤為String者另讀length; 現行isestr只收原始值而chkReadable預設只讀標籤, length不讀, 故為可讀(str: false, 規則二.4對照: chkReadable(v)=標籤); 資料型站點之判斷函數不讀, 為可讀而無效(早退)
        { key: 'object with a String tag whose length getter throws', msg: 'strlen-boom', str: false, bol: false, data: 'early', mk: () => ({ [Symbol.toStringTag]: 'String', id: 'z1', get length() { throw new Error('strlen-boom') } }) },
        //iseobj之for...in走訪含原型鏈; 純量站點不讀
        {
            key: 'object whose prototype is a Proxy with throwing ownKeys',
            msg: 'protokeys-boom',
            str: false,
            bol: false,
            data: 'reject',
            mk: () => {
                let o = Object.create(new Proxy({}, { ownKeys: boom('protokeys-boom') }))
                o.id = 'z1'
                return o
            },
        },
        //for...in只走字串鍵: 只有Symbol鍵之Proxy其getOwnPropertyDescriptor拋錯者, 判斷函數不觸發, 為可讀而無效
        { key: 'Proxy with only a Symbol key whose descriptor read throws', msg: null, str: false, bol: false, data: 'early', mk: () => new Proxy({}, { ownKeys: () => [Symbol('s')], getOwnPropertyDescriptor: boom('symgopd-boom') }) },
        //標籤非Object者: 判斷函數(iseobj)不讀鍵, 為可讀而無效(早退); 資料站點之ownKeys只對標籤為[object Object]者給(chkReadable之ownKeys對任何標籤皆讀Reflect.ownKeys, 型別陣列與Buffer會一次展開全部索引鍵), 故ownKeys拋錯者不被讀到
        { key: 'Proxy with a Map tag whose ownKeys throws', msg: null, str: false, bol: false, data: 'early', mk: () => new Proxy({ [Symbol.toStringTag]: 'Map', id: 'z1' }, { ownKeys: boom('maptag-ownkeys-boom') }) },
        //陣列(標籤[object Array]): isarr/isearr不讀鍵, 空陣列為可讀而無效(早退); ownKeys不給
        { key: 'empty array Proxy whose ownKeys throws', msg: null, str: false, bol: false, data: 'early', mk: () => new Proxy([], { ownKeys: boom('arrkeys-boom') }) },
        //elements:'first'(isearr之長度與[0]描述子, 規則二.4對照): 空陣列Proxy其length之描述子讀取拋錯者為不可讀(修前本地探針只讀length值而早退, 第557項起依chkReadable)
        { key: 'empty array Proxy whose getOwnPropertyDescriptor throws', msg: null, str: false, bol: false, data: 'reject', mk: () => new Proxy([], { getOwnPropertyDescriptor: boom('arrgopd-boom') }) },
        //函數: chkReadable預設對物件與函數皆讀標籤(修前之bol探針不讀函數, 現行isbol不讀任何物件, 以chkReadable為準)
        { key: 'revoked function Proxy', msg: /revoked/i, str: true, bol: true, data: 'reject', mk: revoked(() => function() {}) },
        //有狀態: 第2次讀取才拋錯者, 判斷函數讀第1次成功而有效, 其後之cloneDeep讀第2次拋錯, 為原通道(探針於判斷函數之後, 不多讀一次)
        {
            key: 'one-element array whose [0] getter throws from the 2nd read',
            msg: 'elem2nd-boom',
            str: false,
            bol: false,
            data: 'reject',
            mk: () => {
                let a = [0]
                let n = 0
                Object.defineProperty(a, '0', {
                    get() {
                        if (++n >= 2) {
                            throw new Error('elem2nd-boom')
                        }
                        return { id: 'z1' }
                    },
                    enumerable: true,
                })
                return a
            },
        },
        {
            key: 'Proxy whose ownKeys throws from the 2nd call',
            msg: 'keys2nd-boom',
            str: false,
            bol: false,
            data: 'reject',
            mk: () => {
                let n = 0
                return new Proxy({ id: 'z1' }, {
                    ownKeys(t) {
                        if (++n >= 2) {
                            throw new Error('keys2nd-boom')
                        }
                        return Reflect.ownKeys(t)
                    },
                })
            },
        },
    ]
    //DATA_NATURAL: 資料站點之判斷函數讀取成功而有效(不進檢核), 其後cloneInput(cloneDeep)於try內才拋錯者(第557項對齊輪A3前訊息為拋出者之原訊息);
    //A3起此類與檢核判為不可讀者同為固定詞彙invalid data: must be a readable value(複製處之catch不分辨), 故dfixed對所有'reject'者皆為true,
    //DATA_NATURAL僅用於標明此類之來源(判斷函數讀取成功, 由複製階段才拋錯), 並於測試中斷言拋出者之原訊息(msg)不被轉出
    let DATA_NATURAL = [
        'Proxy whose has trap throws',
        'one-element array whose [0] getter throws from the 2nd read',
        'Proxy whose ownKeys throws from the 2nd call',
    ]
    for (let k of KINDS) {
        k.dfixed = k.data === 'reject'
    }
    let KINDS_STR_T = KINDS.filter((v) => v.str)
    let KINDS_STR_F = KINDS.filter((v) => !v.str)
    let KINDS_BOL_T = KINDS.filter((v) => v.bol)
    let KINDS_BOL_F = KINDS.filter((v) => !v.bol)

    //mk: 於測試資料夾下建立資料庫檔
    let mk = (name, opt = {}) => {
        let file = `${url}/${name}.json`
        w.fsDeleteFile(file)
        return WOrm({ url: file, db: 'worm', cl: name, ...opt })
    }
    let snap = async(wo) => (await wo.select()).sort((a, b) => (a.id < b.id ? -1 : 1))
    let seed = () => [{ id: 'seed1', a: 1 }, { id: 'seed2', a: 2 }]
    let okMsg = (msg, m) => (msg instanceof RegExp ? msg.test(m) : m === msg)

    before(function() {
        w.fsDeleteFolder(url)
        fs.mkdirSync(url, { recursive: true })
    })
    after(function() {
        w.fsDeleteFolder(url)
    })

    //chkBlocked, 原失敗通道之共同斷言: reject為Error且訊息為預期訊息(固定詞彙invalid <名稱>: must be a readable value), error事件恰一次且先於reject, 不發change,
    //error事件之data引數為null(第557項對齊輪A4: 入口階段之拒絕不把不可讀之值交給訂閱函數)
    let chkBlocked = (out, mode, msg) => {
        assert.strict.equal(out.ok, false, `${mode} should reject`)
        assert.strict.ok(out.err instanceof Error, `${mode} should reject with Error`)
        assert.strict.ok(okMsg(msg, out.err.message), `${mode} message should be ${msg instanceof RegExp ? msg : `"${msg}"`}, got "${out.err.message}"`)
        let evErr = out.evs.filter((v) => v.t === 'error')
        assert.strict.equal(evErr.length, 1, `${mode} should emit error exactly once`)
        assert.strict.equal(out.nAtSettle, 1, `${mode} should emit error before reject`)
        assert.strict.equal(evErr[0].settledAtEmit, false, `${mode} should emit error before reject`)
        assert.strict.equal(evErr[0].mode, mode)
        assert.strict.equal(evErr[0].err, out.err.message, `${mode} error event should carry the reject message`)
        assert.strict.equal(out.evs.filter((v) => v.t === 'change').length, 0, `${mode} should not emit change`)
        assert.strict.ok(evErr[0].data === null, `${mode} error event data should be null (A4)`) //boolean比對: 失敗時斷言訊息不致檢視不可讀之值
    }

    //資料型站點(帳本R-WRITE-ERR-01規則7): data為呼叫端給的值, 讀取即拋錯者走原失敗通道, 而非被判為輸入無效而早退; 修前即可讀而無效者仍早退
    describe('data of write entries', function() {
        let entries = [
            { key: 'insert', fn: 'insert', call: (wo, d) => wo.insert(d), early: () => ({ n: 0, nInserted: 0, ok: 1 }) },
            { key: 'insert(returnList:true)', fn: 'insert', call: (wo, d) => wo.insert(d, { returnList: true }), early: () => [] },
            { key: 'insertBulk', fn: 'insertBulk', call: (wo, d) => wo.insertBulk(d), early: () => ({ n: 0, nInserted: 0, ok: 1 }) },
            { key: 'save', fn: 'save', call: (wo, d) => wo.save(d), early: () => [] },
            { key: 'del', fn: 'del', call: (wo, d) => wo.del(d), early: () => [] },
        ]
        for (let entry of entries) {
            describe(entry.key, function() {
                let wo = null
                let ob = null
                let nNext = 0
                before(async function() {
                    wo = mk(`data-${entry.key.replace(/[^a-zA-Z]/g, '')}`)
                    ob = mkObserver(wo)
                    await wo.insertBulk(seed())
                })
                for (let kind of KINDS) {
                    if (kind.data === 'reject') {
                        it(`${kind.key}: error event once before reject, no change, database unchanged, later insert works`, async function() {
                            //spec(R-WRITE-ERR-01規則7): 讀取即拋錯之data走原失敗通道(error事件恰一次後reject, 資料庫不變), 不得回n為0之輸入無效結果
                            let snapBefore = await snap(wo)
                            let d = kind.mk()
                            let out = await ob.run(() => entry.call(wo, d))
                            chkBlocked(out, entry.fn, FIXED('data'))
                            //A3: 拋出者(判斷函數讀取成功而複製階段才拋錯者, DATA_NATURAL)之原訊息不被轉出
                            if (DATA_NATURAL.includes(kind.key)) {
                                assert.strict.ok(!okMsg(kind.msg, out.err.message) && !okMsg(kind.msg, out.evs.filter((v) => v.t === 'error')[0].err), `${entry.fn} should not echo the thrower's message`)
                            }
                            assert.deepStrictEqual(await snap(wo), snapBefore, `${entry.fn} database should be unchanged`)
                            let r = await wo.insert({ id: `next-${nNext++}` })
                            assert.strict.equal(r.nInserted, 1, `${entry.fn} following insert should work`)
                        })
                    }
                    else {
                        it(`control (${kind.key}): readable by the judge functions, so early return as invalid input, no events (unchanged)`, async function() {
                            let snapBefore = await snap(wo)
                            let out = await ob.run(() => entry.call(wo, kind.mk()))
                            assert.strict.equal(out.ok, true)
                            assert.deepStrictEqual(out.val, entry.early())
                            assert.strict.equal(out.evs.length, 0)
                            assert.deepStrictEqual(await snap(wo), snapBefore)
                        })
                    }
                }
            })
        }
    })

    //selectByPk之pk(isestr站點, 'str'): 修前不可讀者走原失敗通道; 其餘(判斷函數本就不讀者)行為不變回null
    describe('selectByPk(pk)', function() {
        let wo = null
        let ob = null
        before(async function() {
            wo = mk('selectbypk')
            ob = mkObserver(wo)
            await wo.insertBulk(seed())
        })
        for (let kind of KINDS_STR_T) {
            it(`${kind.key}: error event once before reject (mode selectByPk, data null)`, async function() {
                //spec(R-WRITE-ERR-01規則7): isestr站點不可讀之pk走原失敗通道, 不得被判為無效主鍵而回null
                let out = await ob.run(() => wo.selectByPk(kind.mk()))
                chkBlocked(out, 'selectByPk', FIXED('pk'))
                assert.strict.equal(out.evs.filter((v) => v.t === 'error')[0].data, null)
                assert.deepStrictEqual((await wo.selectByPk('seed1')).id, 'seed1', 'later selectByPk should work')
            })
        }
        for (let kind of KINDS_STR_F) {
            it(`control (${kind.key}): not read by isestr, so resolves null with no event (unchanged)`, async function() {
                let out = await ob.run(() => wo.selectByPk(kind.mk()))
                assert.strict.equal(out.ok, true)
                assert.strict.equal(out.val, null)
                assert.strict.equal(out.evs.length, 0)
            })
        }
        let invalids = [
            { key: 'number', v: 123 },
            { key: 'empty string', v: '' },
            { key: 'null', v: null },
            { key: 'undefined', v: undefined },
            { key: 'empty object', v: {} },
            { key: 'empty array', v: [] },
            { key: 'boolean', v: true },
        ]
        for (let inv of invalids) {
            it(`control (readable wrong type: ${inv.key}): resolves null, no event (unchanged)`, async function() {
                let out = await ob.run(() => wo.selectByPk(inv.v))
                assert.strict.equal(out.ok, true)
                assert.strict.equal(out.val, null)
                assert.strict.equal(out.evs.length, 0)
            })
        }
        it('control: a valid pk still resolves the record', async function() {
            let out = await ob.run(() => wo.selectByPk('seed2'))
            assert.strict.equal(out.ok, true)
            assert.strict.equal(out.val.id, 'seed2')
            assert.strict.equal(out.evs.length, 0)
        })
    })

    //insert之option.returnList(isbol站點, 'bol')
    describe('insert option.returnList', function() {
        let wo = null
        let ob = null
        let nNext = 0
        before(async function() {
            wo = mk('returnlist')
            ob = mkObserver(wo)
            await wo.insertBulk(seed())
        })
        for (let kind of KINDS_BOL_T) {
            it(`${kind.key}: error event once before reject, database unchanged`, async function() {
                //spec(R-WRITE-ERR-01規則7): isbol站點不可讀之option.returnList走原失敗通道, 不得被判為預設值而照常寫入
                let snapBefore = await snap(wo)
                let d = { id: 'o1', secret: 'x' }
                let out = await ob.run(() => wo.insert(d, { returnList: kind.mk() }))
                chkBlocked(out, 'insert', FIXED('option.returnList'))
                assert.deepStrictEqual(await snap(wo), snapBefore, 'database should be unchanged')
                let r = await wo.insert({ id: `next-${nNext++}` })
                assert.strict.equal(r.nInserted, 1)
            })
        }
        for (let kind of KINDS_BOL_F) {
            it(`control (${kind.key}): not read by isbol, so treated as the default false and the insert succeeds (unchanged)`, async function() {
                let out = await ob.run(() => wo.insert({ id: `ctl-${nNext++}` }, { returnList: kind.mk() }))
                assert.strict.equal(out.ok, true)
                assert.deepStrictEqual(out.val, { n: 1, nInserted: 1, ok: 1 })
            })
        }
        for (let inv of [{ key: 'string', v: 'yes' }, { key: 'number', v: 1 }, { key: 'empty object', v: {} }, { key: 'null', v: null }]) {
            it(`control (readable wrong type: ${inv.key}): ignored as the default false (unchanged)`, async function() {
                let out = await ob.run(() => wo.insert({ id: `ctl-${nNext++}` }, { returnList: inv.v }))
                assert.strict.equal(out.ok, true)
                assert.deepStrictEqual(out.val, { n: 1, nInserted: 1, ok: 1 })
            })
        }
        it('control: returnList true still returns the per-record list', async function() {
            let out = await ob.run(() => wo.insert([{ id: `ctl-${nNext++}` }], { returnList: true }))
            assert.strict.equal(out.ok, true)
            assert.deepStrictEqual(out.val, [{ n: 1, nInserted: 1, ok: 1 }])
        })
    })

    //建構函式之選項: opt.url、opt.db、opt.cl為isestr站點('str'), opt.useCache、opt.autoGenPk為isbol站點('bol'); 修前不可讀者建構時同步throw拋出者之原錯誤, 其餘維持預設
    describe('constructor options', function() {
        let opts = [
            { name: 'url', sites: 'str' },
            { name: 'db', sites: 'str' },
            { name: 'cl', sites: 'str' },
            { name: 'useCache', sites: 'bol' },
            { name: 'autoGenPk', sites: 'bol' },
        ]
        for (let o of opts) {
            for (let kind of KINDS) {
                if (kind[o.sites]) {
                    it(`opt.${o.name} = ${kind.key}: throws the fixed-vocabulary error at construction`, function() {
                        //spec(R-WRITE-ERR-01規則7, 第557項規則二.2): 不可讀之選項值, 建構函式同步throw固定詞彙invalid opt.<名>: must be a readable value(不含拋出者之原訊息)
                        let v = kind.mk()
                        assert.throws(() => WOrm({ url: `${url}/ctor-${o.name}.json`, [o.name]: v }), (err) => err instanceof Error && err.message === FIXED(`opt.${o.name}`))
                    })
                }
                else {
                    it(`control: opt.${o.name} = ${kind.key} is not read by ${o.sites === 'str' ? 'isestr' : 'isbol'}, so constructs (unchanged)`, function() {
                        let v = kind.mk()
                        assert.doesNotThrow(() => WOrm({ url: `${url}/ctor-${o.name}.json`, [o.name]: v }))
                    })
                }
            }
        }
        it('control: readable wrong types are ignored and the defaults are used (unchanged)', async function() {
            let file = `${url}/ctor-wrongtype.json`
            w.fsDeleteFile(file)
            let wo = WOrm({ url: file, db: 123, cl: {}, useCache: 'yes', autoGenPk: 0 })
            let r = await wo.insert({ id: 'a1' })
            assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual(await wo.select(), [{ id: 'a1' }])
        })
        it('control: valid options work (unchanged)', async function() {
            let file = `${url}/ctor-valid.json`
            w.fsDeleteFile(file)
            let wo = WOrm({ url: file, db: 'd', cl: 'c', useCache: true, autoGenPk: false })
            await assert.rejects(() => wo.insert({ a: 1 }), /without valid id when autoGenPk is false/)
            assert.deepStrictEqual(await wo.insert({ id: 'k1' }), { n: 1, nInserted: 1, ok: 1 })
        })
    })

    //逐筆結果之錯誤訊息(getErrMsg之isestr站點, 'str'): 呼叫端拋出之值其message於修前不可讀者, del逐筆之catch內procMsg拋出而使整批走原通道(error事件恰一次後reject);
    //其餘(判斷函數本就不讀者)為該筆ok為0附訊息
    describe('message of a thrown value (per-record catch)', function() {
        //inheritedGetterThrows, 原型上之id存取器拋出{message: m}(cloneDeep保留原型, del於逐筆讀取id時才拋)
        let inheritedGetterThrows = (m) => {
            let P = {
                get id() {
                    throw { message: m } //eslint-disable-line no-throw-literal
                },
            }
            let o = Object.create(P)
            o.a = 1
            return o
        }
        let wo = null
        let ob = null
        before(async function() {
            wo = mk('errmsg')
            ob = mkObserver(wo)
            await wo.insertBulk(seed())
        })
        for (let kind of KINDS_STR_T) {
            it(`del, message = ${kind.key}: whole batch rejects after one error event`, async function() {
                //spec(R-WRITE-ERR-01規則7): message不可讀者走原失敗通道(整批reject), 不被判為無訊息而回該筆ok為0
                let snapBefore = await snap(wo)
                let out = await ob.run(() => wo.del(inheritedGetterThrows(kind.mk())))
                chkBlocked(out, 'del', FIXED('err.message'))
                assert.deepStrictEqual(await snap(wo), snapBefore)
            })
        }
        for (let kind of KINDS_STR_F) {
            it(`control (message = ${kind.key}): not read by isestr, so that record fails with ok 0 and the batch resolves (unchanged)`, async function() {
                let out = await ob.run(() => wo.del(inheritedGetterThrows(kind.mk())))
                assert.strict.equal(out.ok, true)
                assert.strict.equal(out.val.length, 1)
                assert.strict.equal(out.val[0].ok, 0)
                assert.strict.equal(typeof out.val[0].err, 'string')
            })
        }
    })

    //對照組: 探針不擴大, 可讀之輸入行為不變, 且讀取次序與次數同修前
    describe('control: readable inputs unchanged (the probe touches only what the judge functions read, after them)', function() {
        let entries = [
            { key: 'insert', fn: 'insert', call: (wo, d) => wo.insert(d), early: () => ({ n: 0, nInserted: 0, ok: 1 }) },
            { key: 'insertBulk', fn: 'insertBulk', call: (wo, d) => wo.insertBulk(d), early: () => ({ n: 0, nInserted: 0, ok: 1 }) },
            { key: 'save', fn: 'save', call: (wo, d) => wo.save(d), early: () => [] },
            { key: 'del', fn: 'del', call: (wo, d) => wo.del(d), early: () => [] },
        ]
        let invalids = [
            { key: 'Uint8Array of 1e6 (type tag only, keys not enumerated)', mk: () => new Uint8Array(1000000) },
            { key: 'Date', mk: () => new Date(0) },
            { key: 'Map', mk: () => new Map([['id', 'a']]) },
            { key: 'Set', mk: () => new Set(['a']) },
            { key: 'function', mk: () => () => 1 },
            { key: 'symbol', mk: () => Symbol('s') },
            { key: 'bigint', mk: () => 1n },
            { key: 'String object', mk: () => new String('id') },
        ]
        for (let entry of entries) {
            describe(entry.key, function() {
                let wo = null
                let ob = null
                before(async function() {
                    wo = mk(`ctl-${entry.key}`)
                    ob = mkObserver(wo)
                    await wo.insertBulk(seed())
                })
                for (let inv of invalids) {
                    it(`${inv.key}: early return as invalid input, no events, database unchanged`, async function() {
                        let snapBefore = await snap(wo)
                        let out = await ob.run(() => entry.call(wo, inv.mk()))
                        assert.strict.equal(out.ok, true)
                        assert.deepStrictEqual(out.val, entry.early())
                        assert.strict.equal(out.evs.length, 0)
                        assert.deepStrictEqual(await snap(wo), snapBefore)
                    })
                }
            })
        }
        it('insert: a transparent Proxy around a valid record and a valid getter-based record are accepted', async function() {
            let wo = mk('ctl-valid')
            let ob = mkObserver(wo)
            let rec = { get id() { return 'g1' }, a: 1 }
            let out = await ob.run(() => wo.insert([new Proxy({ id: 'p1' }, {}), rec]))
            assert.strict.equal(out.ok, true)
            assert.deepStrictEqual(out.val, { n: 2, nInserted: 2, ok: 1 })
            assert.deepStrictEqual((await snap(wo)).map((v) => v.id), ['g1', 'p1'])
        })
        it('insert: the [0] getter of a valid one-element array is read exactly as often as isearr plus cloneDeep read it (no extra read by the probe)', async function() {
            //spec(R-WRITE-ERR-01規則7): 判斷函數回true(有效)時不探, 有效資料之讀取次序與次數同修前; 基準為對同形陣列單獨呼叫isearr與cloneDeep之讀取次數
            let mkCounted = () => {
                let a = [0]
                let h = { n: 0 }
                Object.defineProperty(a, '0', { get() { h.n++; return { id: 'e1' } }, enumerable: true })
                return { a, h }
            }
            let base = mkCounted()
            w.isearr(base.a)
            cloneDeep(base.a)
            assert.strict.ok(base.h.n >= 2, 'baseline should read [0] at least twice')
            let wo = mk('ctl-elem-count0')
            let t = mkCounted()
            let r = await wo.insert(t.a)
            assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
            assert.deepStrictEqual((await snap(wo)).map((v) => v.id), ['e1'])
            assert.strict.equal(t.h.n, base.h.n, 'reads of [0] should equal isearr + cloneDeep')
        })
        it('insert: the [1] getter of a valid two-element array is read once (by cloneDeep only)', async function() {
            //spec(R-WRITE-ERR-01規則7): 探針範圍不擴大(length為2時判斷函數不讀任何元素, 探針亦不讀)
            let wo = mk('ctl-elem-count1')
            let a = [{ id: 'c0' }, 0]
            let hits = 0
            Object.defineProperty(a, '1', { get() { hits++; return { id: 'c1' } }, enumerable: true })
            let r = await wo.insert(a)
            assert.deepStrictEqual(r, { n: 2, nInserted: 2, ok: 1 })
            assert.strict.equal(hits, 1, 'element [1] should be read once by cloneDeep only')
        })
        for (let entry of entries) {
            it(`${entry.key}: own keys of a non-Object tag are never read (typed arrays and Buffers would be enumerated whole), early return`, async function() {
                //spec(第557項,規則二.4: ownKeys對照iseobj之for...in): iseobj只對標籤為[object Object]者讀鍵, 資料站點不得對其餘標籤(Uint8Array、Buffer、Map、Date等)讀鍵;
                //以標籤偽裝為各種內建類型之物件, 其ownKeys陷阱計次, 讀到即不符; 對照組: 標籤為Object者之ownKeys必被讀(由KINDS之ownKeys拋錯案證明)
                let wo = mk(`ctl-nokeys-${entry.key}`)
                let ob = mkObserver(wo)
                for (let tag of ['Uint8Array', 'Map', 'Date', 'Array Buffer', 'Set']) {
                    let n = 0
                    let p = new Proxy({ [Symbol.toStringTag]: tag, id: 'k1' }, {
                        ownKeys(t) {
                            n++
                            return Reflect.ownKeys(t)
                        },
                    })
                    let out = await ob.run(() => entry.call(wo, p))
                    assert.strict.equal(out.ok, true, tag)
                    assert.deepStrictEqual(out.val, entry.early(), tag)
                    assert.strict.equal(n, 0, `${tag}: ownKeys trap should not be called`)
                }
            })
        }
        it('array whose [1] getter throws: still rejects through the cloneDeep path (same channel; A3: fixed vocabulary, data null)', async function() {
            let wo = mk('ctl-elem1')
            let ob = mkObserver(wo)
            let a = [{ id: 'k0' }, 0]
            Object.defineProperty(a, '1', { get: boom('elem1-boom'), enumerable: true })
            let out = await ob.run(() => wo.insert(a))
            chkBlocked(out, 'insert', FIXED('data'))
            assert.strict.ok(!out.err.message.includes('elem1-boom'), 'the thrower\'s message is not echoed')
            assert.deepStrictEqual(await snap(wo), [])
        })
    })

    //error事件之訂閱函數於檢核路徑亦不致影響結果(既有規則: 訂閱函數自行拋錯不影響本次操作之結果): 訂閱函數自行拋錯時仍以檢核之錯誤reject
    describe('subscriber that throws does not change the outcome', function() {
        it('insert with unreadable data and a throwing error subscriber: still rejects with the readability error', async function() {
            let wo = mk('sub-throw', { logDetail: false, funLog: () => {} })
            wo.on('error', () => {
                throw new Error('subscriber-boom')
            })
            await assert.rejects(() => wo.insert(KINDS[0].mk()), (err) => err.message === FIXED('data'))
        })
    })
})
