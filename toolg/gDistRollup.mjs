import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: getFiles(fdSrc),
    fdSrc,
    fdTar,
    nameDistType: 'kebabCase',
    globals: {
        'events': 'events',
        'lowdb': 'lowdb',
        'mingo': 'mingo',
    },
    external: [
        'events',
        'lowdb',
        'mingo',
    ],
})

