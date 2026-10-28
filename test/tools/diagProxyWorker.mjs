//診斷輸出測試(R-DIAG-01)用之子行程: 以Proxy(其getPrototypeOf陷阱第1次回Error.prototype, 之後回自身, 使原型鏈走訪永不結束)作為拋出之值或遮罩對象,
//在獨立行程執行, 使實作若無防護而無窮迴圈時, 測試仍能以逾時判紅而不卡死mocha
//用法: node diagProxyWorker.mjs <模式: listener|cp> <暫存夾>; 最後一行輸出JSON
import util from 'util'
import wo from '../../src/WOrmLowdb.mjs'
import { cpMask, getBriefErr } from '../../src/getDiag.mjs'


let mode = process.argv[2]
let dir = process.argv[3]
let traps = []


let mkProxy = () => {
    let n = 0
    let p = new Proxy({ a: 1 }, {
        getPrototypeOf() {
            traps.push('getPrototypeOf')
            return ++n === 1 ? Error.prototype : p
        },
        ownKeys() {
            traps.push('ownKeys')
            return []
        },
        getOwnPropertyDescriptor() {
            traps.push('getOwnPropertyDescriptor')
            return undefined
        },
        get() {
            traps.push('get')
            return undefined
        },
        has() {
            traps.push('has')
            return false
        },
    })
    return p
}


let out = { mode }
if (mode === 'listener') {
    let lines = []
    let old = console.log
    console.log = (...a) => lines.push(util.format(...a))
    let got = []
    try {
        let w = wo({ url: `${dir}/proxy-default.json` })
        w.on('change', () => {
            throw mkProxy()
        })
        out.res = await w.insert({ id: 'p1', name: 'N' })
        let w2 = wo({ url: `${dir}/proxy-funlog.json`, funLog: (...a) => got.push(a) })
        w2.on('change', () => {
            throw mkProxy()
        })
        out.res2 = await w2.insert({ id: 'p2', name: 'N' })
    }
    finally {
        console.log = old
    }
    out.lines = lines
    out.got = got.map((v) => [v[0], v[1], v[2]])
}
else {
    let p = mkProxy()
    out.brief = getBriefErr(p)
    out.cp = cpMask(p, [])
}
out.traps = traps
process.stdout.write(`${JSON.stringify(out)}\n`)
