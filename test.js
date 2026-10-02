const { execSync, fork } = require('child_process')

startProcess() 

async function startProcess() {
    let start = Date.now()
    let args = process.argv.slice(2)

    mScript = fork('./founder.js', [ 'xxxxxxxxxx12345', args[0], args[1] ])

    let number = 8801833007000
    let next = 30

    mScript.send(JSON.stringify({ t:1, n: number, s:next, u:'00000000000000000000000000000000', k: 1745896853096, d:0 }))

    mScript.on('message', (data) => {
        try {
            console.log(data.d.f, data.d.r, data.d.c, data.d.o)
        } catch (error) {
            console.log(data)
        }
        console.log(Date.now()-start)

        number += next
        start = Date.now()
        mScript.send(JSON.stringify({ t:1, n: number, s:next, u:'00000000000000000000000000000000', k: 1745896853096, d:0 }))
    })
}
