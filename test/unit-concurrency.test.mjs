import assert from 'assert'
import { spawn } from 'child_process'
import _ from 'lodash-es'
import w from 'wsemi'
import WOrm from '../src/WOrmLowdb.mjs'


describe('concurrency', function() {
    let vans = {}
    let vget = {}

    before(async function() {

        //runProc, 以子行程執行寫入, 回傳其stdout之JSON
        let runProc = function(args) {
            return new Promise(function(resolve) {
                let p = spawn(process.execPath, ['./test/lib/procConcurrency.mjs', ...args], { cwd: process.cwd() })
                let out = ''
                p.stdout.on('data', function(d) {
                    out += d
                })
                p.stderr.on('data', function(d) {
                    out += d
                })
                p.on('close', function() {
                    let r = null
                    try {
                        r = JSON.parse(_.trim(out))
                    }
                    catch (err) {
                        r = { err: _.trim(out) }
                    }
                    resolve(r)
                })
            })
        }

        //單一行程內併發: 30個並行insert不同主鍵, nInserted總和與資料表筆數皆須為30
        w.fsDeleteFile('./db_concurrency_a.json')
        let woA = WOrm({ url: './db_concurrency_a.json', db: 'worm', cl: 'users' })
        let rsA = await Promise.all(_.map(_.range(30), function(i) {
            return woA.insert({ id: `k${i}` })
        }))
        vget[1] = [_.sumBy(rsA, 'nInserted'), _.size(await woA.select())]

        //單一行程內併發: 30個並行insert於同一主鍵, 僅一次得以插入
        w.fsDeleteFile('./db_concurrency_b.json')
        let woB = WOrm({ url: './db_concurrency_b.json', db: 'worm', cl: 'users' })
        let rsB = await Promise.all(_.map(_.range(30), function() {
            return woB.insert({ id: 'same' })
        }))
        vget[2] = [_.sumBy(rsB, 'nInserted'), _.size(await woB.select())]

        //單一行程內併發: 20個並行save於同一列各寫入不同欄位, 全部欄位須保留(不遺失更新)
        w.fsDeleteFile('./db_concurrency_c.json')
        let woC = WOrm({ url: './db_concurrency_c.json', db: 'worm', cl: 'users' })
        await woC.insert({ id: 's' })
        let rsC = await Promise.all(_.map(_.range(20), function(i) {
            return woC.save({ id: 's', [`f${i}`]: i })
        }))
        let vC = await woC.selectByPk('s')
        vget[3] = [
            _.size(_.filter(_.flatten(rsC), { ok: 1 })),
            _.size(_.filter(_.keys(vC), function(k) {
                return _.startsWith(k, 'f')
            })),
        ]

        //單一行程內併發: 同一檔案之多個實例共用同一佇列, 併發寫入亦不遺失
        w.fsDeleteFile('./db_concurrency_d.json')
        let wos = _.map(_.range(5), function() {
            return WOrm({ url: './db_concurrency_d.json', db: 'worm', cl: 'users' })
        })
        let rsD = await Promise.all(_.flatten(_.map(wos, function(wo, j) {
            return _.map(_.range(10), function(i) {
                return wo.insert({ id: `m${j}-${i}` })
            })
        })))
        vget[4] = [_.sumBy(rsD, 'nInserted'), _.size(await wos[0].select())]

        //跨行程併發: 依README之宣告為不成立, 此處以實測重現其失效
        //失效有二: (一)兩行程各持舊快照整檔寫回而遺失對方之寫入,
        //(二)steno之暫存檔名由資料庫檔名推導, 兩行程共用同一暫存檔而使後者之rename拋ENOENT
        //註: 任一輪重現即足以證實其不成立, 故最多跑3輪
        let nRound = 0
        let broken = false
        while (nRound < 3 && !broken) {
            nRound++
            let url = `./db_concurrency_x${nRound}.json`
            w.fsDeleteFile(url)
            let startAt = Date.now() + 1500
            let [ra, rb] = await Promise.all([
                runProc([url, 'users', 'A-', '200', `${startAt}`, 'insert']),
                runProc([url, 'users', 'B-', '200', `${startAt}`, 'insert']),
            ])
            let wo = WOrm({ url, db: 'worm', cl: 'users' })
            let nRow = _.size(await wo.select())
            let hasErr = w.isestr(_.get(ra, 'err')) || w.isestr(_.get(rb, 'err'))
            let nLost = 400 - nRow
            broken = hasErr || nLost > 0
            // console.log('cross process detail', { nRound, nRow, nLost, hasErr })
            w.fsDeleteFile(url)
        }
        vget[5] = broken

    })

    after(async function() {
        w.fsDeleteFile('./db_concurrency_a.json')
        w.fsDeleteFile('./db_concurrency_b.json')
        w.fsDeleteFile('./db_concurrency_c.json')
        w.fsDeleteFile('./db_concurrency_d.json')
    })

    vans[1] = [30, 30]
    it(`should get ${JSON.stringify(vans[1])} for 30 concurrent inserts with different pk in one process`, async function() {
        assert.strict.deepStrictEqual(vget[1], vans[1])
    })

    vans[2] = [1, 1]
    it(`should get ${JSON.stringify(vans[2])} for 30 concurrent inserts with same pk in one process`, async function() {
        assert.strict.deepStrictEqual(vget[2], vans[2])
    })

    vans[3] = [20, 20]
    it(`should get ${JSON.stringify(vans[3])} for 20 concurrent saves on same row in one process`, async function() {
        assert.strict.deepStrictEqual(vget[3], vans[3])
    })

    vans[4] = [50, 50]
    it(`should get ${JSON.stringify(vans[4])} for concurrent inserts by multiple instances on same file`, async function() {
        assert.strict.deepStrictEqual(vget[4], vans[4])
    })

    vans[5] = true
    it(`should get ${JSON.stringify(vans[5])} for cross process concurrency being broken as declared in README`, async function() {
        assert.strict.deepStrictEqual(vget[5], vans[5])
    })

})
