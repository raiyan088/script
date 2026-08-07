const { spawn } = require('child_process')
const crypto = require('crypto')
const https = require('https')
const fs = require('fs')

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
        console.log(e)
        return null
    }
}

function sendMessageToParent(data) {
    try {
        if (process.send) {
            process.send(data)
        }
    } catch (error) {}
}

function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Failed to download, status code: ${res.statusCode}`))
            }

            let data = ''
            res.setEncoding('utf8')
            
            res.on('data', (chunk) => {
                data += chunk
            });
            
            res.on('end', () => {
                resolve(data)
            })
        }).on('error', (err) => {
            reject(err)
        })
    })
}

async function startTask() {
    sendMessageToParent({ t: 9, s: true })

    try {
        let argv = process.argv.slice(2)

        if (argv.length < 3) {
            console.log('Error: Key and IV are required.')
            sendMessageToParent({ t: 8, s: true })
            return
        }

        console.log('Downloading file from URL...')

        let encryptedData = await downloadFile('https://raw.githubusercontent.com/raiyan088/script/refs/heads/main/facebook.py')
        let deviceData = await downloadFile('https://raw.githubusercontent.com/raiyan088/script/refs/heads/main/devices.json')
        let nameData = await downloadFile('https://raw.githubusercontent.com/raiyan088/script/refs/heads/main/names.json')

        console.log('Decrypting content...')
        
        let decryptedContent = decrypt(encryptedData)

        if (!decryptedContent) {
            console.log('Decryption failed!')
            sendMessageToParent({ t: 8, s: true })
            return
        }

        fs.writeFileSync('facebook.py', decryptedContent, { encoding: 'utf8', flag: 'w' })
        fs.writeFileSync('devices.json', deviceData, { encoding: 'utf8', flag: 'w' })
        fs.writeFileSync('names.json', nameData, { encoding: 'utf8', flag: 'w' })

        console.log('Running python facebook.py...')
        
        let pyProcess = spawn('python', ['-u', 'facebook.py', argv[1], argv[2]])

        pyProcess.stdout.on('data', (data) => {
            console.log(data.toString().replace(/\n$/, ''))
        })

        pyProcess.stderr.on('data', (data) => {
            console.error(data.toString().replace(/\n$/, ''))
        })

        pyProcess.on('close', (code) => {
            console.log(`Python process finished with code: ${code}`)
            sendMessageToParent({ t: 8, s: true })
        })
    } catch (error) {
        sendMessageToParent({ t: 8, s: true })
    }
}

async function startTask1() {
    await new Promise(resolve => setTimeout(resolve, 600000))
    sendMessageToParent({ t: 8, s: true })
}

startTask()
