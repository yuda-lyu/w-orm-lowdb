import WOrmLowdb from './src/WOrmLowdb.mjs'

async function run() {
    const orm = await WOrmLowdb('db.json', 'users')

    // 插入資料
    await orm.insert({ id: 1, name: 'Alice' })

    // 查詢資料
    console.log(await orm.select())

    // 更新資料
    await orm.save(user => user.id === 1, { name: 'Alice Updated' })

    // 刪除資料
    await orm.del(user => user.id === 1)

    // 清空資料表
    await orm.delAll()
}

run()

//node --experimental-modules g.mjs
