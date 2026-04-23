const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')
const crypto = require('crypto')


let cookies = JSON.parse(decrypt('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'))

puppeteer.use(StealthPlugin())

startServer()


async function startServer() {
    try {
        browser = await puppeteer.launch({
            headless: false,
            headless: 'new',
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
            console.log('Page Load:', load++)
            await page.goto('https://www.facebook.com/settings', { waitUntil: 'load', timeout: 0 })
            await delay(600000)
        }
    } catch (e) {
        console.log(e)
    }
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
