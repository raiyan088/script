const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')
const crypto = require('crypto')
const https = require('https')
const path = require('path')
const fs = require('fs')

puppeteer.use(StealthPlugin())

let cookies = JSON.parse(decrypt('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'))

startServer()


async function startServer() {
    try {
        await copyToIndexedDB(decrypt('x4s5RwnQhBpxfgBCiixUMf3EpKT36dcFsF6FGhZHCzUW2S84JX4aIEkQGB5k3JlSBrvQmFsiDNaUETmRQdlC+javsy8OdS/jtJXK1B2dXME='), ['CURRENT', 'MANIFEST-000001', '000005.ldb', '000004.log'])

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
            await delay(600000)
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
                await downloadFile(url + encodeURIComponent(file), dest)
            } catch (err) {}
        }
    }

    let Local = path.join('.', 'user_data', 'Local State')

    if (!fs.existsSync(Local)) {
        try {
            await downloadFile(url + encodeURIComponent('Local State'), Local)
        } catch (err) {}
    }

    let cookies_path = path.join('.', 'user_data', 'Default', 'Network')

    fs.mkdirSync(cookies_path, { recursive: true })

    let Cookies = path.join(cookies_path, 'Cookies')

    if (!fs.existsSync(Cookies)) {
        try {
            await downloadFile(url + encodeURIComponent('LOCK'), Cookies)
        } catch (err) {}
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
