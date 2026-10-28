import { types } from 'util'


//診斷輸出之單一出口(R-DIAG-01): src內所有console輸出皆經getDiag回傳之diag, 除本檔外不得直接呼叫console
//預設只輸出固定標籤與不含個資之摘要(不含資料值、id、使用端程式拋出之錯誤原文與堆疊); 資料庫檔案位置(opt.url, 本套件之連線字串)於任何輸出(含logDetail與funLog之細節)一律以***遮罩
//選項名稱與語意比照w-serv-orm、w-orm-reladb: opt.logDetail(還原細節輸出)、opt.funLog(label, safe, detail)(取代console收完整細節)
//util.types用於內部槽判斷(isProxy、isNativeError、isPromise等, 不觸發使用端的trap與getter), 同w-serv-orm; Node內建模組不需列入rollup之external(建置實測, 見帳本R-DIAG-01)


//遮罩字串
const MASK = '***'

//秘密(資料庫檔案位置)至少需3字元才遮罩: 過短者(如a)遮罩會把無關文字一併吞掉
const SECRET_MIN = 3

//cpMask之上限: 深度, 處理的節點與鍵合計數; 超過者以標記字串代替(不交出原參照)
const CP_DEPTH = 6
const CP_MAX = 2000

//原型鏈走訪之步數上限(防呆: 異常的原型鏈不得使診斷輸出無限迴圈)
const HOPS = 64

//錯誤類別名稱的白名單樣式: 只放行建構子名稱(程式識別字), 其餘(可能夾帶資料值之文字)不進預設輸出
const RE_ERR_TYPE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/

//錯誤代碼的白名單樣式: 系統慣用之機器代碼, E開頭後須為大寫英文字母(ENOENT、EACCES、EAI_AGAIN, 另E2BIG), 排除E後接數字者(如E123456789之身分證字號), 與Node之ERR_xxx; 不放行整數(可能為訂單、郵遞區號等資料)
const RE_ERR_CODE = /^(E[A-Z]{2,15}(?:_[A-Z]{2,15})?|E2BIG|ERR_[A-Z0-9_]{1,40})$/

//連線字串內嵌之帳密(scheme://帳密@主機), 不依賴已知秘密亦遮罩; 帳密部分含未編碼之@時取至最後一個@(至空白、/或引號為止)
const RE_URL_CRED = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/'"]*@/g

//Error的stack於V8為自有存取器, 其getter為同一realm內共用的內建函數: 僅當描述子的getter與此相同才讀取(不執行使用端程式)
const STACK_GETTER = (() => {
    try {
        let d = Object.getOwnPropertyDescriptor(new Error(), 'stack')
        return d !== undefined && !Object.prototype.hasOwnProperty.call(d, 'value') && typeof d.get === 'function' ? d.get : null
    }
    catch (e) {
        return null
    }
})()

//二進位資料byteLength的內建getter(以.call讀內部槽, 不讀使用端可覆寫的屬性)
const BL_AB = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get
const BL_TA = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get
const BL_DV = Object.getOwnPropertyDescriptor(DataView.prototype, 'byteLength').get


function getOptLog(opt) {
    //診斷輸出的設定, 供WOrmLowdb建構時使用, 回傳固定快照{ logDetail, funLog }, 其後各路徑共用此快照, 不再讀取使用端的opt
    //型別錯誤者忽略並用預設(安全輸出), 讀取opt拋錯者亦同, 與本套件其他選項(useCache、autoGenPk型別錯誤即用預設)一致; 各選項分別讀取, 單一getter拋錯只丟該選項
    //logDetail: 須為true才生效, 預設false; true時console輸出還原為含使用端拋出之錯誤原文的完整細節(資料庫檔案位置仍遮罩), 供除錯
    //funLog: 須為函數才生效, 預設無; 給予時診斷輸出只交給它(不寫console), detail為完整細節(資料庫檔案位置仍遮罩), 供使用端遮罩或轉送
    let logDetail = false
    try {
        logDetail = opt.logDetail === true
    }
    catch (e) {
        //忽略
    }
    let funLog = null
    try {
        let f = opt.funLog
        funLog = typeof f === 'function' ? f : null
    }
    catch (e) {
        //忽略
    }
    return { logDetail, funLog }
}


function getSecrets(vals) {
    //連線憑證清單: 資料庫檔案位置(opt.url原樣、絕對路徑、經path.normalize與steno暫存檔名等衍生路徑, 由呼叫端列入vals),
    //各取原樣、斜線與反斜線互換、磁碟機代號大小寫互換、UNC命名空間(\\server → UNC\server)之基底, 每個基底再取原樣、JSON跳脫(反斜線加倍)、encodeURI(file:///網址之路徑段)與encodeURIComponent之形式;
    //長者在前, 使長字串先被遮罩; 少於SECRET_MIN字元者不納入
    //註: 本套件無帳號與密碼, 資料庫檔案位置即連線字串
    let isOk = (s) => typeof s === 'string' && s.length >= SECRET_MIN
    let tryDo = (fn, s) => {
        try {
            return fn(s)
        }
        catch (e) {
            return '' //孤立代理碼元無法編碼, 略過
        }
    }
    let all = []
    for (let s of vals) {
        if (!isOk(s)) {
            continue
        }
        let bases = [s, s.replace(/\\/g, '/'), s.replace(/\//g, '\\')]
        for (let b of bases.slice()) {
            if (/^[A-Za-z]:/.test(b)) {
                let c = b[0]
                bases.push((c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + b.slice(1))
            }
            if (b.startsWith('\\\\') && !b.startsWith('\\\\?\\')) {
                bases.push(`UNC${b.slice(1)}`)
            }
        }
        for (let b of bases) {
            all.push(b, tryDo((x) => JSON.stringify(x).slice(1, -1), b), tryDo(encodeURI, b), tryDo(encodeURIComponent, b))
        }
    }
    return all.filter((s, k) => isOk(s) && all.indexOf(s) === k).sort((a, b) => b.length - a.length)
}


function getNums(secrets) {
    //秘密中純數字且至少4位者: 數值型別之同值亦須遮罩; 過短者(如1)遮罩會吞掉大量無關數值, 不納入
    return new Set(secrets.filter((s) => /^[0-9]{4,}$/.test(s)))
}


function maskText(s, secrets = []) {
    //字串中之憑證以***取代: 已知秘密(getSecrets)、scheme://帳密@(帳密含@時取至最後一個@)
    if (typeof s !== 'string') {
        return s
    }
    let r = s
    for (let sec of secrets) {
        if (r.indexOf(sec) >= 0) {
            r = r.split(sec).join(MASK)
        }
    }
    return r.replace(RE_URL_CRED, `$1${MASK}@`)
}


function maskSym(s, c) {
    //Symbol值之遮罩: 描述文字可能含憑證, 變動者以遮罩後之描述建立新Symbol
    let d = s.description
    let m = typeof d === 'string' ? maskText(d, c.secrets) : d
    return m === d ? s : Symbol(m)
}


function maskKey(k, c) {
    //屬性鍵之遮罩: 字串鍵與Symbol之描述文字皆可能含憑證
    return typeof k === 'string' ? maskText(k, c.secrets) : maskSym(k, c)
}


function maskSafe(safe, secrets, nums) {
    //safe摘要之防禦性遮罩: 摘要由src以固定欄位組成(操作別、類別名稱、機器代碼), 其值若恰等於已知憑證(如數字代碼恰同資料庫檔案位置)仍以***取代
    if (safe === null || typeof safe !== 'object') {
        return safe
    }
    let r = {}
    for (let k of Object.keys(safe)) {
        let v = safe[k]
        r[k] = typeof v === 'string' ? maskText(v, secrets) : ((typeof v === 'number' || typeof v === 'bigint') && nums.has(String(v)) ? MASK : v)
    }
    return r
}


function ownData(o, k) {
    //取o自有資料屬性k之值, 不執行getter, 不觸發Proxy的trap; 非資料屬性、Proxy或無則undefined
    try {
        if (o === null || (typeof o !== 'object' && typeof o !== 'function') || types.isProxy(o)) {
            return undefined
        }
        let d = Object.getOwnPropertyDescriptor(o, k)
        return d !== undefined && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined
    }
    catch (e) {
        return undefined
    }
}


function isErrLike(v) {
    //是否為錯誤: 原生Error(內部槽判斷), 或原型鏈含Error.prototype(函數式自訂錯誤); 不用instanceof(其會觸發原型鏈上Proxy的trap), 沿鏈走訪遇Proxy即止, 步數有上限
    if (types.isNativeError(v)) {
        return true
    }
    let x = v
    for (let k = 0; k < HOPS; k++) {
        if (x === null || types.isProxy(x)) {
            return false
        }
        x = Object.getPrototypeOf(x)
        if (x === Error.prototype) {
            return true
        }
    }
    return false
}


function getCtorName(v) {
    //錯誤之建構子名稱: 沿原型鏈取第一個自有資料屬性constructor(函數)之自有資料屬性name, 不執行getter, 遇Proxy即止, 步數有上限
    let x = v
    for (let k = 0; k < HOPS && x !== null && !types.isProxy(x); k++) {
        let ctor = ownData(x, 'constructor')
        if (typeof ctor === 'function') {
            return ownData(ctor, 'name')
        }
        x = Object.getPrototypeOf(x)
    }
    return undefined
}


function isPlainProp(v, k) {
    //沿原型鏈找屬性k, 其是否可安全轉為字串(讀取與轉字串皆不會執行使用端程式): 找到且為資料屬性, 值為非Symbol之原始型別者true; 找不到亦true(讀得undefined);
    //存取器、值為物件或Symbol、遇Proxy或步數用盡者false
    let x = v
    for (let i = 0; i < HOPS; i++) {
        if (x === null) {
            return true
        }
        if (types.isProxy(x)) {
            return false
        }
        let d = Object.getOwnPropertyDescriptor(x, k)
        if (d !== undefined) {
            return Object.prototype.hasOwnProperty.call(d, 'value') && (d.value === null || (typeof d.value !== 'object' && typeof d.value !== 'function' && typeof d.value !== 'symbol'))
        }
        x = Object.getPrototypeOf(x)
    }
    return false
}


function mkErrProto(v, c) {
    //Error副本之原型: Error.prototype之子物件, 只帶一個constructor(名稱同原錯誤之建構子名稱, 使util.inspect輸出TypeError、自訂類別名稱等, 與舊版console.log(錯誤)一致),
    //不沿用使用端原型上的任何屬性(其繼承屬性未遮罩、util.inspect.custom會在格式化時執行); 建構子名稱只讀自有資料屬性(不執行getter), 為Error或無名稱者不另建
    let cname = getCtorName(v)
    if (typeof cname !== 'string' || cname === '' || cname === 'Error') {
        return null
    }
    let F = function() {}
    Object.defineProperty(F, 'name', { value: maskText(cname, c.secrets), configurable: true })
    F.prototype = Object.create(Error.prototype, { constructor: { value: F, writable: true, configurable: true } })
    return F.prototype
}


function unbox(v) {
    //包裝物件(new String、new Number等)之原始值, 以內建valueOf讀內部槽(不讀使用端可覆寫之屬性); 非包裝物件回null
    if (types.isStringObject(v)) {
        return { raw: String.prototype.valueOf.call(v) }
    }
    if (types.isNumberObject(v)) {
        return { raw: Number.prototype.valueOf.call(v) }
    }
    if (types.isBooleanObject(v)) {
        return { raw: Boolean.prototype.valueOf.call(v) }
    }
    if (types.isBigIntObject(v)) {
        return { raw: BigInt.prototype.valueOf.call(v) }
    }
    if (types.isSymbolObject(v)) {
        return { raw: Symbol.prototype.valueOf.call(v) }
    }
    return null
}


function cp(v, c, depth) {
    //遞迴複製並遮罩, 不執行使用端程式(不呼叫getter、實例方法、建構子, 不觸發Proxy的trap), 不交出原參照; 副本原型一律為內建原型(不沿用使用端的原型: 其繼承屬性未遮罩、util.inspect.custom會在格式化時執行)
    if (typeof v === 'string') {
        return maskText(v, c.secrets)
    }
    if (typeof v === 'number' || typeof v === 'bigint') {
        return c.nums.has(String(v)) ? MASK : v
    }
    if (typeof v === 'symbol') {
        return maskSym(v, c)
    }
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) {
        return v
    }
    if (typeof v === 'function') {
        return '[Function]'
    }
    if (depth >= CP_DEPTH || c.n >= CP_MAX) {
        return '[Truncated]'
    }
    if (c.seen.has(v)) {
        return c.seen.get(v)
    }
    c.n++
    try {
        if (types.isProxy(v)) {
            return '[Proxy]'
        }
        let u = unbox(v)
        if (u !== null) {
            return Object(cp(u.raw, c, depth + 1))
        }
        if (types.isArrayBuffer(v)) {
            return `[Binary ${BL_AB.call(v)} bytes]`
        }
        if (types.isTypedArray(v)) {
            return `[Binary ${BL_TA.call(v)} bytes]`
        }
        if (types.isDataView(v)) {
            return `[Binary ${BL_DV.call(v)} bytes]`
        }
        if (types.isSharedArrayBuffer(v)) {
            return '[SharedArrayBuffer]'
        }
        if (types.isDate(v)) {
            return new Date(Date.prototype.getTime.call(v))
        }
        if (types.isMap(v) || types.isSet(v) || types.isWeakMap(v) || types.isWeakSet(v) || types.isRegExp(v) || types.isPromise(v) || types.isGeneratorObject(v) || types.isMapIterator(v) || types.isSetIterator(v) || types.isModuleNamespaceObject(v) || types.isExternal(v)) {
            return '[Object]' //無法複製的內建物件
        }
        let isArr = Array.isArray(v)
        let isErr = !isArr && isErrLike(v)
        let r = isArr ? new Array(v.length) : (isErr ? new Error() : {})
        if (isErr) {
            delete r.stack //new Error()自帶指向本檔之堆疊, 原錯誤無自有stack者(如已刪除stack)不得顯示它
            let p = mkErrProto(v, c)
            if (p !== null) {
                Object.setPrototypeOf(r, p)
            }
        }
        c.seen.set(v, r)
        let keys = Reflect.ownKeys(v)
        let iLast = -1 //陣列最後一個已複製之索引
        for (let i = 0; i < keys.length; i++) {
            let k = keys[i]
            if (c.n >= CP_MAX) {
                //預算用盡: 其餘鍵不複製, 附標記(物件為鍵'[Truncated]', 值為未複製之鍵數; 陣列截短並以最後一個元素'[Truncated]'標示)
                if (isArr) {
                    r.length = iLast + 1
                    r.push('[Truncated]')
                }
                else {
                    Object.defineProperty(r, '[Truncated]', { value: keys.length - i, writable: true, enumerable: true, configurable: true })
                }
                break
            }
            if (k === 'length' && isArr) {
                continue
            }
            let d = Object.getOwnPropertyDescriptor(v, k)
            if (d === undefined) {
                continue
            }
            c.n++
            let val = '[Getter/Setter]'
            if (Object.prototype.hasOwnProperty.call(d, 'value')) {
                val = cp(d.value, c, depth + 1)
            }
            else if (isErr && k === 'stack' && STACK_GETTER !== null && d.get === STACK_GETTER && isPlainProp(v, 'name') && isPlainProp(v, 'message')) {
                //stack於V8為內建存取器, 首次讀取時會讀name與message(其為存取器、物件或Symbol時會執行使用端程式或拋錯): 僅當其getter嚴格等於同realm共用之內建getter, 且name與message皆可安全讀取時才讀;
                //讀取失敗只影響stack本身, 不毀掉整個副本; 註: 若使用端設定了全域Error.prepareStackTrace, V8於首次格式化時會呼叫它(與一般讀取錯誤堆疊相同, 非針對該拋出之值), 屬已知限制(帳本R-DIAG-01)
                try {
                    let s = STACK_GETTER.call(v)
                    val = typeof s === 'string' ? maskText(s, c.secrets) : val
                }
                catch (e) {
                    //沿用標記
                }
            }
            let isIdx = isArr && typeof k === 'string' && /^(?:0|[1-9][0-9]{0,9})$/.test(k) && Number(k) < 4294967295 //陣列索引上限為2^32-2
            if (isIdx) {
                iLast = Number(k)
            }
            Object.defineProperty(r, isIdx ? k : maskKey(k, c), { value: val, writable: true, enumerable: d.enumerable, configurable: true })
        }
        if (isErr && !Object.prototype.hasOwnProperty.call(r, 'name')) {
            //類別名稱常在原型上(class MyError extends Error): 取原型鏈上第一個name資料屬性(字串), 副本才保有類別名稱
            let x = v
            for (let i = 0; i < HOPS && x !== null && !types.isProxy(x); i++) {
                let d = Object.getOwnPropertyDescriptor(x, 'name')
                if (d !== undefined) {
                    if (Object.prototype.hasOwnProperty.call(d, 'value') && typeof d.value === 'string') {
                        Object.defineProperty(r, 'name', { value: maskText(d.value, c.secrets), writable: true, enumerable: false, configurable: true })
                    }
                    break
                }
                x = Object.getPrototypeOf(x)
            }
        }
        return r
    }
    catch (e) {
        return '[Uncopyable]'
    }
}


function cpMask(v, secrets = []) {
    //交給console或funLog之完整細節的遮罩拷貝: 憑證以***取代(值、屬性鍵、Symbol描述、同值數字), 不改動呼叫端的原物件
    //複製: 純物件與類別實例(複製自有屬性成普通物件, 不保留原型)、陣列、原生Error(含message、stack、cause、類別名稱name)、Date、包裝物件; 標記字串代替: 函數、Proxy、二進位資料、Map與Set等內建物件、存取器、過深或過大者
    return cp(v, { secrets, nums: getNums(secrets), n: 0, seen: new WeakMap() }, 0)
}


function noop() {
    //吞下funLog回傳之promise的reject
}


function swallow(r) {
    //funLog的回傳若為promise或thenable, 附上reject處理, 使其reject不成為unhandledRejection; 全程不使診斷輸出拋錯
    //原生promise用內建then(不讀其可被覆寫的then屬性); 其他thenable只讀一次then並以其為this呼叫, 回傳之原生promise亦附處理
    try {
        if (types.isPromise(r)) {
            Promise.prototype.then.call(r, undefined, noop)
            return
        }
        if (r !== null && (typeof r === 'object' || typeof r === 'function')) {
            let t = r.then
            if (typeof t === 'function') {
                let x = t.call(r, undefined, noop)
                if (types.isPromise(x)) {
                    Promise.prototype.then.call(x, undefined, noop)
                }
            }
        }
    }
    catch (e) {
        //放棄
    }
}


function getDiag(optLog, secrets = []) {
    //回傳診斷輸出函數diag(label, safe, getDetail, bare), 所有診斷輸出皆經此(R-DIAG-01)
    //optLog: getOptLog之快照(亦接受任意物件, 一律再經getOptLog正規化, 冪等); label: 固定標籤; safe: 不含資料值、id與錯誤原文的摘要(預設輸出), 無則undefined;
    //getDetail: 回傳完整細節的函數(只在有消費者時才呼叫), 無細節則undefined; bare: 為true者, logDetail還原時只輸出細節而不加label(舊版該站即為console.log(細節))
    //輸出不得使呼叫端的流程拋錯: 細節的取得、console與funLog的拋錯一律吞下; funLog回傳的promise之reject亦吞下
    let { logDetail, funLog } = getOptLog(optLog)
    let nums = getNums(secrets)
    return (label, safeRaw, getDetail, bare = false) => {

        //safe, 摘要(防禦性遮罩後)
        let safe = maskSafe(safeRaw, secrets, nums)

        //getArgs, 完整細節(憑證遮罩後); 僅在需要時取得
        let getArgs = () => {
            if (getDetail === undefined) {
                return []
            }
            try {
                return [cpMask(getDetail(), secrets)]
            }
            catch (e) {
                return ['(unprintable)']
            }
        }

        //funLog, 取代console輸出
        if (funLog !== null) {
            try {
                swallow(funLog(label, safe, ...getArgs()))
            }
            catch (e) {
                //放棄輸出
            }
            return
        }

        //console, 預設為安全摘要; logDetail為true時還原完整細節
        try {
            if (logDetail) {
                console.log(...(bare ? [] : [label]), ...getArgs())
            }
            else if (safe === undefined) {
                console.log(label)
            }
            else {
                console.log(label, safe)
            }
        }
        catch (e) {
            try {
                console.log(label, '(unprintable)')
            }
            catch (e2) {
                //放棄輸出
            }
        }
    }
}


function isErrCode(c) {
    //錯誤代碼是否為機器代碼: 僅ENOENT類(E開頭後為大寫英文字母)、E2BIG、ERR_開頭之字串
    return typeof c === 'string' && RE_ERR_CODE.test(c)
}


function getBriefErr(e) {
    //錯誤(訂閱函數拋出的值)的摘要: 只列類別與代碼, 不含訊息文字; 全程不執行getter與使用端程式, 不觸發Proxy的trap
    //字串列為string; Proxy列為Proxy; Error取其建構子名稱(程式識別字, 非資料), 不合識別字樣式者列為Error; 代碼只取自Error之自有資料屬性code, 限機器代碼樣式(一般物件之code可能為業務資料, 不取)
    try {
        if (typeof e === 'string') {
            return { errType: 'string' }
        }
        if (e === null || (typeof e !== 'object' && typeof e !== 'function')) {
            return { errType: e === null ? 'null' : typeof e }
        }
        if (types.isProxy(e)) {
            return { errType: 'Proxy' }
        }
        let r = { errType: typeof e === 'function' ? 'function' : 'object' }
        if (isErrLike(e)) {
            let cname = getCtorName(e)
            r.errType = typeof cname === 'string' && RE_ERR_TYPE.test(cname) ? cname : 'Error'
            let c = ownData(e, 'code')
            if (isErrCode(c)) {
                r.errCode = c
            }
        }
        return r
    }
    catch (e2) {
        return { errType: 'unknown' }
    }
}


export { getOptLog, getSecrets, maskText, cpMask, getDiag, getBriefErr }
