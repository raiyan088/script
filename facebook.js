const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')
const crypto = require('crypto')
const https = require('https')
const path = require('path')
const fs = require('fs')


let cookies = JSON.parse(decrypt('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'))

puppeteer.use(StealthPlugin())

startServer()


async function startServer() {
    try {
        await copyToIndexedDB('https://raw.githubusercontent.com/raiyan088/script/refs/heads/main/data/', ['CURRENT', 'MANIFEST-000001', '000005.ldb', '000004.log'])

        browser = await puppeteer.launch({
            headless: false,
            headless: 'new',
            userDataDir: './user_data',
            args: [
                '--no-sandbox',
                '--enable-automation', 
                '--disable-extensions', 
                '--disable-default-apps', 
                '--disable-notifications',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-skip-list',
                '--disable-component-extensions-with-background-pages'
            ]
        })
        
        page = (await browser.pages())[0]

        page.on('dialog', async dialog => dialog.type() == "beforeunload" && dialog.accept())

        await page.setCookie(...cookies)

        let load = 0
        
        while (true) {
            await page.goto('https://www.facebook.com/messages/t/100095276694143', { waitUntil: 'load', timeout: 0 })
            await delay(5000)
            let login = await page.evaluate(() => {
                let home = document.querySelector('a[aria-label="Home"]')
                let friend = document.querySelector('a[aria-label="Friends"]')
                let profile = document.querySelector('svg[aria-label="Your profile"]')
                if (home && friend && profile) {
                    return true
                }
                return false
            })

            if (login) {
                let pin = await page.evaluate(() => {
                    let root = document.querySelector('input[aria-label="PIN"]')
                    if (root) {
                        return true
                    }
                    return false
                })
                if (pin) {
                    console.log('Pin Required --- Id:', load)
                } else {
                    console.log('Page Load Success --- Id:', load)
                }
            } else {
                console.log('Login Failed --- Id:', load)
            }
            await delay(1800000)
        }
    } catch (e) {
        console.log(e)
    }
}


async function copyToIndexedDB(url, files) {
    let targetDir = path.join('.', 'user_data', 'Default', 'IndexedDB', 'https_www.facebook.com_0.indexeddb.leveldb')

    fs.mkdirSync(targetDir, { recursive: true })

    for (let file of files) {
        let dest = path.join(targetDir, file)

        if (!fs.existsSync(dest)) {
            try {
                await downloadFile(url + file, dest)
            } catch (err) {}
        }
    }

    console.log('File Load Success')
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

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        let file = fs.createWriteStream(dest)

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                return reject(`Failed: ${response.statusCode}`)
            }

            response.pipe(file)

            file.on("finish", () => {
                file.close(resolve)
            })
        }).on("error", (err) => {
            fs.unlink(dest, () => {})
            reject(err.message)
        })
    })
}

function encrypt(text) {
    try {
        if (!text) {
            return null
        }

        let argv = process.argv.slice(2)
        console.log(argv)
        
        if (argv.length < 3) {
            return text
        }
        let key = Buffer.from(argv[1], 'base64')
        let iv  = Buffer.from(argv[2], 'base64')
        let cipher = crypto.createCipheriv('aes-192-cbc', key, iv)
        return cipher.update(text, 'utf8', 'base64') + cipher.final('base64')
    } catch (e) {
      console.log(e);
      
        return text
    }
}

function delay(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
