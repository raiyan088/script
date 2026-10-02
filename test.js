const { execSync, fork } = require('child_process')

startProcess() 

async function startProcess() {
    let start = Date.now()
    let args = process.argv.slice(2)

    mScript = fork('./founder.js', [ 'xxxxxxxxxx12345', args[0], args[1] ])

    mScript.send(JSON.stringify({ t:1, n: 8801833007000, s:50, u:'00000000000000000000000000000000', k: 1745896853096, d:0 }))

    mScript.on('message', (data) => {
        console.log(data)
        console.log(Date.now()-start)
    })
}
