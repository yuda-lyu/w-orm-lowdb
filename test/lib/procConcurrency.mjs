import WOrm from '../../src/WOrmLowdb.mjs'


//供unit-concurrency.test.mjs以子行程方式使用, 對同一資料庫檔案進行寫入
//註: 本檔置於test/lib之下, 令mocha之預設抓取範圍(test之第一層)不會將其誤認為測試檔

//argv
let url = process.argv[2]
let cl = process.argv[3]
let prefix = process.argv[4]
let count = parseInt(process.argv[5], 10)
let startAt = parseInt(process.argv[6], 10)
let mode = process.argv[7] //'insert' or 'save'


async function main() {

    //wo
    let wo = WOrm({ url, db: 'worm', cl })

    //wait, 各行程同時起跑, 令寫入確實重疊
    let ms = startAt - Date.now()
    if (ms > 0) {
        await new Promise((resolve) => {
            setTimeout(resolve, ms)
        })
    }

    //run
    let nInserted = 0
    let nOk = 0
    for (let i = 0; i < count; i++) {
        if (mode === 'save') {
            let r = await wo.save({ id: 'shared', [`${prefix}${i}`]: i })
            if (r[0].ok === 1) {
                nOk++
            }
        }
        else {
            let r = await wo.insert({ id: `${prefix}${i}` })
            nInserted += r.nInserted
        }
    }

    //output
    console.log(JSON.stringify({ prefix, nInserted, nOk }))

}
main()
    .catch(function(err) {
        console.log(JSON.stringify({ prefix, err: String(err) }))
        process.exit(1)
    })
