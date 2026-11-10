const { execSync, fork } = require('child_process')

startProcess() 

function getRandom7Digit() {
    return Math.floor(1000000 + Math.random() * 9000000);
}

async function startProcess() {
    let start = Date.now()
    let args = process.argv.slice(2)

    mScript = fork('./founder.js', [ 'gmailclect67849', args[0], args[1] ])

    let number = 8801779873000+getRandom7Digit()
    // number = 8801779873000
    // let target = 8801779974000
    let found = 0
    let capture = 0
    let recap = 0
    let others = 0
    let next = 50

    mScript.send(JSON.stringify({ t:1, n: number, s:next, u:'00000000000000000000000000000000', k: 1745896853096, d:0, b:10 }))

    mScript.on('message', (data) => {
        try {
            found += data.d.f
            recap += data.d.r
            capture += data.d.c
            others += data.d.o
            console.log(data.d.f, data.d.r, data.d.c, data.d.o)
        } catch (error) {
            console.log(data)
        }
        console.log(Date.now()-start)

        number += next
        start = Date.now()
        mScript.send(JSON.stringify({ t:1, n: number, s:next, u:'00000000000000000000000000000000', k: 1745896853096, d:0, b:10 }))
    })
}
