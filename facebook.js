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
