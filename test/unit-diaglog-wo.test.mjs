import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import wo from '../src/WOrmLowdb.mjs'
import { scenario, settle } from './tools/diagScenario.mjs'


//rulebook R-DIAG-01: 診斷輸出(console)之預設安全與可控, 以真實JSON檔驗證WOrmLowdb整體(純函數見unit-diaglog.test.mjs)
//  R-DIAG-01-1 預設只輸出標籤與不含個資之摘要(不含資料值、id、使用端程式拋出之錯誤原文與堆疊、路徑)
//  R-DIAG-01-2 opt.logDetail為true還原舊版細節輸出(格式同舊版console.log(拋出之值)), 資料庫檔案位置(opt.url, 本套件之連線字串)一律以***遮罩
//  R-DIAG-01-3 opt.funLog(label, safe, detail)取代console收完整細節(資料庫檔案位置仍遮罩); 型別錯誤之選項忽略並用預設(同本套件其他選項)
//  R-DIAG-01-4 診斷輸出不得影響各操作之resolve/reject內容與事件payload及時機
//  R-DIAG-01-5 src內所有console輸出經單一出口(src/getDiag.mjs)
//  R-DIAG-01-6 建構函式之錯誤訊息不回顯opt.url(固定詞彙)


let dir = './test/_tmp/unit-diaglog-wo'

let ID = 'u-secret-001@example.com'
let NAME = 'AliceSecret'
let ERRTXT = 'handler exploded'
let SEC = 'SecretDirQ'


//mkOpt, 每個案例各用一個資料庫檔(檔名含SEC標記), 案後不需清理
let nSeq = 0
let mkUrl = () => {
    nSeq++
    return `${dir}/${SEC}/db${nSeq}.json`
}
let mkOpt = (ex = {}) => {
    return { url: mkUrl(), db: 'worm', cl: 'users', ...ex }
}


//capture, 擷取console各方法之輸出(以util.format格式化, 與實際輸出一致)
async function capture(fn) {
    let lines = []
    let ks = ['log', 'info', 'warn', 'error', 'debug']
    let olds = ks.map((k) => console[k])
    ks.forEach((k) => {
        console[k] = (...a) => lines.push(util.format(...a))
    })
    let res
    try {
        res = await fn()
    }
    finally {
        ks.forEach((k, i) => {
            console[k] = olds[i]
        })
    }
    return { res, lines }
}


//noData, 預設輸出不得含資料值、id、使用端程式拋出之錯誤原文與路徑
let noData = (text, o, msg = '') => {
    let abs = path.resolve(o.url)
    for (let s of [ID, NAME, 'u-secret', ERRTXT, 'listener', SEC, o.url, abs, abs.replace(/\\/g, '/'), process.cwd(), path.resolve('.').replace(/\\/g, '/'), 'at Object', 'at new ']) {
        assert.ok(text.indexOf(s) < 0, `${msg}輸出含不該出現之內容[${s}]: ${text.slice(0, 400)}`)
    }
}


//stripLineComment, 去除行尾單行註解: 只在//之前為行首或空白時才視為註解(字串內之http://不是註解)
let stripLineComment = (line) => line.replace(/(^|\s)\/\/.*$/, '$1')


//isOutputCode, 該行(已排除區塊註解者)是否為實際寫console、process.stdout/stderr或emitWarning之程式
let isOutputCode = (line) => {
    let code = stripLineComment(line)
    return /\bconsole\s*[.[]/.test(code) || /process\s*\.\s*(stdout|stderr)/.test(code) || /emitWarning/.test(code)
}


//golden, 回傳契約之固定預期值: 以修改前之程式(git HEAD)執行tools/diagScenario.mjs之情境所得(不含R-DIAG-01新功能), 與本檔無關之程式不得改動它
let golden = JSON.parse(fs.readFileSync('./test/tools/diagGolden.json', 'utf8'))


describe('diaglog-wo', function() {

    before(function() {
        fs.mkdirSync(`${dir}/${SEC}`, { recursive: true })
    })

    after(function() {
        fs.rmSync(dir, { recursive: true, force: true })
    })


    describe('單一出口(R-DIAG-01-5)', function() {

        it('R-DIAG-01-5 src內除getDiag.mjs外不得直接呼叫console或寫process.stdout/stderr或emitWarning(所有診斷輸出經單一出口)', function() {
            let bads = []
            let n = 0
            for (let f of fs.readdirSync('./src')) {
                if (!/\.(mjs|js)$/.test(f) || f === 'getDiag.mjs') {
                    continue
                }
                n++
                let s = fs.readFileSync(`./src/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
                s.split(/\r?\n/).forEach((line, k) => {
                    if (isOutputCode(line)) {
                        bads.push(`${f}:${k + 1} ${line.trim().slice(0, 80)}`)
                    }
                })
            }
            assert.ok(n >= 1 && fs.existsSync('./src/WOrmLowdb.mjs'), `掃描檔數過少: ${n}`)
            assert.deepStrictEqual(bads, [], `下列站點未經單一出口:\n${bads.join('\n')}`)
        })

        it('R-DIAG-01-5 getDiag.mjs之console呼叫只在diag內(其餘函數不寫console), 且全檔不寫process.stdout/stderr、不呼叫emitWarning', function() {
            let s = fs.readFileSync('./src/getDiag.mjs', 'utf8')
            let i0 = s.indexOf('function getDiag(')
            let i1 = s.indexOf('function isErrCode(')
            assert.ok(i0 > 0 && i1 > i0)
            let outside = s.slice(0, i0) + s.slice(i1)
            let bad = outside.split(/\r?\n/).filter((line) => isOutputCode(line))
            assert.deepStrictEqual(bad, [])
            let others = s.split(/\r?\n/).filter((line) => /process\s*\.\s*(stdout|stderr)/.test(stripLineComment(line)) || /emitWarning/.test(stripLineComment(line)))
            assert.deepStrictEqual(others, [])
        })

        it('R-DIAG-01-5 掃描器自身之判定: 字串內含http://者其後之console呼叫仍被偵測, 註解與區塊註解內者不計', function() {
            assert.ok(isOutputCode('let u = \'http://x\'; console.log(u)'))
            assert.ok(isOutputCode('    console.log(err)'))
            assert.ok(isOutputCode('    process.stderr.write(\'x\')'))
            assert.ok(isOutputCode('    process.emitWarning(\'x\')'))
            assert.ok(!isOutputCode('    // console.log(err)'))
            assert.ok(!isOutputCode('    let a = 1 // console.log(err)'))
            assert.ok(!isOutputCode('    let a = 1'))
        })

        it('R-DIAG-01-5 WOrmLowdb.mjs內diag之呼叫恰2處(change與error訂閱函數拋錯), 與盤點一致', function() {
            let s = fs.readFileSync('./src/WOrmLowdb.mjs', 'utf8')
            let calls = s.split(/\r?\n/).filter((line) => /\bdiag\(/.test(line.replace(/\/\/.*$/, '')))
            assert.strictEqual(calls.length, 2, calls.join('\n'))
            assert.ok(calls[0].indexOf('change handler threw') >= 0 && calls[1].indexOf('error handler threw') >= 0)
        })

    })


    describe('預設(R-DIAG-01-1)', function() {

        it('change訂閱函數拋錯: 輸出有標籤與操作別, 不含資料值、id、錯誤原文、路徑; insert之resolve不變', async function() {
            let o = mkOpt()
            let w = wo(o)
            w.on('change', () => {
                throw new Error(`listener ${ID} ${NAME} ${ERRTXT} ${o.url}`)
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME, value: 1 })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.strictEqual(lines.length, 1, lines.join('|'))
            assert.ok(lines[0].indexOf('change handler threw') >= 0 && lines[0].indexOf('insert') >= 0 && lines[0].indexOf('Error') >= 0, lines[0])
            noData(lines.join('\n'), o)
        })

        it('error訂閱函數拋錯: 輸出不含訂閱函數之錯誤原文與find內容; select之reject不變', async function() {
            let o = mkOpt()
            let w = wo(o)
            w.on('error', () => {
                throw new Error(`listener ${ID} ${ERRTXT}`)
            })
            let { res, lines } = await capture(() => settle(w.select({ $foo: ID })))
            assert.ok(res.err !== undefined && res.err.indexOf('invalid find: unsupported operator [$foo]') === 0, JSON.stringify(res))
            assert.strictEqual(lines.length, 1, lines.join('|'))
            assert.ok(lines[0].indexOf('error handler threw') >= 0 && lines[0].indexOf('select') >= 0, lines[0])
            noData(lines.join('\n'), o)
        })

        it('拋出之值為字串、物件、null、undefined、數字、帶機器代碼之Error: 摘要只列型別與代碼, 內容不輸出', async function() {
            let o = mkOpt()
            let w = wo(o)
            let throwing = [
                [`str ${ID} ${ERRTXT}`, 'string'],
                [{ id: ID, name: NAME, msg: ERRTXT }, 'object'],
                [null, 'null'],
                [undefined, 'undefined'],
                [12345, 'number'],
                [Object.assign(new Error(`${ID} ${ERRTXT}`), { code: 'ENOENT', path: o.url }), 'Error'],
            ]
            let k = 0
            w.on('change', () => {
                throw throwing[k][0]
            })
            for (k = 0; k < throwing.length; k++) {
                let { res, lines } = await capture(() => settle(w.insert({ id: `${ID}${k}`, name: NAME })))
                assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
                assert.strictEqual(lines.length, 1, lines.join('|'))
                assert.ok(lines[0].indexOf(`errType: '${throwing[k][1]}'`) >= 0, `${k}: ${lines[0]}`)
                if (k === throwing.length - 1) {
                    assert.ok(lines[0].indexOf('errCode: \'ENOENT\'') >= 0, lines[0])
                }
                noData(lines.join('\n'), o, `案${k} `)
            }
        })

        it('未拋錯之各操作無任何console輸出(成功與失敗之操作皆然, 含有訂閱函數但不拋錯)', async function() {
            let o = mkOpt()
            let w = wo(o)
            let { res, lines } = await capture(() => scenario(w, false))
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(res.out.length, 22)
        })

        it('選項型別錯誤者忽略並用預設(不拋錯、不洩漏): logDetail為字串或1或物件或false、funLog為字串或物件或null', async function() {
            for (let ex of [{ logDetail: 'true' }, { logDetail: 1 }, { logDetail: {} }, { logDetail: false }, { funLog: 'x' }, { funLog: {} }, { funLog: null }, { logDetail: 'yes', funLog: 123 }]) {
                let o = mkOpt(ex)
                let w = wo(o)
                w.on('change', () => {
                    throw new Error(`listener ${ID} ${ERRTXT}`)
                })
                let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
                assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } }, JSON.stringify(ex))
                assert.strictEqual(lines.length, 1, JSON.stringify(ex))
                noData(lines.join('\n'), o, `${JSON.stringify(ex)} `)
            }
        })

        it('讀取選項拋錯(opt之getter)者忽略該選項, 建構不拋錯, 預設輸出', async function() {
            let base = mkOpt()
            let o = new Proxy(base, {
                get(t, k) {
                    if (k === 'logDetail' || k === 'funLog') {
                        throw new Error('getter boom')
                    }
                    return t[k]
                }
            })
            let w = wo(o)
            w.on('change', () => {
                throw new Error(`listener ${ID}`)
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.strictEqual(lines.length, 1)
            noData(lines.join('\n'), base)
        })

        it('R-DIAG-01-6 建構函式之錯誤訊息為固定詞彙, 不回顯opt.url(含孤立代理字元者)', function() {
            let urlBad = `${dir}/${SEC}/bad\ud800.json`
            let err = null
            try {
                wo({ url: urlBad })
            }
            catch (e) {
                err = e
            }
            assert.ok(err instanceof Error && Object.getPrototypeOf(err) === Error.prototype)
            assert.strictEqual(err.message, 'invalid opt.url: string contains lone surrogate')
            assert.ok(err.message.indexOf(SEC) < 0 && String(err.stack).split('\n')[0].indexOf(SEC) < 0)
            for (let k of ['db', 'cl']) {
                let e2 = null
                try {
                    wo({ url: mkUrl(), [k]: `x${SEC}\ud800` })
                }
                catch (e) {
                    e2 = e
                }
                assert.strictEqual(e2 && e2.message, `invalid opt.${k}: string contains lone surrogate`)
                assert.ok(e2.message.indexOf(SEC) < 0)
            }
        })

    })


    describe('funLog(R-DIAG-01-3)', function() {

        it('change訂閱函數拋錯: funLog收(label, safe, detail), detail為完整錯誤(含id與原文)但資料庫檔案位置遮罩; 不寫console', async function() {
            let got = []
            let o = mkOpt({ funLog: (...a) => got.push(a) })
            let abs = path.resolve(o.url)
            let w = wo(o)
            let err = new Error(`listener ${ID} ${NAME} ${ERRTXT} url=${o.url} abs=${abs}`)
            err.code = 'ENOENT'
            err.path = abs
            w.on('change', () => {
                throw err
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
            let [label, safe, detail] = got[0]
            assert.strictEqual(label, 'change handler threw')
            assert.deepStrictEqual(safe, { mode: 'insert', errType: 'Error', errCode: 'ENOENT' })
            assert.ok(detail instanceof Error && detail !== err)
            assert.ok(detail.message.indexOf(ID) >= 0 && detail.message.indexOf(NAME) >= 0 && detail.message.indexOf(ERRTXT) >= 0, '細節應含完整原文')
            assert.strictEqual(detail.message, 'listener u-secret-001@example.com AliceSecret handler exploded url=*** abs=***')
            assert.strictEqual(detail.path, '***')
            assert.strictEqual(detail.code, 'ENOENT')
            assert.ok(typeof detail.stack === 'string' && detail.stack.indexOf(SEC) < 0)
            assert.ok(err.message.indexOf(SEC) >= 0, '不得改動拋出之原物件')
        })

        it('error訂閱函數拋錯: funLog收(label, safe, detail), detail為完整錯誤, 不寫console; select之reject不變', async function() {
            let got = []
            let o = mkOpt({ funLog: (...a) => got.push(a) })
            let w = wo(o)
            w.on('error', () => {
                throw new Error(`listener ${ID} ${ERRTXT}`)
            })
            let { res, lines } = await capture(() => settle(w.select({ $foo: ID })))
            assert.ok(res.err !== undefined && res.err.indexOf('invalid find: unsupported operator [$foo]') === 0)
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
            let [label, safe, detail] = got[0]
            assert.strictEqual(label, 'error handler threw')
            assert.deepStrictEqual(safe, { mode: 'select', errType: 'Error' })
            assert.ok(detail instanceof Error && detail.message === `listener ${ID} ${ERRTXT}`, String(detail && detail.message))
        })

        it('拋出之值非Error: detail為其遮罩拷貝(字串原樣、物件為普通物件拷貝、null與undefined原樣), safe只列型別', async function() {
            let got = []
            let o = mkOpt({ funLog: (...a) => got.push(a) })
            let abs = path.resolve(o.url)
            let w = wo(o)
            let vals = [`s ${ID} ${abs}`, { id: ID, loc: abs, list: [NAME, abs] }, null, undefined]
            let k = 0
            w.on('change', () => {
                throw vals[k]
            })
            for (k = 0; k < vals.length; k++) {
                await settle(w.insert({ id: `${ID}${k}`, name: NAME }))
            }
            assert.strictEqual(got.length, 4)
            assert.deepStrictEqual(got.map((v) => v[1]), [{ mode: 'insert', errType: 'string' }, { mode: 'insert', errType: 'object' }, { mode: 'insert', errType: 'null' }, { mode: 'insert', errType: 'undefined' }])
            assert.strictEqual(got[0][2], `s ${ID} ***`)
            assert.deepStrictEqual(got[1][2], { id: ID, loc: '***', list: [NAME, '***'] })
            assert.strictEqual(got[2][2], null)
            assert.strictEqual(got[3][2], undefined)
            assert.strictEqual(got[3].length, 3, 'undefined之細節仍作為第3個引數傳入(舊版console.log(undefined)亦輸出)')
        })

        it('funLog存在時logDetail不另寫console(funLog取代console)', async function() {
            let got = []
            let w = wo(mkOpt({ logDetail: true, funLog: (...a) => got.push(a) }))
            w.on('change', () => {
                throw new Error('x')
            })
            let { lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(lines, [])
            assert.strictEqual(got.length, 1)
        })

        it('R-DIAG-01-4 funLog拋錯或回傳reject之promise: 各操作結果不變, 不產生unhandledRejection', async function() {
            let bad = []
            let fnU = (e) => bad.push(e)
            process.on('unhandledRejection', fnU)
            try {
                let n = 0
                for (let funLog of [() => {
                    n++
                    throw new Error('funLog boom')
                }, () => {
                    n++
                    return Promise.reject(new Error('funLog rejected'))
                }]) {
                    let n0 = n
                    let w = wo(mkOpt({ funLog }))
                    w.on('change', () => {
                        throw new Error('listener')
                    })
                    let r = await settle(w.insert({ id: ID, name: NAME }))
                    assert.deepStrictEqual(r, { ok: { n: 1, nInserted: 1, ok: 1 } })
                    assert.ok(n - n0 >= 1, `funLog未被呼叫: ${n - n0}`)
                }
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            finally {
                process.off('unhandledRejection', fnU)
            }
            assert.deepStrictEqual(bad.map((v) => String(v && v.message)), [])
        })

    })


    describe('logDetail(R-DIAG-01-2)', function() {

        it('還原舊版輸出格式: 拋出之值各以console.log(值)一行輸出, 不加標籤(輸出與util.format(值)相同)', async function() {
            let plain = new Error(`plain listener ${ID}`)
            let withProps = Object.assign(new Error(`props ${ID}`), { code: 'EACCES', info: { id: ID, tags: ['a', 'b'] } })
            let withCause = new Error('outer', { cause: new Error(`inner ${NAME}`) })
            class MyHandlerError extends Error {}
            let sub = new MyHandlerError(`sub ${ID}`)
            let vals = [plain, withProps, withCause, sub, `str ${ID}`, { id: ID, nested: { a: [1, 2, { b: NAME }] } }, null, undefined, 42, [ID, NAME]]
            let o = mkOpt({ logDetail: true })
            let w = wo(o)
            let k = 0
            w.on('change', () => {
                throw vals[k]
            })
            for (k = 0; k < vals.length; k++) {
                let { res, lines } = await capture(() => settle(w.insert({ id: `${ID}${k}`, name: NAME })))
                assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
                assert.deepStrictEqual(lines, [util.format(vals[k])], `案${k}與舊版console.log(值)不同`)
            }
        })

        it('資料庫檔案位置遮罩: 拋出之值內的相對與絕對路徑(含屬性值、屬性鍵、巢狀)一律***', async function() {
            let o = mkOpt({ logDetail: true })
            let abs = path.resolve(o.url)
            let w = wo(o)
            let e = new Error(`open ${o.url} then ${abs} then ${abs.replace(/\\/g, '/')} id=${ID}`)
            e.path = abs
            e.nested = { list: [o.url, { deep: `x${abs}y` }] }
            e[abs] = 1
            w.on('change', () => {
                throw e
            })
            let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(res, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.strictEqual(lines.length, 1)
            let text = lines[0]
            assert.ok(text.indexOf(SEC) < 0 && text.indexOf(abs) < 0 && text.indexOf(o.url) < 0, text.slice(0, 500))
            assert.ok(text.indexOf(ID) >= 0 && text.indexOf('***') >= 0, '非路徑之細節應保留')
            assert.ok(text.split('\n')[0].startsWith('Error: open *** then *** then *** id=u-secret-001@example.com'), text.split('\n')[0])
        })

        it('error訂閱函數拋錯: 還原原文輸出', async function() {
            let w = wo(mkOpt({ logDetail: true }))
            w.on('error', () => {
                throw new Error(`plain error listener ${ID}`)
            })
            let { lines } = await capture(() => settle(w.select({ $foo: 1 })))
            assert.strictEqual(lines.length, 1)
            assert.strictEqual(lines[0].split('\n')[0], `Error: plain error listener ${ID}`)
        })

        it('情境對照: 訂閱函數拋錯19次之輸出行數與每行首行同修改前(git HEAD)之固定預期值', async function() {
            let w = wo(mkOpt({ logDetail: true }))
            let { lines } = await capture(() => scenario(w, true))
            assert.strictEqual(golden.badConsoleCount, 19)
            assert.strictEqual(lines.length, golden.badConsoleCount)
            assert.deepStrictEqual(lines.map((v) => v.split('\n')[0]), golden.badConsoleFirstLines)
        })

    })


    describe('error站點、暫存檔與選項快照(R-DIAG-01-2、R-DIAG-01-3)', function() {

        let tmpOf = (f) => path.join(path.dirname(f), `.${path.basename(f)}.tmp`)

        it('error訂閱函數拋出含資料庫檔案位置之錯誤(相對、絕對、normalize後、steno暫存檔): 預設不輸出; logDetail與funLog之細節皆為***', async function() {
            for (let ch of ['default', 'logDetail', 'funLog']) {
                let got = []
                let o = mkOpt(ch === 'logDetail' ? { logDetail: true } : (ch === 'funLog' ? { funLog: (...a) => got.push(a) } : {}))
                let abs = path.resolve(o.url)
                let text = `rel=${o.url} abs=${abs} norm=${path.normalize(o.url)} tmp=${tmpOf(abs)} tmprel=${tmpOf(o.url)} id=${ID}`
                let w = wo(o)
                w.on('error', () => {
                    throw new Error(`listener ${text}`)
                })
                let { res, lines } = await capture(() => settle(w.select({ $foo: 1 })))
                assert.ok(res.err !== undefined && res.err.indexOf('invalid find') === 0, ch)
                if (ch === 'default') {
                    assert.strictEqual(lines.length, 1)
                    assert.ok(lines[0].indexOf('error handler threw') >= 0)
                    noData(lines.join('\n'), o, 'error站點 ')
                }
                else if (ch === 'logDetail') {
                    assert.strictEqual(lines.length, 1)
                    assert.strictEqual(lines[0].split('\n')[0], `Error: listener rel=*** abs=*** norm=*** tmp=*** tmprel=*** id=${ID}`)
                }
                else {
                    assert.deepStrictEqual(lines, [])
                    assert.strictEqual(got.length, 1)
                    assert.strictEqual(got[0][0], 'error handler threw')
                    assert.strictEqual(got[0][2].message, `listener rel=*** abs=*** norm=*** tmp=*** tmprel=*** id=${ID}`)
                    assert.ok(got[0][2].stack.indexOf(SEC) < 0)
                }
            }
        })

        it('真實寫檔失敗(資料庫所在資料夾不存在, lowdb底層steno寫暫存檔失敗): error訂閱函數拋出該系統錯誤時, 暫存檔路徑亦遮罩, 三管道皆不外洩', async function() {
            let n = 0
            for (let ch of ['default', 'logDetail', 'funLog']) {
                n++
                let got = []
                let url = `${dir}/${SEC}/nodir${n}/sub/db.json`
                let o = { url, db: 'worm', cl: 'users', ...(ch === 'logDetail' ? { logDetail: true } : (ch === 'funLog' ? { funLog: (...a) => got.push(a) } : {})) }
                let w = wo(o)
                w.on('error', (mode, data, err) => {
                    throw new Error(`saw: ${err}`)
                })
                let { res, lines } = await capture(() => settle(w.insert({ id: ID, name: NAME })))
                assert.ok(res.err !== undefined && res.err.indexOf('ENOENT') >= 0, `${ch}: 應因資料夾不存在而reject: ${JSON.stringify(res)}`)
                if (ch === 'default') {
                    assert.strictEqual(lines.length, 1)
                    noData(lines.join('\n'), o, '真實寫檔失敗 ')
                }
                else if (ch === 'logDetail') {
                    assert.strictEqual(lines.length, 1)
                    assert.strictEqual(lines[0].split('\n')[0], 'Error: saw: ENOENT: no such file or directory, open \'***\'', lines[0].split('\n')[0])
                }
                else {
                    assert.deepStrictEqual(lines, [])
                    assert.strictEqual(got.length, 1)
                    assert.strictEqual(got[0][2].message, 'saw: ENOENT: no such file or directory, open \'***\'')
                }
            }
        })

        it('選項為建構時之快照: 建構後改動或移除opt.logDetail與opt.funLog不影響其後之診斷輸出, 且opt之getter只於建構時讀取', async function() {
            let o = mkOpt()
            let w = wo(o)
            let got = []
            o.logDetail = true
            o.funLog = (...a) => got.push(a)
            w.on('change', () => {
                throw new Error(`listener ${ID}`)
            })
            let a = await capture(() => settle(w.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(got, [])
            assert.strictEqual(a.lines.length, 1)
            noData(a.lines.join('\n'), o, '快照(預設) ')

            let got2 = []
            let o2 = mkOpt({ funLog: (...x) => got2.push(x) })
            let w2 = wo(o2)
            delete o2.funLog
            o2.logDetail = true
            w2.on('change', () => {
                throw new Error(`listener ${ID}`)
            })
            let b = await capture(() => settle(w2.insert({ id: ID, name: NAME })))
            assert.deepStrictEqual(b.lines, [])
            assert.strictEqual(got2.length, 1)

            let n = 0
            let o3 = mkOpt()
            Object.defineProperty(o3, 'logDetail', {
                get() {
                    n++
                    return n !== 1
                },
                enumerable: true
            })
            let w3 = wo(o3)
            let n0 = n
            w3.on('change', () => {
                throw new Error(`listener ${ID}`)
            })
            let c = await capture(async () => {
                await settle(w3.insert({ id: `${ID}1`, name: NAME }))
                await settle(w3.insert({ id: `${ID}2`, name: NAME }))
            })
            assert.strictEqual(n, n0, '建構後不得再讀opt.logDetail')
            assert.strictEqual(c.lines.length, 2)
            noData(c.lines.join('\n'), o3, '快照(getter) ')
        })

    })


    describe('回傳契約不變(R-DIAG-01-4)', function() {

        it('預設、logDetail、funLog、選項型別錯誤、訂閱函數拋錯: 各操作之resolve/reject內容與事件payload與修改前(git HEAD)之固定預期值完全相同', async function() {
            let funLogThrows = () => {
                throw new Error('funLog boom')
            }
            let configs = [
                ['default', {}, false],
                ['logDetail', { logDetail: true }, false],
                ['funLog', { funLog: () => {} }, false],
                ['badOpt', { logDetail: 'yes', funLog: 'x' }, false],
                ['badListener+default', {}, true],
                ['badListener+logDetail', { logDetail: true }, true],
                ['badListener+funLog', { funLog: () => {} }, true],
                ['badListener+funLogThrows', { funLog: funLogThrows }, true],
                ['badListener+badOpt', { logDetail: 'yes', funLog: 'x' }, true],
            ]
            for (let k of ['plain', 'bad', 'cache', 'noAutoPk']) {
                let g = golden[k]
                assert.ok(g.out.length === 22 && g.evs.length >= 15 && g.seq.length === g.out.length + g.evs.length, `golden(${k})形狀不符`)
                assert.ok(g.out.some((v) => v.err !== undefined && v.isError === true && v.name === 'Error') && g.out.some((v) => v.ok !== undefined), `golden(${k})應含Error型別之reject與成功結果`)
            }
            //變體: 預設設定、useCache、autoGenPk為false(與診斷輸出選項正交); 訂閱函數拋錯者只跑預設設定(對照golden.bad)
            let variants = [['plain', {}], ['cache', { useCache: true }], ['noAutoPk', { autoGenPk: false }]]
            for (let [name, ex, bad] of configs) {
                for (let [vk, vex] of bad ? [['bad', {}]] : variants) {
                    let w = wo(mkOpt({ ...vex, ...ex }))
                    let { res } = await capture(() => scenario(w, bad))
                    let snap = JSON.parse(JSON.stringify(res))
                    assert.deepStrictEqual(snap, golden[vk], `${name}/${vk} 與修改前之固定預期值不同(含reject之錯誤名稱與型別、事件與結果之交錯時序)`)
                }
            }
        })

        it('訂閱函數拋錯: 第一個訂閱函數拋錯即中斷該次emit, 其後之訂閱函數不執行(與修改前相同, eventemitter3之行為); 事件皆於該次操作結果定案前發出', async function() {
            let w = wo(mkOpt())
            let seen = []
            w.on('change', () => {
                seen.push('c1')
                throw new Error('first')
            })
            w.on('change', () => {
                seen.push('c2')
            })
            w.on('error', () => {
                seen.push('e1')
                throw new Error('first')
            })
            w.on('error', () => {
                seen.push('e2')
            })
            let { res } = await capture(async () => {
                let a = await settle(w.insert({ id: ID, name: NAME }))
                let n1 = seen.slice()
                let b = await settle(w.select({ $foo: 1 }))
                return { a, b, n1, n2: seen.slice() }
            })
            assert.deepStrictEqual(res.a, { ok: { n: 1, nInserted: 1, ok: 1 } })
            assert.ok(res.b.err.indexOf('invalid find') === 0)
            assert.deepStrictEqual(res.n1, ['c1'], 'insert結果定案時change事件已發出, 且c2不執行')
            assert.deepStrictEqual(res.n2, ['c1', 'e1'], 'select結果定案時error事件已發出, 且e2不執行')
        })

    })

})
