import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { getOptLog, getDiag, getBriefErr, getSecrets, maskText, cpMask } from '../src/getDiag.mjs'
import * as diagNs from '../src/getDiag.mjs'


//rulebook R-DIAG-01: 診斷輸出單一出口(src/getDiag.mjs)之純函數測試, 不讀寫資料庫
//對應: 預設只輸出標籤與不含個資之摘要(R-DIAG-01-1)、logDetail還原細節且資料庫檔案位置遮罩(R-DIAG-01-2)、funLog收完整細節(R-DIAG-01-3)、輸出不得使呼叫端拋錯(R-DIAG-01-4)


//本套件無帳號與密碼, 資料庫檔案位置(opt.url, 相對與絕對路徑)即連線字串, 以SEC標記之
let SEC = 'SecretDirQ'
let URL_REL = `./data/${SEC}/lowdb.json`
let URL_ABS = `D:\\work\\${SEC}\\lowdb.json`
let ID = 'u-secret-001@example.com'


//cap, 擷取console各方法之輸出(以util.format格式化, 與實際輸出一致: Error之message、stack、cause與Symbol鍵皆可見)
function cap(fn) {
    let lines = []
    let ks = ['log', 'info', 'warn', 'error', 'debug']
    let olds = ks.map((k) => console[k])
    ks.forEach((k) => {
        console[k] = (...a) => lines.push(util.format(...a))
    })
    try {
        fn()
    }
    finally {
        ks.forEach((k, i) => {
            console[k] = olds[i]
        })
    }
    return lines
}


describe('getOptLog', function() {

    it('R-DIAG-01-3 未給或型別錯誤者忽略並用預設(與本套件其他選項型別錯誤之處理一致: 不拋錯)', function() {
        for (let o of [undefined, null, {}, 1, 'x', { logDetail: 'true' }, { logDetail: 1 }, { logDetail: {} }, { funLog: 'x' }, { funLog: {} }, { funLog: null }]) {
            assert.deepStrictEqual(getOptLog(o), { logDetail: false, funLog: null }, JSON.stringify(o))
        }
    })

    it('R-DIAG-01-3 logDetail為true、funLog為函數才生效', function() {
        let f = () => {}
        assert.deepStrictEqual(getOptLog({ logDetail: true, funLog: f }), { logDetail: true, funLog: f })
        assert.deepStrictEqual(getOptLog({ logDetail: false }), { logDetail: false, funLog: null })
    })

    it('R-DIAG-01-3 讀取選項拋錯者忽略該選項, 不連累另一個有效選項', function() {
        let f = () => {}
        let o1 = {
            get logDetail() {
                throw new Error('x')
            },
            funLog: f
        }
        assert.deepStrictEqual(getOptLog(o1), { logDetail: false, funLog: f })
        let o2 = {
            logDetail: true,
            get funLog() {
                throw new Error('x')
            }
        }
        assert.deepStrictEqual(getOptLog(o2), { logDetail: true, funLog: null })
    })

})


describe('getDiag', function() {

    it('R-DIAG-01-1 預設只輸出標籤與摘要, 不呼叫getDetail(細節在預設路徑不被取得)', function() {
        let n = 0
        let diag = getDiag(getOptLog({}))
        let lines = cap(() => {
            diag('L1', { mode: 'insert', errType: 'Error' }, () => {
                n++
                return `detail ${ID}`
            })
            diag('L2', undefined, () => {
                n++
                return ID
            })
            diag('L3')
        })
        assert.deepStrictEqual(lines, ['L1 { mode: \'insert\', errType: \'Error\' }', 'L2', 'L3'])
        assert.strictEqual(n, 0)
    })

    it('R-DIAG-01-2 logDetail為true時還原細節: 標籤加細節; bare者只輸出細節(與舊版該站之console.log(細節)相同)', function() {
        let diag = getDiag(getOptLog({ logDetail: true }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => `detail ${ID}`)
            diag('L2', { a: 1 }, () => `bare ${ID}`, true)
            diag('L3', undefined)
        })
        assert.deepStrictEqual(lines, [`L1 detail ${ID}`, `bare ${ID}`, 'L3'])
    })

    it('R-DIAG-01-3 funLog收(label, safe, detail), 不寫console; 無細節者只收兩個引數', function() {
        let got = []
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => ({ id: ID }))
            diag('L2', undefined)
        })
        assert.deepStrictEqual(lines, [])
        assert.strictEqual(got.length, 2)
        assert.deepStrictEqual(got[0], ['L1', { a: 1 }, { id: ID }])
        assert.strictEqual(got[1].length, 2)
        assert.deepStrictEqual(got[1], ['L2', undefined])
    })

    it('R-DIAG-01-1 摘要(safe)亦防禦性遮罩: 值含資料庫檔案位置者以***取代, 數值同純數字位置者亦然, 不含者原樣', function() {
        let got = []
        let secrets = getSecrets(['123456', 'D:\\x\\123456'])
        let diag = getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)
        diag('L', { mode: '123456', errType: 'Error', errCode: 123456, other: 7 })
        diag('L', { mode: 'insert', errCode: 'ENOENT' })
        diag('L', { errCode: 123456n, big: 7n })
        assert.deepStrictEqual(got[0][1], { mode: '***', errType: 'Error', errCode: '***', other: 7 })
        assert.deepStrictEqual(got[1][1], { mode: 'insert', errCode: 'ENOENT' })
        assert.deepStrictEqual(got[2][1], { errCode: '***', big: 7n })
        let lines = cap(() => {
            getDiag(getOptLog({}), secrets)('L', { mode: '123456' })
        })
        assert.deepStrictEqual(lines, ['L { mode: \'***\' }'])
    })

    it('R-DIAG-01-3 funLog存在時logDetail不另寫console(funLog取代console)', function() {
        let got = []
        let diag = getDiag(getOptLog({ logDetail: true, funLog: (...a) => got.push(a) }))
        let lines = cap(() => {
            diag('L1', { a: 1 }, () => 'd')
        })
        assert.deepStrictEqual(lines, [])
        assert.deepStrictEqual(got, [['L1', { a: 1 }, 'd']])
    })

    it('R-DIAG-01-4 輸出不得使呼叫端拋錯: funLog拋錯、getDetail拋錯、console拋錯皆吞下', function() {
        let diag1 = getDiag(getOptLog({
            funLog: () => {
                throw new Error('x')
            }
        }))
        diag1('L', { a: 1 }, () => 'd')

        let got = []
        let diag2 = getDiag(getOptLog({ logDetail: true }))
        let lines = cap(() => {
            diag2('L', { a: 1 }, () => {
                throw new Error('boom')
            })
        })
        got.push(...lines)
        assert.deepStrictEqual(got, ['L (unprintable)'])

        let diag3 = getDiag(getOptLog({ funLog: (l, s, d) => got.push(d) }))
        diag3('L', undefined, () => {
            throw new Error('boom')
        })
        assert.strictEqual(got[got.length - 1], '(unprintable)')

        let diag4 = getDiag(getOptLog({}))
        let old = console.log
        console.log = () => {
            throw new Error('console broken')
        }
        try {
            diag4('L', { a: 1 })
        }
        finally {
            console.log = old
        }
    })

    it('R-DIAG-01-4 funLog回傳reject之promise不成為unhandledRejection', async function() {
        let bad = []
        let fn = (e) => bad.push(e)
        let thenCalled = false
        process.on('unhandledRejection', fn)
        try {
            let diag = getDiag(getOptLog({ funLog: () => Promise.reject(new Error('rej')) }))
            diag('L', { a: 1 }, () => 'd')
            //thenable: 其then轉發一個已存在(於呼叫前即建立)之reject promise; 若實作不呼叫then附處理, 該promise即成為unhandledRejection
            let p = Promise.reject(new Error('rej2'))
            let thenable = {
                then: (resolve, reject) => {
                    thenCalled = true
                    return p.then(resolve, reject)
                }
            }
            let diag2 = getDiag(getOptLog({ funLog: () => thenable }))
            diag2('L', { a: 1 }, () => 'd')
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        finally {
            process.off('unhandledRejection', fn)
        }
        assert.strictEqual(thenCalled, true, 'swallow須呼叫thenable之then')
        assert.deepStrictEqual(bad.map((v) => v.message), [])
    })

    it('R-DIAG-01-3 getDiag對傳入之optLog一律經getOptLog正規化: 未經快照之物件、缺欄之物件、null、型別錯誤者皆不拋錯, 行為同預設或同其有效設定', function() {
        let got = []
        let f = (...a) => got.push(a)
        let lines = cap(() => {
            getDiag({})('L1', { a: 1 }, () => 'd')
            getDiag({ logDetail: true })('L2', { a: 1 }, () => 'detail-text')
            getDiag({ funLog: f })('L3', { a: 1 }, () => 'to-funlog')
            getDiag(null)('L4', { a: 1 })
            getDiag({ logDetail: 'yes', funLog: 'x' })('L5', { a: 1 })
        })
        assert.deepStrictEqual(lines, ['L1 { a: 1 }', 'L2 detail-text', 'L4 { a: 1 }', 'L5 { a: 1 }'])
        assert.deepStrictEqual(got, [['L3', { a: 1 }, 'to-funlog']])
    })

    it('R-DIAG-01-4 funLog回傳覆寫了then之原生reject promise: 不成為unhandledRejection(以內建then附處理, 不讀可被覆寫之屬性)', async function() {
        let bad = []
        let fn = (e) => bad.push(e)
        process.on('unhandledRejection', fn)
        try {
            let mk = () => {
                let p = Promise.reject(new Error('shadowed'))
                Object.defineProperty(p, 'then', { value: null })
                return p
            }
            getDiag(getOptLog({ funLog: mk }))('L', { a: 1 })
            await new Promise((resolve) => setTimeout(resolve, 50))
        }
        finally {
            process.off('unhandledRejection', fn)
        }
        assert.deepStrictEqual(bad.map((v) => v.message), [])
    })

    it('R-DIAG-01-4 console.log第一次拋錯時改輸出標籤與(unprintable)後備訊息', function() {
        let diag = getDiag(getOptLog({}))
        let lines = []
        let old = console.log
        let n = 0
        console.log = (...a) => {
            n++
            if (n === 1) {
                throw new Error('first call broken')
            }
            lines.push(util.format(...a))
        }
        try {
            diag('L', { a: 1 })
        }
        finally {
            console.log = old
        }
        assert.deepStrictEqual(lines, ['L (unprintable)'])
    })

    it('R-DIAG-01-2 資料庫檔案位置遮罩: 細節(console與funLog)中之相對與絕對路徑、斜線與反斜線形式一律以***取代, 其餘細節保留', function() {
        let secrets = getSecrets([URL_REL, URL_ABS])
        let err = new Error(`open ${URL_ABS} failed; also ${URL_REL}; as D:/work/${SEC}/lowdb.json; id=${ID}`)
        err.code = 'ENOENT'
        err.path = URL_ABS
        err.nested = { message: `p=${URL_REL}`, list: [URL_ABS, { deep: `x${URL_REL}y` }] }

        let got = []
        let diag1 = getDiag(getOptLog({ funLog: (...a) => got.push(a) }), secrets)
        diag1('L', { a: 1 }, () => ({ state: 'error', msg: err }))
        let d = got[0][2]
        let s = JSON.stringify(d) + String(d.msg.message) + String(d.msg.stack)
        assert.ok(s.indexOf(SEC) < 0, `資料庫檔案位置未遮罩: ${s.slice(0, 300)}`)
        assert.ok(d.msg.message.indexOf(ID) >= 0, '非資料庫檔案位置之細節被誤遮')
        assert.strictEqual(d.msg.code, 'ENOENT')
        assert.ok(d.msg instanceof Error && d.msg !== err)
        assert.strictEqual(err.message.indexOf('***'), -1, '不得改動呼叫端之原物件')
        assert.ok(err.message.indexOf(SEC) >= 0)

        let diag2 = getDiag(getOptLog({ logDetail: true }), secrets)
        let lines = cap(() => {
            diag2('L', { a: 1 }, () => ({ state: 'error', msg: err }))
            diag2('L', { a: 1 }, () => `read ${URL_ABS}`, true)
        })
        let all = lines.join('\n')
        assert.ok(all.indexOf(SEC) < 0, `console輸出含資料庫檔案位置: ${all.slice(0, 300)}`)
        assert.ok(all.indexOf('***') >= 0)
    })

})


describe('getBriefErr', function() {

    it('R-DIAG-01-1 只列類別與機器代碼, 不含訊息文字', function() {
        let e = new Error(`failed for ${ID}`)
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        class MyHandlerError extends Error {}
        let e2 = new MyHandlerError(`dup ${ID}`)
        e2.code = 'ENOENT'
        assert.deepStrictEqual(getBriefErr(e2), { errType: 'MyHandlerError', errCode: 'ENOENT' })
        let e3 = new Error('x')
        e3.original = { code: 'ELOGIN' }
        assert.deepStrictEqual(getBriefErr(e3), { errType: 'Error' }, '本套件不取original.code(sequelize專屬)')
    })

    it('R-DIAG-01-1 字串或非物件之拋出值只列型別(字串內容可能夾帶資料)', function() {
        assert.deepStrictEqual(getBriefErr(`fail ${ID}`), { errType: 'string' })
        assert.deepStrictEqual(getBriefErr(null), { errType: 'null' })
        assert.deepStrictEqual(getBriefErr(undefined), { errType: 'undefined' })
        assert.deepStrictEqual(getBriefErr(12), { errType: 'number' })
        assert.deepStrictEqual(getBriefErr({ message: ID }), { errType: 'object' })
    })

    it('R-DIAG-01-1 code須為機器代碼樣式, 資料值樣式者不列(整數一律不列, E後接數字之識別碼如E123456789不列, 含一般字串、電郵)', function() {
        for (let c of [ID, 'alice', 'U-0001', 99999999, 1.5, NaN, {}, [], 'E', 'ERR_', 'sqlite_busy', 'SQLITE_BUSY', '', 'a'.repeat(60), 18456, 88012, 0, -1, 'E123456789', 'E000123', 'E1', 'EX', 'e123', 'ABC12', 'EAI_', 'ENOENT_', 'ENOENT1']) {
            let e = new Error('x')
            e.code = c
            assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' }, String(c))
        }
        for (let c of ['ENOENT', 'EACCES', 'EPERM', 'EAI_AGAIN', 'E2BIG', 'ERR_INVALID_ARG_TYPE', 'ERR_HTTP2_STREAM_ERROR']) {
            let e = new Error('x')
            e.code = c
            assert.deepStrictEqual(getBriefErr(e), { errType: 'Error', errCode: c }, String(c))
        }
    })

    it('R-DIAG-01-1 一般物件(非Error)之code可能為業務資料, 不列; 函數式自訂錯誤(原型鏈含Error.prototype)視為錯誤, 列類別與代碼', function() {
        assert.deepStrictEqual(getBriefErr({ id: 'u1', name: 'Alice', code: 'ENOENT' }), { errType: 'object' })
        assert.deepStrictEqual(getBriefErr({ id: 'u1', code: 88012 }), { errType: 'object' })
        assert.deepStrictEqual(getBriefErr({ code: 'E123456789' }), { errType: 'object' })
        function FnErr(m) {
            this.message = m
            this.code = 'EACCES'
        }
        FnErr.prototype = Object.create(Error.prototype)
        FnErr.prototype.constructor = FnErr
        assert.deepStrictEqual(getBriefErr(new FnErr('x')), { errType: 'FnErr', errCode: 'EACCES' })
    })

    it('R-DIAG-01-4 Proxy不觸發任何trap(列為Proxy); 原型鏈走訪不會無窮迴圈(子行程執行, 逾時判紅): 作為拋出之值與作為遮罩對象皆然', function() {
        let dir = path.resolve('./test/_tmp/unit-diaglog-proxy')
        fs.mkdirSync(dir, { recursive: true })
        try {
            for (let mode of ['cp', 'listener']) {
                let r = spawnSync(process.execPath, [path.resolve('./test/tools/diagProxyWorker.mjs'), mode, dir], { encoding: 'utf8', timeout: 15000, windowsHide: true })
                assert.ok(r.error === undefined && r.status === 0, `${mode}: 子行程未正常結束(無窮迴圈或拋錯): ${r.error && r.error.code} ${r.signal} ${String(r.stderr).slice(0, 300)}`)
                let o = JSON.parse(r.stdout.trim().split('\n').pop())
                assert.deepStrictEqual(o.traps, [], `${mode}: 觸發了使用端Proxy的trap`)
                if (mode === 'cp') {
                    assert.deepStrictEqual(o.brief, { errType: 'Proxy' })
                    assert.strictEqual(o.cp, '[Proxy]')
                }
                else {
                    assert.deepStrictEqual(o.res, { n: 1, nInserted: 1, ok: 1 })
                    assert.deepStrictEqual(o.lines, ['change handler threw { mode: \'insert\', errType: \'Proxy\' }'])
                    assert.deepStrictEqual(o.got, [['change handler threw', { mode: 'insert', errType: 'Proxy' }, '[Proxy]']])
                }
            }
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    })

    it('R-DIAG-01-1 建構子名稱不合識別字樣式者列為Error; 不執行getter與使用端程式', function() {
        let e = new Error('x')
        function Weird() {}
        Object.defineProperty(Weird, 'name', { value: `bad name ${ID}` })
        Object.defineProperty(e, 'constructor', { value: Weird, configurable: true })
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        function Okay() {}
        Object.defineProperty(e, 'constructor', { value: Okay, configurable: true })
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Okay' })

        let called = 0
        let e2 = new Error('x')
        Object.defineProperty(e2, 'code', {
            get() {
                called++
                return 'ENOENT'
            },
            configurable: true
        })
        assert.deepStrictEqual(getBriefErr(e2), { errType: 'Error' })
        assert.strictEqual(called, 0)
    })

    it('R-DIAG-01-4 Proxy與陷阱拋錯之值不使其拋錯', function() {
        let p = new Proxy({}, {
            getOwnPropertyDescriptor() {
                throw new Error('trap')
            },
            getPrototypeOf() {
                throw new Error('trap')
            }
        })
        let r = getBriefErr(p)
        assert.ok(r !== null && typeof r === 'object' && typeof r.errType === 'string')
        assert.ok(JSON.stringify(r).indexOf('trap') < 0)
    })

})


describe('maskText 與 getSecrets', function() {

    it('R-DIAG-01-2 getSecrets: 略過空值、非字串與過短者(少於3字元), 含原樣、斜線與反斜線互換、JSON跳脫、URL編碼形式, 長者在前, 不重複', function() {
        assert.deepStrictEqual(getSecrets([]), [])
        assert.deepStrictEqual(getSecrets(['', 'a', 'ab', null, undefined, 123, {}]), [])
        let r = getSecrets([URL_ABS, URL_REL])
        assert.ok(r.includes(URL_ABS) && r.includes(URL_REL))
        assert.ok(r.includes(`D:/work/${SEC}/lowdb.json`), '斜線形式')
        assert.ok(r.includes(URL_REL.replace(/\//g, '\\')), '反斜線形式')
        assert.ok(r.includes(`D:\\\\work\\\\${SEC}\\\\lowdb.json`), 'JSON跳脫(反斜線加倍)形式')
        assert.ok(r.includes(encodeURIComponent(URL_ABS)), 'URL編碼形式')
        assert.strictEqual(new Set(r).size, r.length)
        for (let k = 1; k < r.length; k++) {
            assert.ok(r[k - 1].length >= r[k].length, '長者在前')
        }
        assert.deepStrictEqual(getSecrets(['abc', 'abc']), ['abc'])
        assert.deepStrictEqual(getSecrets(['a\ud800b/c']).includes('a\ud800b/c'), true, '孤立代理碼元不使編碼拋錯')
    })

    it('R-DIAG-01-2 maskText: 各形式之資料庫檔案位置皆遮罩, 不含者原樣, 非字串原樣回傳', function() {
        let secrets = getSecrets([URL_REL, URL_ABS])
        for (let t of [URL_REL, URL_ABS, `D:/work/${SEC}/lowdb.json`, `D:\\\\work\\\\${SEC}\\\\lowdb.json`, encodeURIComponent(URL_ABS)]) {
            let m = maskText(`open ${t} failed`, secrets)
            assert.strictEqual(m, 'open *** failed', t)
        }
        assert.strictEqual(maskText('nothing to mask', secrets), 'nothing to mask')
        assert.strictEqual(maskText(12, secrets), 12)
        assert.strictEqual(maskText(undefined, secrets), undefined)
    })

    it('R-DIAG-01-2 getSecrets的等價形式: normalize後(無./)、steno暫存檔、斜線與反斜線交叉之JSON跳脫與URL編碼、file:///網址(非ASCII與空白百分比編碼)、磁碟機代號大小寫、UNC命名空間皆遮罩', function() {
        let rel = `./test/_tmp/${SEC} dir/資料庫.json`
        let abs = `C:\\Users\\x\\${SEC} dir\\資料庫.json`
        let tmp = (f) => path.join(path.dirname(f), `.${path.basename(f)}.tmp`)
        let secrets = getSecrets([rel, abs, path.normalize(rel), tmp(abs), tmp(rel), '\\\\server\\share\\SecretDirQ\\db.json'])
        let forms = {
            normalized: path.normalize(rel),
            normalizedSlash: path.normalize(rel).replace(/\\/g, '/'),
            tmpAbs: tmp(abs),
            tmpRel: tmp(rel),
            jsonBackslashOfRel: JSON.stringify(rel.replace(/\//g, '\\')).slice(1, -1),
            jsonSlashOfAbs: JSON.stringify(abs.replace(/\\/g, '/')).slice(1, -1),
            uriCompSlashOfAbs: encodeURIComponent(abs.replace(/\\/g, '/')),
            uriCompBackslashOfRel: encodeURIComponent(rel.replace(/\//g, '\\')),
            fileUrl: `file:///${encodeURI(abs.replace(/\\/g, '/'))}`,
            lowerDrive: `c${abs.slice(1)}`,
            lowerDriveSlash: `c${abs.slice(1)}`.replace(/\\/g, '/'),
            unc: '\\\\server\\share\\SecretDirQ\\db.json',
            namespacedUnc: '\\\\?\\UNC\\server\\share\\SecretDirQ\\db.json',
            namespacedDrive: `\\\\?\\${abs}`,
        }
        for (let [k, t] of Object.entries(forms)) {
            let m = maskText(`open ${t} failed`, secrets)
            assert.ok(m.indexOf(SEC) < 0 && m.indexOf('資料庫') < 0 && m.indexOf('%E8%B3%87') < 0, `${k}: ${m}`)
            assert.ok(m.startsWith('open ') && m.indexOf('***') >= 0, `${k}: ${m}`)
        }
    })

    it('R-DIAG-01-2 maskText: 連線字串內嵌之帳密(scheme://帳密@主機)不依賴已知秘密亦遮罩, 含未編碼之@時取至最後一個@, 不吞掉其後以空白分隔之文字', function() {
        assert.strictEqual(maskText('x mssql://u:p@h:1433/db y'), 'x mssql://***@h:1433/db y')
        assert.strictEqual(maskText('x mssql://u:p@ss@h:1433 y'), 'x mssql://***@h:1433 y')
        assert.strictEqual(maskText('see https://example.com/a?b=1 now'), 'see https://example.com/a?b=1 now')
    })

})


describe('cpMask', function() {

    it('R-DIAG-01-2 不改動原物件, 循環參照與過深/過大結構有界, 函數與二進位以標記字串代替', function() {
        let a = { name: ID, loc: URL_ABS, list: [URL_REL, 1, null, undefined], fn() {}, buf: Buffer.from(SEC), d: new Date(0) }
        a.self = a
        let deep = { v: URL_ABS }
        let cur = deep
        for (let k = 0; k < 30; k++) {
            cur.next = { v: URL_ABS }
            cur = cur.next
        }
        a.deep = deep
        let secrets = getSecrets([URL_REL, URL_ABS])
        let r = cpMask(a, secrets)
        assert.notStrictEqual(r, a)
        assert.strictEqual(a.loc, URL_ABS)
        assert.strictEqual(r.name, ID)
        assert.strictEqual(r.loc, '***')
        assert.deepStrictEqual(r.list, ['***', 1, null, undefined])
        assert.strictEqual(r.fn, '[Function]')
        assert.ok(String(r.buf).startsWith('[Binary'))
        assert.strictEqual(r.d.getTime(), 0)
        assert.strictEqual(r.self, r)
        let n = 0
        for (let x = r.deep; typeof x === 'object' && x !== null; x = x.next) {
            n++
            assert.ok(JSON.stringify(x.v).indexOf(SEC) < 0)
        }
        assert.ok(n < 30, `過深結構未截斷: ${n}`)
        assert.ok(JSON.stringify(r, (k, v) => (k === 'self' ? undefined : v)).indexOf(SEC) < 0)
    })

    it('R-DIAG-01-2 Error之副本仍為Error: message、stack、cause、自有屬性皆遮罩', function() {
        let e = new Error(`m ${URL_ABS}`, { cause: new Error(`c ${URL_REL}`) })
        e.extra = `x ${URL_ABS}`
        let r = cpMask(e, getSecrets([URL_REL, URL_ABS]))
        assert.ok(r instanceof Error)
        assert.strictEqual(r.message, 'm ***')
        assert.ok(typeof r.stack === 'string' && r.stack.indexOf(SEC) < 0 && r.stack.indexOf('m ***') >= 0)
        assert.strictEqual(r.cause.message, 'c ***')
        assert.strictEqual(r.extra, 'x ***')
        assert.strictEqual(e.message, `m ${URL_ABS}`)
    })

    it('R-DIAG-01-2 屬性鍵與Symbol描述含資料庫檔案位置者亦遮罩; 純數字位置之同值數字亦遮罩(至少4位)', function() {
        let e = new Error('x')
        e[URL_ABS] = 'v'
        e[Symbol(URL_REL)] = 'w'
        let r = cpMask(e, getSecrets([URL_REL, URL_ABS]))
        let keys = Reflect.ownKeys(r).map((k) => String(k))
        assert.ok(keys.every((k) => k.indexOf(SEC) < 0), keys.join('|'))
        assert.ok(keys.includes('***') && keys.includes('Symbol(***)'), keys.join('|'))
        let r2 = cpMask({ pw: 12345, count: 7, big: 12345n, s: '12345', short: 123 }, getSecrets(['12345', '123']))
        assert.deepStrictEqual(r2, { pw: '***', count: 7, big: '***', s: '***', short: 123 })
    })

    it('R-DIAG-01-2 副本不沿用原型: 繼承屬性不外帶, 繼承之util.inspect.custom不被執行; Error之name取原型鏈上之資料屬性', function() {
        class MyErr extends Error {}
        MyErr.prototype.token = URL_ABS
        MyErr.prototype.name = 'MyErrName'
        MyErr.prototype[Symbol.for('nodejs.util.inspect.custom')] = () => `P=${URL_ABS}`
        let r = cpMask(new MyErr('m'), getSecrets([URL_REL, URL_ABS]))
        assert.ok(r instanceof Error)
        assert.strictEqual(r.token, undefined)
        assert.strictEqual(r.name, 'MyErrName')
        assert.ok(!util.inspect(r).includes(SEC), util.inspect(r))
        class Foo {
            constructor() {
                this.a = 1
            }
        }
        Foo.prototype.b = URL_ABS
        Foo.prototype[Symbol.for('nodejs.util.inspect.custom')] = () => `P=${URL_ABS}`
        let r2 = cpMask(new Foo(), getSecrets([URL_REL, URL_ABS]))
        assert.deepStrictEqual(r2, { a: 1 })
        assert.ok(!util.inspect(r2).includes(SEC))
    })

    it('R-DIAG-01-4 不執行使用端程式: Symbol.toStringTag之getter、自訂stack與message存取器皆不被執行', function() {
        let called = []
        let e = new Error('m')
        Object.defineProperty(e, Symbol.toStringTag, {
            get() {
                called.push('tag')
                return 'Error'
            }
        })
        Object.defineProperty(e, 'stack', {
            get() {
                called.push('stack')
                return `stack ${URL_ABS}`
            },
            configurable: true
        })
        Object.defineProperty(e, 'message', {
            get() {
                called.push('message')
                return `msg ${URL_ABS}`
            },
            configurable: true
        })
        let r = cpMask(e, getSecrets([URL_REL, URL_ABS]))
        assert.ok(r instanceof Error)
        assert.deepStrictEqual(called, [])
        assert.ok(!util.inspect(r).includes(SEC))
        assert.deepStrictEqual(getBriefErr(e), { errType: 'Error' })
        assert.deepStrictEqual(called, [])
    })

    it('R-DIAG-01-2 logDetail還原舊版格式: util.format(遮罩拷貝)同util.format(原值), 含TypeError、RangeError、自訂Error類別、函數式Error、cause、AggregateError、純值', function() {
        class SubErr extends Error {}
        class NamedErr extends Error {
            constructor(m) {
                super(m)
                this.name = 'NamedErr'
            }
        }
        class ProtoNamed extends Error {}
        ProtoNamed.prototype.name = 'ProtoNamedName'
        function FnErr(m) {
            this.message = m
            this.stack = new Error(m).stack
        }
        FnErr.prototype = Object.create(Error.prototype)
        FnErr.prototype.constructor = FnErr
        let vals = {
            plain: new Error('plain'),
            type: new TypeError('type'),
            range: new RangeError('range'),
            syntax: new SyntaxError('syntax'),
            sub: new SubErr('sub'),
            named: new NamedErr('named'),
            protoNamed: new ProtoNamed('pn'),
            fnErr: new FnErr('fn'),
            props: Object.assign(new Error('props'), { code: 'EACCES', info: { a: [1, 2] } }),
            cause: new Error('outer', { cause: new TypeError('inner') }),
            agg: new AggregateError([new Error('e1'), new TypeError('e2')], 'agg'),
            obj: { a: 1, b: [1, 2, { c: 3 }] },
            str: 's',
            num: 1,
            nul: null,
            und: undefined,
            arr: [1, 'a', { b: 1 }],
            date: new Date(0),
        }
        for (let [k, v] of Object.entries(vals)) {
            assert.strictEqual(util.format(cpMask(v, [])), util.format(v), k)
        }
    })

    it('R-DIAG-01-2 logDetail還原舊版格式之已知差異(文件化): 非Error之類別實例複製為普通物件、原型為null之錯誤複製為Error(保有訊息與堆疊, 不標示null prototype)', function() {
        class Foo {
            constructor() {
                this.a = 1
            }
        }
        assert.strictEqual(util.format(new Foo()), 'Foo { a: 1 }')
        assert.strictEqual(util.format(cpMask(new Foo(), [])), '{ a: 1 }')
        let np = new Error('np')
        Object.setPrototypeOf(np, null)
        assert.ok(util.format(np).startsWith('[Error: null prototype]: np'))
        let r = cpMask(np, [])
        assert.ok(r instanceof Error && util.format(r).startsWith('Error: np\n    at '), util.format(r).split('\n')[0])
    })

    it('R-DIAG-01-2 無自有stack之錯誤(已刪除stack、函數式自訂錯誤未設stack): 輸出同舊版, 不顯示指向getDiag.mjs之偽造堆疊', function() {
        let e1 = new Error('secret message')
        delete e1.stack
        function FnErrNoStack(m) {
            this.message = m
        }
        FnErrNoStack.prototype = Object.create(Error.prototype)
        FnErrNoStack.prototype.constructor = FnErrNoStack
        for (let v of [e1, new FnErrNoStack('fn msg')]) {
            let text = util.format(cpMask(v, []))
            assert.strictEqual(text, util.format(v))
            assert.ok(text.indexOf('getDiag') < 0, text)
        }
    })

    it('R-DIAG-01-2 陣列之附加字串鍵與Symbol鍵亦遮罩(索引鍵原樣)', function() {
        let arr = ['ok', URL_ABS]
        arr[URL_ABS] = 'val'
        arr[Symbol(URL_REL)] = 'symval'
        arr.extra = 1
        let r = cpMask(arr, getSecrets([URL_REL, URL_ABS]))
        let keys = Reflect.ownKeys(r).map((k) => String(k))
        assert.ok(keys.every((k) => k.indexOf(SEC) < 0), keys.join('|'))
        assert.ok(keys.includes('***') && keys.includes('Symbol(***)') && keys.includes('extra'), keys.join('|'))
        assert.deepStrictEqual([r[0], r[1], r.length], ['ok', '***', 2])
        assert.ok(util.format(r).indexOf(SEC) < 0)
    })

    it('R-DIAG-01-2 陣列之索引判定: 合法索引(含最大2^32-2)為索引, 4294967295與前導零之鍵為一般鍵(不使複製拋錯或誤設length)', function() {
        let arr = ['a', 'b']
        arr['4294967295'] = 'big'
        arr['01'] = 'lead'
        arr[4294967294] = 'max'
        let r = cpMask(arr, [])
        assert.ok(Array.isArray(r) && r.length === 4294967295, `length=${r && r.length}`)
        assert.deepStrictEqual([r[0], r[1], r['4294967295'], r['01'], r[4294967294]], ['a', 'b', 'big', 'lead', 'max'])
        //非索引之數字鍵先於大量其他鍵: 截斷時不得以該鍵設定length(RangeError使整個陣列退化為標記字串)
        let wide = []
        wide['4294967295'] = 'big'
        for (let k = 0; k < 2500; k++) {
            wide[`k${k}`] = k
        }
        let rw = cpMask(wide, [])
        assert.ok(Array.isArray(rw) && rw[rw.length - 1] === '[Truncated]', `截斷時不得拋錯: ${String(rw).slice(0, 30)}`)
        //10位數字之秘密作為陣列附加鍵(非索引)仍須遮罩
        let sec = ['item']
        sec['4294967295'] = 'secret_value'
        let rs = cpMask(sec, getSecrets(['4294967295']))
        assert.deepStrictEqual(Object.keys(rs), ['0', '***'])
    })

    it('R-DIAG-01-2 包裝物件(new String等)與Symbol值: 以內部槽讀原始值後遮罩, 不逐字元拆解; Symbol之描述遮罩', function() {
        let secrets = getSecrets([URL_REL, URL_ABS, '12345'])
        assert.strictEqual(util.format(cpMask(Object(URL_ABS), secrets)), '[String: \'***\']')
        assert.strictEqual(util.format(cpMask(Object('plain'), secrets)), '[String: \'plain\']')
        assert.strictEqual(util.format(cpMask(Object(12345), secrets)), '[String: \'***\']')
        assert.strictEqual(util.format(cpMask(Object(7), secrets)), '[Number: 7]')
        assert.strictEqual(util.format(cpMask(Object(true), secrets)), '[Boolean: true]')
        assert.strictEqual(util.format(cpMask(Object(10n), secrets)), '[BigInt: 10n]')
        assert.strictEqual(util.format(cpMask(Object(Symbol(URL_REL)), secrets)), '[Symbol: Symbol(***)]')
        assert.strictEqual(cpMask(Symbol(URL_ABS), secrets).description, '***')
        assert.strictEqual(cpMask(Symbol('keep'), secrets).description, 'keep')
        let r = cpMask({ s: Symbol(URL_REL), b: Object(URL_ABS), l: [Symbol(URL_ABS)] }, secrets)
        assert.ok(util.format(r).indexOf(SEC) < 0, util.format(r))
    })

    it('R-DIAG-01-4 二進位資料與包裝: 以內建getter讀byteLength(不讀自有屬性、不執行getter), 自有byteLength屬性不外洩; 偽造之原型僅視為普通物件', function() {
        let secrets = getSecrets([URL_REL, URL_ABS])
        let realBuf = Buffer.from('hello')
        Object.defineProperty(realBuf, 'byteLength', { value: URL_ABS })
        assert.strictEqual(cpMask(realBuf, secrets), '[Binary 5 bytes]')
        let called = 0
        let fakeAb = Object.create(ArrayBuffer.prototype, {
            byteLength: {
                get() {
                    called++
                    return URL_ABS
                }
            }
        })
        let r = cpMask(fakeAb, secrets)
        assert.strictEqual(called, 0)
        assert.ok(util.format(r).indexOf(SEC) < 0, util.format(r))
        let ab = new ArrayBuffer(8)
        Object.defineProperty(ab, 'byteLength', { value: URL_ABS })
        assert.strictEqual(cpMask(ab, secrets), '[Binary 8 bytes]')
        assert.strictEqual(cpMask(new ArrayBuffer(8), secrets), '[Binary 8 bytes]')
        assert.strictEqual(cpMask(new Uint8Array(3), secrets), '[Binary 3 bytes]')
        assert.strictEqual(cpMask(new Float64Array(2), secrets), '[Binary 16 bytes]')
        assert.strictEqual(cpMask(new DataView(new ArrayBuffer(4)), secrets), '[Binary 4 bytes]')
        assert.strictEqual(cpMask(new SharedArrayBuffer(4), secrets), '[SharedArrayBuffer]')
    })

    it('R-DIAG-01-2 Map、Set、RegExp、Promise、WeakMap、WeakSet以標記字串代替(不展開內容); Date複製為新物件', function() {
        let secrets = getSecrets([URL_REL, URL_ABS])
        let d0 = new Date(5)
        let r = cpMask({ m: new Map([[URL_ABS, 1]]), s: new Set([URL_ABS]), re: new RegExp(SEC), p: Promise.resolve(URL_ABS), wm: new WeakMap(), ws: new WeakSet(), g: (function* () {})(), mi: new Map([[URL_ABS, 1]]).entries(), si: new Set([URL_ABS]).values(), ns: diagNs, d: d0 }, secrets)
        assert.deepStrictEqual([r.m, r.s, r.re, r.p, r.wm, r.ws, r.g, r.mi, r.si, r.ns], new Array(10).fill('[Object]'))
        assert.ok(r.d instanceof Date && r.d.getTime() === 5 && r.d !== d0, 'Date複製為新物件(不交出原參照)')
        assert.ok(util.format(r).indexOf(SEC) < 0)
    })

    it('R-DIAG-01-4 巢狀之Proxy以標記字串代替且不觸發trap', function() {
        let traps = 0
        let handler = new Proxy({}, {
            get() {
                traps++
                return undefined
            }
        })
        let p = new Proxy({ a: 1 }, handler)
        let r = cpMask({ p, list: [p] }, [])
        assert.deepStrictEqual([r.p, r.list[0]], ['[Proxy]', '[Proxy]'])
        assert.strictEqual(traps, 0)
    })

    it('R-DIAG-01-4 Error之message或name為存取器、或message拋錯: 不執行使用端程式(讀stack前先確認可安全讀取), 且不毀掉整個副本', function() {
        let called = []
        let e = new Error('m')
        e.extra = 'keep'
        Object.defineProperty(e, 'message', {
            get() {
                called.push('message')
                return 'x'
            },
            configurable: true
        })
        let r = cpMask(e, [])
        assert.deepStrictEqual(called, [])
        assert.ok(r instanceof Error)
        assert.strictEqual(r.extra, 'keep')

        let e2 = new Error('m2')
        e2.extra = 'keep2'
        Object.defineProperty(e2, 'message', {
            get() {
                called.push('message-throws')
                throw new Error('boom')
            },
            configurable: true
        })
        let r2 = cpMask(e2, [])
        assert.deepStrictEqual(called, [])
        assert.ok(r2 instanceof Error, '整個副本不得退化為標記字串')
        assert.strictEqual(r2.extra, 'keep2')

        class NameGetter extends Error {
            get name() {
                called.push('name')
                return 'NG'
            }
        }
        let r3 = cpMask(new NameGetter('m3'), [])
        assert.deepStrictEqual(called, [])
        assert.ok(r3 instanceof Error)
    })

    it('R-DIAG-01-4 name或message為Symbol時不讀stack(不拋錯, stack以標記字串代替); 已知限制(文件化): 使用端設定全域Error.prepareStackTrace時, V8於首次格式化stack時會呼叫它(與一般讀取錯誤堆疊相同)', function() {
        let e = new Error('x')
        e.name = Symbol('n')
        let r = cpMask(e, [])
        assert.ok(r instanceof Error)
        assert.strictEqual(r.stack, '[Getter/Setter]')

        let old = Error.prepareStackTrace
        let called = 0
        Error.prepareStackTrace = () => {
            called++
            return 'custom-stack'
        }
        try {
            let r2 = cpMask(new Error('test'), [])
            assert.strictEqual(r2.stack, 'custom-stack')
            assert.strictEqual(called, 1)
        }
        finally {
            Error.prepareStackTrace = old
        }
    })

    it('R-DIAG-01-2 超過節點上限(2000)時其餘鍵不複製並附標記: 物件有鍵[Truncated](值為未複製之鍵數), 陣列截短並以最後一個元素[Truncated]標示(不留稀疏空洞)', function() {
        let wide = {}
        for (let k = 0; k < 2500; k++) {
            wide[`k${k}`] = `v${k}`
        }
        let r = cpMask(wide, [])
        let keys = Object.keys(r)
        assert.ok(keys.includes('[Truncated]') && keys.length < 2100, `keys=${keys.length}`)
        assert.strictEqual(keys.length - 1 + r['[Truncated]'], 2500)
        let arr = []
        for (let k = 0; k < 2500; k++) {
            arr.push(`v${k}`)
        }
        let ra = cpMask(arr, [])
        assert.strictEqual(ra[ra.length - 1], '[Truncated]')
        assert.ok(ra.length < 2100 && Object.keys(ra).length === ra.length, `length=${ra.length} keys=${Object.keys(ra).length}`)
        assert.strictEqual(ra[0], 'v0')
        let small = cpMask({ a: 1, b: [1, 2, 3] }, [])
        assert.deepStrictEqual(small, { a: 1, b: [1, 2, 3] })
    })

    it('R-DIAG-01-4 錯誤副本之建構子名稱只讀自有資料屬性: 名稱為存取器或建構子為存取器者不執行, 名稱中之資料庫檔案位置遮罩', function() {
        let called = 0
        class AccName extends Error {
            static get name() {
                called++
                return 'AccName'
            }
        }
        let e1 = new AccName('x')
        class Loc extends Error {}
        Object.defineProperty(Loc, 'name', { value: `Err_${SEC}` })
        let e3 = new Loc('z')
        let secrets = getSecrets([SEC])
        let r1 = cpMask(e1, secrets)
        assert.strictEqual(called, 0)
        assert.ok(r1 instanceof Error)
        let r3 = cpMask(e3, secrets)
        assert.strictEqual(r3.constructor.name, 'Err_***')
        assert.ok(!util.format(r3).includes(SEC), util.format(r3).split('\n')[0])
        assert.ok(r3 instanceof Error && Object.getPrototypeOf(Object.getPrototypeOf(r3)) === Error.prototype)
    })

    it('R-DIAG-01-4 getter不被執行(以標記字串代替), 拋錯之getter不使其拋錯', function() {
        let called = 0
        let o = {
            get a() {
                called++
                return URL_ABS
            },
            b: 1
        }
        let r = cpMask(o, getSecrets([URL_REL, URL_ABS]))
        assert.strictEqual(called, 0)
        assert.strictEqual(r.a, '[Getter/Setter]')
        assert.strictEqual(r.b, 1)
    })

})
