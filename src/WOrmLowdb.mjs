import events from 'events'
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { Query } from 'mingo' //須指定安裝6.5.6, 若6.6.0無法匯入Query
import get from 'lodash-es/get.js'
import each from 'lodash-es/each.js'
import map from 'lodash-es/map.js'
import merge from 'lodash-es/merge.js'
import isEqual from 'lodash-es/isEqual.js'
import size from 'lodash-es/size.js'
import cloneDeep from 'lodash-es/cloneDeep.js'
import genID from 'wsemi/src/genID.mjs'
import pmSeries from 'wsemi/src/pmSeries.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import iseobj from 'wsemi/src/iseobj.mjs'
import isearr from 'wsemi/src/isearr.mjs'
import haskey from 'wsemi/src/haskey.mjs'
import arrPullAt from 'wsemi/src/arrPullAt.mjs'
import waitFun from 'wsemi/src/waitFun.mjs'


//全域鎖, 一次僅能執行一種操作函數
//select理論上是不用鎖, 但因為操作上db.jon.tmp更名回db.json時似乎非rename而是串流寫入, 導致有機會撈到不完整json數據進而出錯, 故還是得要上鎖以策安全
let glock = false


/**
 * 操作資料庫(lowdb)
 *
 * @class
 * @param {Object} [opt={}] 輸入設定物件，預設{}
 * @param {String} [opt.url='./db.json'] 輸入資料庫位置字串，預設'./db.json'
 * @param {String} [opt.db='worm'] 輸入使用資料庫名稱字串，預設'worm'
 * @param {String} [opt.cl='test'] 輸入使用資料表名稱字串，預設'test'
 * @returns {Object} 回傳操作資料庫物件，各事件功能詳見說明
 */
function WOrmLowdb(opt = {}) {

    //url
    let url = get(opt, 'url')
    if (!isestr(url)) {
        url = './db.json'
    }

    //db
    let db = get(opt, 'db')
    if (!isestr(db)) {
        db = 'worm'
    }

    //cl
    let cl = get(opt, 'cl')
    if (!isestr(cl)) {
        cl = 'test'
    }

    //key
    let key = `${db}:${cl}`

    //adapter
    let adapter = new JSONFile(url)

    //lowdb
    let lowdb = new Low(adapter, {})

    // //default, 此處偵測會失效, 因操作函數內會通過lowdb.read()初始化, 預設創建空陣列會被取代
    // if (!haskey(lowdb.data, key)) {
    //     lowdb.data[key] = []
    // }

    //ee
    let ee = new events.EventEmitter()

    /**
     * 查詢數據
     *
     * @memberOf WOrmLowdb
     * @param {Object} [find={}] 輸入查詢條件物件
     * @returns {Promise} 回傳Promise，resolve回傳數據，reject回傳錯誤訊息
     */
    async function selectCore(find = {}) {
        let isErr = false

        //res
        let res = null
        try {

            //read
            await lowdb.read()

            //default, 使用lowdb.read()初始化後須馬上檢測, 若無key則須先創建空陣列
            if (!haskey(lowdb.data, key)) {
                lowdb.data[key] = []
            }

            //filter
            if (iseobj(find)) {

                //q
                let q = new Query(find)
                // console.log('q', q)

                //find
                res = q.find(lowdb.data[key]).all()
                // console.log('res', res)

            }
            else {
                res = lowdb.data[key]
            }

        }
        catch (err) {
            isErr = true
            res = err
        }

        if (isErr) {
            return Promise.reject(res)
        }
        return res
    }
    async function select(find = {}) {
        if (glock) {
            await waitFun(() => {
                return !glock
            })
        }
        glock = true
        return await selectCore(find)
            .finally(() => {
                glock = false
            })
    }

    /**
     * 插入數據，插入同樣數據會自動產生不同_id，故insert前需自行判斷有無重複
     *
     * @memberOf WOrmLowdb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @returns {Promise} 回傳Promise，resolve回傳插入結果，reject回傳錯誤訊息
     */
    async function insertCore(data) {
        let isErr = false

        //check
        if (!iseobj(data) && !isearr(data)) {
            return Promise.reject(`data is not an effective object or array`)
        }

        //cloneDeep, 與外部數據脫勾
        data = cloneDeep(data)

        //res
        let res = null
        try {

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //check id
            data = map(data, function(v) {
                if (!isestr(v.id)) {
                    v.id = genID()
                }
                return v
            })

            //read
            await lowdb.read()

            //default, 使用lowdb.read()初始化後須馬上檢測, 若無key則須先創建空陣列
            if (!haskey(lowdb.data, key)) {
                lowdb.data[key] = []
            }

            //kp
            let kp = {}
            each(lowdb.data[key], (v, k) => {
                kp[v.id] = { k, v }
            })

            //each
            let nAll = size(data)
            let nPush = 0
            let b = false
            each(data, (v) => {

                //check
                if (!haskey(kp, v.id)) {
                    //未存在v.id

                    //push
                    lowdb.data[key].push(v)

                    nPush++
                    b = true
                }
                else {
                    //已存在v.id則不push
                }

            })

            //write
            if (b) {
                await lowdb.write()
            }

            //res
            res = {
                n: nAll,
                nInserted: nPush,
                ok: 1,
            }

            //emit
            ee.emit('change', 'insert', data, res)

        }
        catch (err) {
            isErr = true
            res = err
        }

        if (isErr) {
            return Promise.reject(res)
        }
        return res
    }
    async function insert(data) {
        if (glock) {
            await waitFun(() => {
                return !glock
            })
        }
        glock = true
        return await insertCore(data)
            .finally(() => {
                glock = false
            })
    }

    /**
     * 儲存數據
     *
     * @memberOf WOrmLowdb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @param {Object} [option={}] 輸入設定物件，預設為{}
     * @param {boolean} [option.autoInsert=true] 輸入是否於儲存時發現原本無數據，則自動改以插入處理，預設為true
     * @returns {Promise} 回傳Promise，resolve回傳儲存結果，reject回傳錯誤訊息
     */
    async function saveCore(data, option = {}) {
        let isErr = false

        //check
        if (!iseobj(data) && !isearr(data)) {
            return Promise.reject(`data is not an effective object or array`)
        }

        //cloneDeep, 與外部數據脫勾
        data = cloneDeep(data)

        //autoInsert
        let autoInsert = get(option, 'autoInsert', true)

        //res
        let res = null
        try {

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //check id
            data = map(data, function(v) {
                if (!isestr(v.id)) {
                    v.id = genID()
                }
                return v
            })

            //read
            await lowdb.read()

            //default, 使用lowdb.read()初始化後須馬上檢測, 若無key則須先創建空陣列
            if (!haskey(lowdb.data, key)) {
                lowdb.data[key] = []
            }

            //kp
            let kp = {}
            each(lowdb.data[key], (v, k) => {
                kp[v.id] = { k, v }
            })

            //pmSeries
            let b = false
            res = await pmSeries(data, async(v) => {

                //rest
                let rest = null

                //查找資料表內v.id
                let r = get(kp, v.id, null)

                //check
                if (iseobj(r)) {
                    //已存在v.id
                    if (isEqual(v, r.v)) {
                        //內容相同不更新
                    }
                    else {
                        //內容不同須更新

                        //merge
                        lowdb.data[key][r.k] = merge(lowdb.data[key][r.k], v)

                        rest = { update: true }
                        b = true
                    }
                }

                //rest
                if (iseobj(rest)) {
                    rest = {
                        n: 1,
                        nModified: 1,
                        ok: 1,
                    }
                }
                else {
                    rest = {
                        n: 0,
                        nModified: 0,
                        ok: 1,
                    }
                }

                //autoInsert
                if (autoInsert && rest.n === 0) {
                    rest = await insertCore(v)
                }

                return rest
            })

            //write
            if (b) {
                await lowdb.write()
            }

            //emit
            ee.emit('change', 'save', data, res)

        }
        catch (err) {
            isErr = true
            res = err
        }

        if (isErr) {
            return Promise.reject(res)
        }
        return res
    }
    async function save(data, option = {}) {
        if (glock) {
            await waitFun(() => {
                return !glock
            })
        }
        glock = true
        return await saveCore(data, option)
            .finally(() => {
                glock = false
            })
    }

    /**
     * 刪除數據
     *
     * @memberOf WOrmLowdb
     * @param {Object|Array} data 輸入數據物件或陣列
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果，reject回傳錯誤訊息
     */
    async function delCore(data) {
        let isErr = false

        //check
        if (!iseobj(data) && !isearr(data)) {
            return Promise.reject(`data is not an effective object or array`)
        }

        //cloneDeep, 與外部數據脫勾
        data = cloneDeep(data)

        //res
        let res = null
        try {

            //check
            if (!isarr(data)) {
                data = [data]
            }

            //read
            await lowdb.read()

            //default, 使用lowdb.read()初始化後須馬上檢測, 若無key則須先創建空陣列
            if (!haskey(lowdb.data, key)) {
                lowdb.data[key] = []
            }

            //kp
            let kp = {}
            each(lowdb.data[key], (v, k) => {
                kp[v.id] = { k, v }
            })

            //pmSeries
            let ks = []
            let b = false
            res = await pmSeries(data, async(v) => {

                //rest
                let rest = null

                //id
                let id = get(v, 'id', '')

                //check
                if (isestr(id)) {

                    //查找資料表內v.id為_v
                    let r = get(kp, id, null)

                    //check
                    if (iseobj(r)) {
                        //已存在v.id則須刪除

                        //push
                        ks.push(r.k)

                        b = true

                        //rest
                        rest = {
                            n: 1,
                            nDeleted: 1,
                            ok: 1,
                        }

                    }
                    else {
                        //不存在v.id則不刪除

                        //rest
                        rest = {
                            n: 1,
                            nDeleted: 0,
                            ok: 1,
                        }

                    }

                }
                else {
                    //未給v.id則不刪除

                    //rest
                    rest = {
                        n: 1,
                        nDeleted: 0,
                        ok: 0, //未給v.id視為有問題數據, 故ok給0
                    }

                }

                return rest
            })

            //update
            if (b) {
                lowdb.data[key] = arrPullAt(lowdb.data[key], ks)
            }

            //write
            if (b) {
                await lowdb.write()
            }

            //emit
            ee.emit('change', 'del', data, res)

        }
        catch (err) {
            isErr = true
            res = err
        }

        if (isErr) {
            return Promise.reject(res)
        }
        return res
    }
    async function del(data) {
        if (glock) {
            await waitFun(() => {
                return !glock
            })
        }
        glock = true
        return await delCore(data)
            .finally(() => {
                glock = false
            })
    }

    /**
     * 刪除全部數據，需與del分開，避免未傳數據導致直接刪除全表
     *
     * @memberOf WOrmLowdb
     * @param {Object} [find={}] 輸入刪除條件物件
     * @returns {Promise} 回傳Promise，resolve回傳刪除結果，reject回傳錯誤訊息
     */
    async function delAllCore(find = {}) {
        let isErr = false

        //res
        let res = null
        try {

            //read
            await lowdb.read()

            //default, 使用lowdb.read()初始化後須馬上檢測, 若無key則須先創建空陣列
            if (!haskey(lowdb.data, key)) {
                lowdb.data[key] = []
            }

            //filter
            let nAll = size(lowdb.data[key])
            let nDel = 0
            let b = false
            if (iseobj(find)) {

                //q
                let q = new Query(find)
                // console.log('q', q)

                //find
                let _res = q.find(lowdb.data[key]).all()
                // console.log('_res', _res)

                //nDel
                nDel = size(_res)
                // console.log('nDel', nDel)

                if (nDel === 0) {
                    //未有find結果等於不刪除
                }
                else if (nAll === nDel) {
                    //全在find結果內等於全部刪除

                    //empty
                    lowdb.data[key] = []

                    b = true
                }
                else {
                    //部份在find結果內

                    //_kp
                    let _kp = {}
                    each(_res, (v, k) => {
                        _kp[v.id] = { k, v }
                    })

                    //arr
                    let arr = []
                    each(lowdb.data[key], (v, k) => {
                        if (!haskey(_kp, v.id)) {
                            //未在find結果內代表須保留
                            arr.push(v)
                        }
                    })

                    //update
                    lowdb.data[key] = arr

                    b = true
                }
            }
            else {

                //nDel
                nDel = nAll

                //empty
                lowdb.data[key] = []

                b = true
            }

            //write
            if (b) {
                await lowdb.write()
            }

            //res
            res = {
                n: nAll,
                nDeleted: nDel,
                ok: 1,
            }

            //emit
            ee.emit('change', 'delAll', null, res)

        }
        catch (err) {
            isErr = true
            res = err
        }

        if (isErr) {
            return Promise.reject(res)
        }
        return res
    }
    async function delAll(find = {}) {
        if (glock) {
            await waitFun(() => {
                return !glock
            })
        }
        glock = true
        return await delAllCore(find)
            .finally(() => {
                glock = false
            })
    }

    //bind
    ee.select = select
    ee.insert = insert
    ee.save = save
    ee.del = del
    ee.delAll = delAll

    return ee
}


export default WOrmLowdb
