import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { fileURLToPath } from 'url'
import wo from '../src/WOrmLowdb.mjs'
import diagCases from 'wsemi/src/_diagCases.mjs'
import { settle } from './tools/diagScenario.mjs'


//rulebook R-DIAG-01: 遮罩與診斷輸出之共用實作在wsemi(getDiag系列, 規則見wsemi帳本R-DIAG-01與dspec〈診斷輸出與遮罩〉), 本檔為本套件之接線測試:
//  A. 共用語料(wsemi/src/_diagCases.mjs)之wire案, 依本套件適用之子集, 經本套件之真實呼叫點執行(語料之形態類案由wsemi自測, 本套件不重複)
//  B. 對外錯誤值: 外來值(lowdb、檔案系統之錯誤與呼叫端資料觸發之拋錯)經diag.err/diag.mask移除憑證(7個整批站點+2個逐筆站點+error事件)
//  C. 對外錯誤值: 套件自身以固定詞彙組成之reject與逐筆err原樣(不經遮罩)
//  D. 儲存路徑不屬憑證: reject不遮、診斷輸出遮(Q3); 診斷輸出之串流(level)與paths宣告之等價形式
//  E. 站點全集之靜態盤點(帳本R-DIAG-01〈站點全集〉)
//測試名稱含[靜態]者為原始碼盤點, 其餘為行為測試(變異驗證時兩者分開計)


let dir = './test/_tmp/unit-diaglog-wire'
let srcFile = fileURLToPath(new URL('../src/WOrmLowdb.mjs', import.meta.url))

let SECRET = 'Zq9wXk7R' //測試用憑證值(非真實)
let nSeq = 0
let mkUrl = () => {
    nSeq++
    return `${dir}/db${nSeq}.json`
}
let mkOpt = (ex = {}) => {
    return { url: mkUrl(), db: 'worm', cl: 'users', ...ex }
}


//capture, 擷取console.log與console.error之引數(分開記錄, 以驗證串流)
async function capture(fn) {
    let logs = []
    let errs = []
    let others = []
    let oLog = console.log
    let oErr = console.error
    let oWarn = console.warn
    let oInfo = console.info
    console.log = (...a) => logs.push(a)
    console.error = (...a) => errs.push(a)
    console.warn = (...a) => others.push(['warn', a])
    console.info = (...a) => others.push(['info', a])
    let res
    try {
        res = await fn()
    }
    finally {
        console.log = oLog
        console.error = oErr
        console.warn = oWarn
        console.info = oInfo
    }
    return { res, logs, errs, others }
}


//rejectOf, 取reject之值(未reject者判失敗)
let rejectOf = async(pm) => {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('應reject卻resolve')
}


//stripComments, 去除區塊註解與單行註解(同unit-diaglog-wo之掃描法)
let stripComments = (s) => {
    let t = s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    return t.split(/\r?\n/).map((line) => line.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')
}
let count = (s, re) => (s.match(re) || []).length


//語料wire案之處置表(每個wire案必有一列, 新增之wire案未列入者由第一個測試判紅):
//  D=經error訂閱函數拋出, 由funLog之detail驗證; S=摘要(safe); L=logDetail之console輸出; R=對外reject; R-fs=真實檔案系統錯誤之reject與細節;
//  static=靜態盤點; na=不適用(附理由)
let WIRE = {
    T01: 'D',
    T07: 'D',
    K01: 'D',
    K09: 'D',
    V02: 'D',
    E01: 'D',
    E07: 'D',
    P01: 'D',
    S07: 'D',
    C01: 'S',
    O01: 'L',
    O15: 'static',
    R01: 'R',
    R11: 'R-fs',
    R02: 'na 本套件無連線網址秘密(paths不屬憑證, reject清單為空), 畸形網址片段無從登錄; 其精神(含憑證之外來錯誤: 副本、同類別、片段遮罩)由本檔B組以憑證樣式驗證',
    R04: 'na 本套件之reject清單無登錄之密碼, 字串reject僅套用樣式規則(語料T07, 本檔B組以字串拋出驗證)',
    R07: 'na 語料之src.password無法登錄於本套件; 其精神(固定詞彙reject原樣)由本檔C組以含憑證樣式之鍵名與主鍵驗證',
    R12: 'na 本套件無帳號概念(資料庫為本機JSON檔, 僅有儲存路徑)',
    A01: 'na 本套件不使用genDiagFunLog(伺服端轉接器)',
    A07: 'na 本套件不使用genDiagFunLog(伺服端轉接器)',
}


//ctx, 語料之測試上下文; 本套件之秘密為資料庫檔案位置, 故以其扮演語料之[密碼]角色:
//url取不存在之相對路徑(僅由select無效條件觸發error事件, 不讀寫檔案), 其絕對路徑、normalize後、暫存檔等皆已宣告(paths)
let SECURL = 'zzWireQ9x7Kd/zzDbQ9fileK'
let mkCtx = () => {
    let ctx = diagCases.mkCtx({ util: typeof process.getBuiltinModule === 'function' && process.getBuiltinModule('util') !== undefined })
    ctx.sec.password = SECURL
    return ctx
}
let getCase = (id) => {
    let c = diagCases.cases.find((v) => v.id === id)
    assert.ok(c !== undefined, `語料無案[${id}]`)
    return c
}


describe('diaglog-wire', function() {

    before(function() {
        fs.mkdirSync(dir, { recursive: true })
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
    })


    describe('A. 共用語料wire案之接線', function() {

        it('[靜態] 語料之wire案(20案)皆已於處置表登錄, 不得有未處置者', function() {
            let ids = diagCases.cases.filter((c) => c.wire).map((c) => c.id).sort()
            assert.deepStrictEqual(ids, Object.keys(WIRE).sort())
            assert.strictEqual(ids.length, 20)
            let kinds = {}
            Object.values(WIRE).forEach((v) => {
                kinds[v.split(' ')[0]] = (kinds[v.split(' ')[0]] || 0) + 1
            })
            assert.deepStrictEqual(kinds, { 'D': 9, 'S': 1, 'L': 1, 'static': 1, 'R': 1, 'R-fs': 1, 'na': 6 })
        })

        for (let id of Object.keys(WIRE).filter((k) => WIRE[k] === 'D')) {
            let c = getCase(id)
            it(`${id} ${c.label}: 經error訂閱函數拋出, funLog之detail符合語料期望(秘密以資料庫檔案位置扮演)`, async function() {
                let ctx = mkCtx()
                let thrown = c.make(ctx)
                let got = []
                let w = wo({ url: SECURL, funLog: (...a) => got.push(a) })
                w.on('error', () => {
                    throw thrown
                })
                let { logs, errs } = await capture(() => settle(w.select({ $foo: 1 })))
                assert.deepStrictEqual([logs, errs], [[], []], 'funLog存在時不寫console')
                assert.strictEqual(got.length, 1)
                assert.strictEqual(got[0][0], 'error handler threw')
                assert.strictEqual(got[0].length, 3)
                let r = diagCases.verify(c, got[0][2], ctx)
                assert.strictEqual(r, null, String(r))
                assert.strictEqual(fs.existsSync('zzWireQ9x7Kd'), false, '本案不得建立任何檔案')
            })
        }

        it('C01 摘要代碼: 錯誤之code依wsemi之集合(ECONNREFUSED、EAI_AGAIN、E2BIG收), 經本套件之safe站點', async function() {
            let c = getCase('C01')
            let ctx = mkCtx()
            let errs = c.make(ctx)
            let got = []
            let w = wo({ url: SECURL, funLog: (...a) => got.push(a) })
            let k = 0
            w.on('error', () => {
                throw errs[k]
            })
            for (k = 0; k < errs.length; k++) {
                await settle(w.select({ $foo: 1 }))
            }
            assert.strictEqual(got.length, 3)
            let out = got.map((v) => {
                let { mode, ...rest } = v[1]
                assert.strictEqual(mode, 'select')
                return rest
            })
            assert.strictEqual(diagCases.verify(c, out, ctx), null)
        })

        it('O01 logDetail: 有輸出且細節遮罩(console.log(標籤, 細節拷貝))', async function() {
            let c = getCase('O01')
            let ctx = mkCtx()
            let { detail } = c.make(ctx)
            assert.ok(detail instanceof Error)
            let w = wo({ url: SECURL, logDetail: true })
            w.on('error', () => {
                throw detail
            })
            let { logs, errs } = await capture(() => settle(w.select({ $foo: 1 })))
            assert.deepStrictEqual(errs, [])
            assert.strictEqual(logs.length, 1)
            assert.strictEqual(logs[0][0], 'error handler threw')
            assert.ok(logs[0][1] instanceof Error && logs[0].length === 2)
            let rs = [{ m: 'log', args: logs[0] }]
            assert.strictEqual(diagCases.verify({ expect: { noSecret: 'detail' } }, rs, ctx), null)
            assert.strictEqual(logs[0][1].message, 'auth ***')
        })

        it('[靜態] O15 safe白名單: 本套件宣告safeKeys恰為[mode], 且全部diag站點之safe只含mode與diag.brief之回傳', function() {
            let code = stripComments(fs.readFileSync(srcFile, 'utf8'))
            assert.strictEqual(count(code, /safeKeys: \['mode'\]/g), 1)
            assert.strictEqual(count(code, /safeKeys/g), 1)
            let sites = code.split('\n').filter((line) => /\bdiag\(/.test(line))
            assert.strictEqual(sites.length, 2)
            sites.forEach((line) => {
                assert.ok(/\{ mode, \.\.\.diag\.brief\(\w+\) \}/.test(line), line)
            })
        })

        it('R01 不含憑證之外來錯誤: reject為同一物件(身分不變), error事件之訊息原樣', async function() {
            let c = getCase('R01')
            let ctx = mkCtx()
            let e = c.make(ctx)
            let w = wo(mkOpt())
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            let err = await rejectOf(w.insert({
                id: 'a',
                get x() {
                    throw e
                }
            }))
            assert.strictEqual(diagCases.verify(c, [e, err], ctx), null)
            assert.deepStrictEqual(evs, [['insert', 'timeout']])
        })

        it('R11 儲存路徑不屬憑證(Q3): 真實檔案系統錯誤(資料夾不存在)之reject身分不變、err.path與訊息帶完整路徑; 同一錯誤經診斷細節時路徑遮罩', async function() {
            let c = getCase('R11')
            let url = `${dir}/nodir-r11/sub/db.json`
            let got = []
            let w = wo({ url, db: 'worm', cl: 'users', funLog: (...a) => got.push(a) })
            let seen = null
            w.on('error', (m, d, msg) => {
                if (m === 'insert') {
                    seen = msg
                }
            })
            let err = await rejectOf(w.insert({ id: 'a' }))
            assert.strictEqual(err.code, 'ENOENT')
            assert.ok(typeof err.path === 'string' && err.path.indexOf('db.json') >= 0 && err.path !== '***', `err.path=${err.path}`)
            assert.ok(err.message.indexOf(err.path) >= 0, err.message)
            assert.strictEqual(seen, err.message, 'error事件之訊息與reject同源, 路徑原樣')

            // 同一個錯誤物件經診斷細節(訂閱函數拋出該reject之值): 路徑遮罩
            w.on('error', () => {
                throw err
            })
            await settle(w.select({ $foo: 1 }))
            assert.strictEqual(got.length, 1)
            let detail = got[0][2]
            assert.ok(detail instanceof Error && detail !== err && err.path.indexOf('db.json') >= 0, '細節為副本, 不改動reject之錯誤物件')
            // 語料R11之期望: reject身分不變(o.r === o.e)、細節路徑為***且訊息不含路徑
            assert.strictEqual(c.expect.check({ r: err, e: err, c: detail, p: err.path }), true)
        })

        for (let id of Object.keys(WIRE).filter((k) => WIRE[k].startsWith('na'))) {
            it(`[靜態] ${id} 不適用本套件(處置表已載明理由)`, function() {
                assert.ok(WIRE[id].length > 20, '不適用須附理由')
                getCase(id)
            })
        }

    })


    describe('B. 外來值之對外錯誤: 憑證移除', function() {

        let BAD_JSON = `password=${SECRET} }`

        it('前提: 本Node版本之JSON.parse錯誤訊息帶出檔案內容片段(否則下列損毀檔案案例無意義)', function() {
            let msg = ''
            try {
                JSON.parse(BAD_JSON)
            }
            catch (err) {
                msg = err.message
            }
            assert.ok(msg.indexOf(SECRET) >= 0, msg)
        })

        let ops = [
            ['select', (w) => w.select()],
            ['selectByPk', (w) => w.selectByPk('a')],
            ['insert', (w) => w.insert({ id: 'a' })],
            ['insertBulk', (w) => w.insertBulk([{ id: 'a' }])],
            ['save', (w) => w.save({ id: 'a' })],
            ['del', (w) => w.del({ id: 'a' })],
            ['delAll', (w) => w.delAll()],
        ]
        for (let [name, call] of ops) {
            it(`${name}(整批站點): 損毀之資料庫檔(內容帶憑證鍵值對)使讀檔失敗, reject之SyntaxError與error事件之訊息皆已遮罩, 類別與其餘屬性保留`, async function() {
                let url = mkUrl()
                fs.writeFileSync(url, BAD_JSON)
                let w = wo({ url, db: 'worm', cl: 'users' })
                let evs = []
                w.on('error', (m, d, msg) => evs.push([m, msg]))
                let err = await rejectOf(call(w))
                assert.ok(err instanceof SyntaxError, String(err))
                assert.strictEqual(err.message.indexOf(SECRET), -1, err.message)
                assert.ok(err.message.indexOf('password=***') >= 0, err.message)
                assert.strictEqual(String(err.stack).indexOf(SECRET), -1, 'stack亦遮罩')
                assert.deepStrictEqual(evs, [[name, err.message]], 'error事件恰一次, 訊息與reject同源')
                assert.strictEqual(JSON.stringify(evs).indexOf(SECRET), -1)
            })
        }

        it('整批站點(使用端資料觸發之拋錯): 存取器拋出含網址帳密之錯誤, reject為同類別之副本、訊息帳密以***取代, 呼叫端原錯誤物件不被改動', async function() {
            let orig = new TypeError(`up mysql://root:${SECRET}@h/db end`)
            orig.code = 'EUP'
            let w = wo(mkOpt())
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            let err = await rejectOf(w.insertBulk([{
                id: 'a',
                get x() {
                    throw orig
                }
            }]))
            assert.notStrictEqual(err, orig)
            assert.ok(err instanceof TypeError && err.code === 'EUP')
            assert.strictEqual(err.message, 'up mysql://***@h/db end')
            assert.ok(orig.message.indexOf(SECRET) >= 0, '不得改動呼叫端之物件')
            assert.deepStrictEqual(evs, [['insertBulk', 'up mysql://***@h/db end']])
        })

        it('整批站點(使用端拋出字串): 字串reject經樣式遮罩(Bearer、token=、"password":)', async function() {
            let w = wo(mkOpt())
            let s = 'h Bearer abc.def t token=xyz123 j {"password":"qq"} a authorization: Basic dXNlcjpwdw=='
            let err = await rejectOf(w.insert({
                id: 'a',
                get x() {
                    throw s
                }
            }))
            assert.strictEqual(err, 'h Bearer *** t token=*** j {"password":"***"} a authorization: ***')
        })

        it('del逐筆站點: 繼承存取器id拋出含憑證之錯誤, 該筆ok為0、err已遮罩, error事件之訊息同', async function() {
            let w = wo(mkOpt())
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            class Item {}
            Object.defineProperty(Item.prototype, 'id', {
                enumerable: true,
                configurable: true,
                get() {
                    throw new Error(`up2 mysql://root:${SECRET}@h/db end`)
                }
            })
            let res = await w.del([new Item()])
            assert.deepStrictEqual(res, [{ n: 1, nDeleted: 0, ok: 0, err: 'up2 mysql://***@h/db end' }])
            assert.deepStrictEqual(evs, [['del', 'up2 mysql://***@h/db end']])
        })

        it('save逐筆站點: 合併階段(lodash merge讀繼承存取器)拋出含憑證之錯誤, 該筆ok為0、err已遮罩, error事件之訊息同', async function() {
            let w = wo(mkOpt())
            await w.insert({ id: 'k1', v: 1 })
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            class Item {
                constructor() {
                    this.id = 'k1'
                    this.v = 2
                }
            }
            Object.defineProperty(Item.prototype, 'note', {
                enumerable: true,
                configurable: true,
                get() {
                    if (new Error().stack.indexOf('merge') >= 0) {
                        throw new Error(`up3 mysql://root:${SECRET}@h/db end`)
                    }
                    return 'n'
                }
            })
            let res = await w.save([new Item()])
            assert.deepStrictEqual(res, [{ n: 1, nInserted: 0, nModified: 0, ok: 0, err: 'up3 mysql://***@h/db end' }])
            assert.deepStrictEqual(evs, [['save', 'up3 mysql://***@h/db end']])
        })

    })


    describe('C. 套件自身以固定詞彙組成之reject與逐筆err: 原樣(不經遮罩)', function() {

        //含憑證樣式之鍵名與主鍵: 若誤經遮罩會變成password=***(固定字串挖空)
        let KP = `password=${SECRET}`
        let KT = `token=${SECRET}`

        it('insertBulk主鍵衝突: reject與error事件之訊息逐字為固定詞彙加主鍵, 主鍵內之token=值不被遮', async function() {
            let w = wo(mkOpt())
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            await w.insert({ id: KT })
            let err = await rejectOf(w.insertBulk([{ id: KT }]))
            assert.strictEqual(err.message, `can not insertBulk by existed id[${KT}]`)
            assert.deepStrictEqual(evs, [['insertBulk', `can not insertBulk by existed id[${KT}]`]])
        })

        it('insert字串良構檢核: reject之路徑含憑證樣式鍵名時逐字原樣', async function() {
            let w = wo(mkOpt())
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            let err = await rejectOf(w.insert({ id: 'a', [KP]: '\ud800' }))
            let expected = `invalid data: string contains lone surrogate at [data[0].${KP}]`
            assert.strictEqual(err.message, expected)
            assert.deepStrictEqual(evs, [['insert', expected]])
        })

        it('insert與insertBulk之Date範圍檢核: reject之路徑含憑證樣式鍵名時逐字原樣', async function() {
            let w = wo(mkOpt())
            let err = await rejectOf(w.insert({ id: 'a', [KT]: new Date(8.64e15) }))
            assert.strictEqual(err.message, `invalid data: Date year is out of range 0000-9999 at [data[0]["${KT}"]]`)
        })

        it('select與delAll之條件檢核: reject與error事件之訊息(含憑證樣式之欄名)逐字原樣', async function() {
            let w = wo(mkOpt())
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            let expected = `invalid find: unsupported column name [${KT}] at [find.${KT}]`
            let e1 = await rejectOf(w.select({ [KT]: 1 }))
            let e2 = await rejectOf(w.delAll({ [KT]: 1 }))
            assert.strictEqual(e1.message, expected)
            assert.strictEqual(e2.message, expected)
            assert.deepStrictEqual(evs, [['select', expected], ['delAll', expected]])
        })

        it('save逐筆(字串良構之前置檢核)與合併階段之invalid data: 逐筆err逐字原樣, error事件之訊息同', async function() {
            let w = wo(mkOpt())
            await w.insert({ id: 'k1', v: 1 })
            let evs = []
            w.on('error', (m, d, msg) => evs.push([m, msg]))
            let e0 = `invalid data: string contains lone surrogate at [data[0].${KP}]`
            let e1 = `invalid data: string contains lone surrogate at [data[1].${KP}]`
            let res = await w.save([{ id: 'k1', [KP]: '\ud800' }, { id: 'k2', [KP]: '\ud800' }])
            assert.deepStrictEqual(res.map((v) => v.err), [e0, e1])
            assert.deepStrictEqual(evs, [['save', e0], ['save', e1]])

            // 合併階段: 首次讀取為良構, 合併時(lodash merge讀繼承存取器)才為孤立代理, 走save合併路徑之invalid data
            class Item {
                constructor() {
                    this.id = 'k1'
                    this.v = 3
                }
            }
            Object.defineProperty(Item.prototype, KP, {
                enumerable: true,
                configurable: true,
                get() {
                    return new Error().stack.indexOf('merge') >= 0 ? '\ud800' : 'ok'
                }
            })
            evs.length = 0
            let r2 = await w.save([new Item()])
            let e2 = `invalid data: string contains lone surrogate at [data[0].${KP}]`
            assert.deepStrictEqual(r2.map((v) => v.err), [e2])
            assert.deepStrictEqual(evs, [['save', e2]])
        })

        it('del逐筆之無效主鍵與procPk之固定詞彙: 逐字原樣', async function() {
            let w = wo(mkOpt({ autoGenPk: false }))
            let res = await w.del([{ id: '' }, { id: 5 }])
            assert.deepStrictEqual(res.map((v) => v.err), ['invalid id: string is empty at [data[0].id]', 'invalid id: not a string at [data[1].id]'])
            let err = await rejectOf(w.insert({ [KT]: 1 }))
            assert.strictEqual(err.message, 'can not insert by data[0] without valid id when autoGenPk is false')
        })

    })


    describe('D. 診斷輸出之串流與儲存路徑宣告', function() {

        it('level: change與error訂閱函數拋錯之診斷皆輸出至console.log(stdout), 不寫console.error或其他串流(預設與logDetail兩種)', async function() {
            for (let ex of [{}, { logDetail: true }]) {
                let w = wo(mkOpt(ex))
                w.on('change', () => {
                    throw new Error('c boom')
                })
                w.on('error', () => {
                    throw new Error('e boom')
                })
                let { logs, errs, others } = await capture(async() => {
                    await w.insert({ id: 'a' })
                    await settle(w.select({ $foo: 1 }))
                })
                assert.deepStrictEqual(errs, [], JSON.stringify(ex))
                assert.deepStrictEqual(others, [], JSON.stringify(ex))
                assert.deepStrictEqual(logs.map((v) => v[0]), ['change handler threw', 'error handler threw'], JSON.stringify(ex))
            }
        })

        it('paths宣告: 資料庫檔案位置之各等價形式(相對、絕對、斜線、JSON跳脫、file:///網址、百分比編碼、磁碟機代號大小寫、暫存檔)於funLog細節皆遮罩, 非路徑之文字保留', async function() {
            let got = []
            let url = `${dir}/目 錄Q9/db 1.json`
            fs.mkdirSync(`${dir}/目 錄Q9`, { recursive: true })
            let w = wo({ url, db: 'worm', cl: 'users', funLog: (...a) => got.push(a) })
            let abs = path.resolve(url)
            let fwd = abs.replace(/\\/g, '/')
            let tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp`)
            let swap = abs[0] === abs[0].toLowerCase() ? abs[0].toUpperCase() + abs.slice(1) : abs[0].toLowerCase() + abs.slice(1)
            let forms = [url, abs, fwd, JSON.stringify(abs).slice(1, -1), `file:///${encodeURI(fwd)}`, encodeURIComponent(abs), swap, tmp, path.normalize(url)]
            let k = 0
            w.on('change', () => {
                throw new Error(`keep-me ${forms[k]} end-${k}`)
            })
            for (k = 0; k < forms.length; k++) {
                await w.insert({ id: `a${k}` })
            }
            assert.strictEqual(got.length, forms.length)
            got.forEach((g, i) => {
                // file:///為scheme前綴, 不屬路徑, 保留
                let pre = forms[i].startsWith('file:///') ? 'file:///' : ''
                assert.strictEqual(g[2].message, `keep-me ${pre}*** end-${i}`, `形式${i}[${forms[i]}]`)
            })
        })

        it('自訂Error子類別與機器代碼: funLog之細節保留name與code(util.inspect顯示為Error, 副本不沿用使用端原型), safe之errType為Error(自訂類別名不外露)', async function() {
            class MyHandlerError extends Error {}
            let e = new MyHandlerError('sub x')
            e.code = 'ENOENT'
            let got = []
            let w = wo(mkOpt({ funLog: (...a) => got.push(a) }))
            w.on('change', () => {
                throw e
            })
            await w.insert({ id: 'a' })
            assert.strictEqual(got.length, 1)
            assert.deepStrictEqual(got[0][1], { mode: 'insert', errType: 'Error', errCode: 'ENOENT' })
            let d = got[0][2]
            assert.ok(d instanceof Error && !(d instanceof MyHandlerError))
            assert.strictEqual(d.name, 'MyHandlerError')
            assert.strictEqual(d.code, 'ENOENT')
        })

    })


    describe('E. 站點全集之靜態盤點(帳本R-DIAG-01)', function() {

        it('[靜態] 整批站點: catch內isErr=true者恰7處且皆為res = procErr(err)(select、selectByPk、insert、insertBulk、save、del、delAll), 無res = err', function() {
            let code = stripComments(fs.readFileSync(srcFile, 'utf8'))
            assert.strictEqual(count(code, /catch \(err\) \{\s*isErr = true\s*res = procErr\(err\)\s*\}/g), 7)
            assert.strictEqual(count(code, /isErr = true/g), 8, '另1處為select內isarr不成立之固定訊息(不可達, 套件自身固定詞彙)')
            assert.strictEqual(count(code, /res = err\b/g), 0)
        })

        it('[靜態] 逐筆站點: err欄位恰2處(save、del)且皆為procMsg(err), 無err: getErrMsg(err)', function() {
            let code = stripComments(fs.readFileSync(srcFile, 'utf8'))
            assert.strictEqual(count(code, /err: procMsg\(err\)/g), 2)
            assert.strictEqual(count(code, /err: getErrMsg\(/g), 0)
        })

        it('[靜態] 固定詞彙之錯誤: 以mkErr建立者恰6處throw(chkDataDate、procPk、procWellFormed、insertBulk主鍵衝突、save逐筆之前置檢核與合併階段各1), 其餘new Error僅3處(建構檢核、procFind之isoFind、select不可達之固定訊息)', function() {
            let code = stripComments(fs.readFileSync(srcFile, 'utf8'))
            assert.strictEqual(count(code, /throw mkErr\(/g), 6)
            let news = code.split('\n').filter((line) => /new Error\(/.test(line)).map((v) => v.trim())
            let prefixes = [
                'let err = new Error(msg)',
                'throw new Error(`invalid opt.',
                'throw new Error(`invalid find: Date year is out of range 0000-9999 at [',
                'res = new Error(`can not select by find[',
            ]
            assert.strictEqual(news.length, prefixes.length, news.join('\n'))
            prefixes.forEach((p, i) => {
                assert.ok(news[i].startsWith(p), news[i])
            })
        })

        it('[靜態] 站點外之錯誤出口: Promise.reject僅見res(整批站點之已處理值)與pf.err(procFind之固定詞彙), emitError僅見已處理值', function() {
            let code = stripComments(fs.readFileSync(srcFile, 'utf8'))
            let rejects = code.split('\n').filter((line) => /Promise\.reject\(/.test(line)).map((v) => v.trim())
            assert.strictEqual(rejects.length, 9)
            rejects.forEach((line) => {
                assert.ok(line === 'return Promise.reject(res)' || line === 'return Promise.reject(pf.err)', line)
            })
            let emits = code.split('\n').filter((line) => /\bemitError\(/.test(line) && !/let emitError/.test(line)).map((v) => v.trim())
            emits.forEach((line) => {
                assert.ok(/^emitError\((mode|'\w+'), (null|data|\[get\(data, k\)\]), (res|err|get\(rest, 'err'\))\)$/.test(line), line)
            })
            assert.strictEqual(emits.length, 10)
        })

    })

})
