# w-orm-lowdb
An operator for lowdb in nodejs.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-orm-lowdbvg?style=flat)](https://npmjs.org/package/w-orm-lolowdb
[![license](https://img.shields.io/npm/l/w-orm-lowdbvg?style=flat)](https://npmjs.org/package/w-orm-lolowdb
[![npm download](https://img.shields.io/npm/dt/w-orm-lowdbvg)](https://npmjs.org/package/w-orm-lolowdb
[![npm download](https://img.shields.io/npm/dm/w-orm-lowdbvg)](https://npmjs.org/package/w-orm-lolowdb
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-orm-lowdbvg)](https://www.jsdelivr.com/package/npm/w-orm-lolowdb

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-orm-lowdbOrm.html).

## Installation
### Using npm(ES6 module):
```alias
npm i w-orm-lowdb
```
#### Example
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-lowdblob/master/g-basic.mjs)]
```alias
import wo from 'w-orm-lowdb'

let opt = {
    url: './db.json',
    db: 'worm',
    cl: 'users',
}

let rs = [
    {
        id: 'id-peter',
        name: 'peter'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary'
    },
    {
        id: '',
        name: 'kettle'
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function test() {


    //w
    let w = wo(opt)


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })
    // => delAll then { n: 2, nDeleted: 2, ok: 1 }


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })
    // => insert then { n: 3, nInserted: 3, ok: 1 }


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })
    // => save then [ 
    //                { n: 1, nModified: 1, ok: 1 },
    //                { n: 1, nModified: 1, ok: 1 }, 
    //                { n: 0, nModified: 0, ok: 1 }, //autoInsert=false
    //                { n: 1, nInserted: 1, ok: 1 }  //autoInsert=true
    //              ]


    //select all
    let ss = await w.select()
    console.log('select all', ss)
    // => select all [ 
    //                 { id: 'id-peter', name: 'peter(modify)', value: 123 },
    //                 { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
    //                 { id: '{random id}', name: 'kettle', value: 456 },
    //                 { id: '{random id}', name: 'kettle(modify)' } //autoInsert=true
    //               ]


    //select
    let so = await w.select({ id: 'id-rosemary' })
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    // => select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 200 } }] })
    // => select [ { id: '{random id}', name: 'kettle', value: 456 } ]


    //select by $or, $and, $ne, $in, $nin
    let spc = await w.select({ '$or': [{ '$and': [{ value: { '$ne': 123 } }, { value: { '$in': [123, 321, 123.456, 456] } }, { value: { '$nin': [456, 654] } }] }, { '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] }] })
    console.log('select by $or, $and, $ne, $in, $nin', spc)
    // => select [
    //             { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
    //             { id: '{random id}', name: 'kettle', value: 456 }
    //           ]


    //del
    let d = ss.filter(function(v) {
        return v.name === 'kettle'
    })
    w.del(d)
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })
    // => del then [ { n: 1, nDeleted: 1, ok: 1 } ]
    

}
test()
```
