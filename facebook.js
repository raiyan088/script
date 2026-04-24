const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')
const crypto = require('crypto')
const https = require('https')
const path = require('path')
const fs = require('fs')

puppeteer.use(StealthPlugin())

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
