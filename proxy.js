const { execFile } = require('child_process')
const { HttpsProxyAgent } = require('https-proxy-agent');
const { promisify } = require('util')
const fs = require('fs')
const axios = require('axios')
const path = require('path')
const http = require('http')
const tls = require('tls')

class Proxy {
    static CONFIG = {
        workDir: '.vpn-work',
        imageName: 'vpn-proxy',
        containerPrefix: 'openvpn-',
        connectTimeoutSec: 120,
        testTimeoutMs: 20000,
        testHost: 'api.ipify.org',
    }

    constructor() {
        fs.mkdirSync(path.resolve(Proxy.CONFIG.workDir), { recursive: true })
    }

    static sleep(ms) {
        return new Promise((r) => setTimeout(r, ms))
    }

    static async execFileP(cmd, args, opts = {}) {
        let fn = promisify(execFile)
        let { stdout } = await fn(cmd, args, { maxBuffer: 20 * 1024 * 1024, ...opts })
        return stdout
    }

    static async docker(args, opts = {}) {
        return await Proxy.execFileP('docker', args, opts)
    }

    static getIpViaProxy(port, timeoutMs) {
        return new Promise((resolve, reject) => {
            let host = Proxy.CONFIG.testHost
            let req = http.request({
                host: '127.0.0.1',
                port,
                method: 'CONNECT',
                path: `${host}:443`,
                timeout: timeoutMs,
            })

            req.on('timeout', () => req.destroy(new Error('proxy connect timeout')))
            req.on('error', reject)

            req.on('connect', (res, socket) => {
                if (res.statusCode !== 200) {
                    socket.destroy()
                    return reject(new Error(`CONNECT failed: HTTP ${res.statusCode}`))
                }
                let secure = tls.connect({ socket, servername: host }, () => {
                    secure.write(`GET / HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
                })
                let data = ''
                secure.setTimeout(timeoutMs, () => secure.destroy(new Error('TLS/response timeout')))
                secure.on('data', (c) => (data += c))
                secure.on('error', reject)
                secure.on('end', () => {
                    let cleanData = data.trim()
                    
                    let ipMatch = cleanData.match(/(?:\r\n\r\n|\n\n|^)([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+)/)
                    let ip = ipMatch ? ipMatch[1].trim() : cleanData.replace(/[^0-9a-fA-F.:]/g, '').trim()

                    if (ip && (ip.includes('.') || ip.includes(':'))) {
                        resolve(ip)
                    } else {
                        reject(new Error('unexpected response: ' + cleanData.slice(0, 80)))
                    }
                })
            })

            req.end()
        })
    }

    async buildImage() {
        if (process.platform !== 'linux') {
            return
        }
        let dir = path.resolve(Proxy.CONFIG.workDir)
        fs.writeFileSync(
            path.join(dir, 'Dockerfile'),
            'FROM alpine:latest\nRUN apk add --no-cache openvpn curl iproute2 tinyproxy\n'
        )
        fs.writeFileSync(
            path.join(dir, 'tinyproxy.conf'),
            ['Port 8888', 'Listen 0.0.0.0', 'Timeout 600', 'Allow 0.0.0.0/0', 'DisableViaHeader Yes', 'LogLevel Info', 'MaxClients 50', ''].join('\n')
        )
        await Proxy.docker(['build', '-q', '-t', Proxy.CONFIG.imageName, dir])
    }

    async connect(ovpnContentString, port, index = 1) {
        let name = `${Proxy.CONFIG.containerPrefix}${index}`
        let startTime = Date.now()
        let result = {
            name,
            port,
            status: false,
            ip: null,
            connectionTimeSec: 0,
            error: null,
        }

        if (process.platform !== 'linux') {
            return result
        }

        let tempOvpnPath = path.resolve(Proxy.CONFIG.workDir, `client-${index}.ovpn`)

        try {
            await Proxy.docker(['stop', name]).catch(() => {})
            await Proxy.docker(['rm', '-f', name]).catch(() => {})

            fs.writeFileSync(tempOvpnPath, ovpnContentString)

            await Proxy.docker([
                'run', '-d',
                '--name', name,
                '--privileged',
                '--cap-add=NET_ADMIN',
                '--device', '/dev/net/tun',
                '--dns', '8.8.8.8', '--dns', '1.1.1.1',
                '-p', `127.0.0.1:${port}:8888`,
                '-v', `${tempOvpnPath}:/etc/openvpn/client.ovpn:ro`,
                '-v', `${path.resolve(Proxy.CONFIG.workDir, 'tinyproxy.conf')}:/etc/tinyproxy/custom.conf:ro`,
                Proxy.CONFIG.imageName,
                'openvpn', '--config', '/etc/openvpn/client.ovpn',
            ])

            let deadline = Date.now() + Proxy.CONFIG.connectTimeoutSec * 1000
            let connected = false
            
            while (Date.now() < deadline) {
                let rawLogs = await Proxy.execFileP('docker', ['logs', name]).catch(() => '')
                
                if (rawLogs.includes('Initialization Sequence Completed')) {
                    connected = true
                    break
                }
                
                let running = (await Proxy.docker(['inspect', '-f', '{{.State.Running}}', name])).trim()
                if (running !== 'true') throw new Error('Container exited early')
                await Proxy.sleep(2000)
            }

            if (!connected) throw new Error('VPN connection timeout')

            await Proxy.docker(['exec', name, 'sh', '-c', 'printf "nameserver 1.1.1.1\\nnameserver 8.8.8.8\\n" > /etc/resolv.conf'])
            await Proxy.docker(['exec', '-d', name, 'tinyproxy', '-d', '-c', '/etc/tinyproxy/custom.conf'])
            await Proxy.sleep(2000)

            let proxyIp = await Proxy.getIpViaProxy(port, Proxy.CONFIG.testTimeoutMs)

            result.status = true
            result.ip = proxyIp
            result.connectionTimeSec = Number(((Date.now() - startTime) / 1000).toFixed(2))
        } catch (error) {
            result.error = error.message
            result.connectionTimeSec = Number(((Date.now() - startTime) / 1000).toFixed(2))
        }

        return result
    }

    async cleanup(name) {
        await Proxy.docker(['stop', name]).catch(() => {})
        await Proxy.docker(['rm', '-f', name]).catch(() => {})
    }
}

async function checkProxyWithAxios(proxyUrl) {
    try {
        const agent = new HttpsProxyAgent(proxyUrl)

        const response = await axios.get('https://api.ipify.org?format=json', {
            httpAgent: agent,
            httpsAgent: agent,
            timeout: 10000
        });
        
        console.log('IP:', response.data.ip);
        return true;
    } catch (error) {
        console.log('Error:', error.message);
        return false;
    }
}

(async () => {
    let proxyManager = new Proxy()
    await proxyManager.buildImage()

    const ovpnString = `client
proto udp
explicit-exit-notify
remote 167.160.94.156 1194
dev tun
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name server_0bV32ja5FZtqZxmn name
auth SHA256
auth-nocache
cipher AES-128-GCM
tls-client
tls-version-min 1.2
tls-cipher TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256
verb 3
<ca>
-----BEGIN CERTIFICATE-----
MIIB1zCCAX2gAwIBAgIUPwOXKAQZmzfGRxqFWtcfjJLHB9wwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTY25fWnhsTlhQRHpjbDVLeFZrWDAeFw0yNTEyMDYxMzE4MDNa
Fw0zNTEyMDQxMzE4MDNaMB4xHDAaBgNVBAMME2NuX1p4bE5YUER6Y2w1S3hWa1gw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASXHdmne81mq1Ky9RI5xlajwQW4qo5z
2+KWZKVpuyDcXZ4nf4wRVbEoOnFG9xsGZG0smw8ADHhzyn9lh0xju4qTo4GYMIGV
MB0GA1UdDgQWBBTGk64MjRWk1Vw0ohB07K8DBi++2zBZBgNVHSMEUjBQgBTGk64M
jRWk1Vw0ohB07K8DBi++26EipCAwHjEcMBoGA1UEAwwTY25fWnhsTlhQRHpjbDVL
eFZrWIIUPwOXKAQZmzfGRxqFWtcfjJLHB9wwDAYDVR0TBAUwAwEB/zALBgNVHQ8E
BAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIhAIMIyvDzhcGgYuFRSKKivLvSS1T9jJyP
36BoPZ+w3aeMAiAoxoDJNK5U9dL5tEg5Vhz3uTEb/wm+oFr28EYQ+ru7Wg==
-----END CERTIFICATE-----
</ca>
<cert>
Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number:
            56:f8:b9:7c:ea:47:66:62:32:a5:61:ab:15:22:30:ec
        Signature Algorithm: ecdsa-with-SHA256
        Issuer: CN=cn_ZxlNXPDzcl5KxVkX
        Validity
            Not Before: Dec  6 13:19:57 2025 GMT
            Not After : Dec  4 13:19:57 2035 GMT
        Subject: CN=dedicated_montreal2
        Subject Public Key Info:
            Public Key Algorithm: id-ecPublicKey
                Public-Key: (256 bit)
                pub:
                    04:11:2c:6e:ec:ac:c6:b6:c7:dd:7f:9e:8f:49:c9:
                    c8:7e:bf:0a:f0:20:88:ee:f6:43:51:74:e2:05:fb:
                    f3:3a:e6:34:21:f6:de:a0:b2:2f:b9:70:8c:ed:19:
                    77:a8:e8:5d:25:8f:76:24:93:17:dc:c2:53:e6:2e:
                    5b:64:6e:ea:7f
                ASN1 OID: prime256v1
                NIST CURVE: P-256
        X509v3 extensions:
            X509v3 Basic Constraints:
                CA:FALSE
            X509v3 Subject Key Identifier:
                F6:E3:BD:60:14:9F:18:D0:40:40:37:7D:4E:4B:78:35:47:38:85:F4
            X509v3 Authority Key Identifier:
                keyid:C6:93:AE:0C:8D:15:A4:D5:5C:34:A2:10:74:EC:AF:03:06:2F:BE:DB
                DirName:/CN=cn_ZxlNXPDzcl5KxVkX
                serial:3F:03:97:28:04:19:9B:37:C6:47:1A:85:5A:D7:1F:8C:92:C7:07:DC

            X509v3 Extended Key Usage:
                TLS Web Client Authentication
            X509v3 Key Usage:
                Digital Signature
    Signature Algorithm: ecdsa-with-SHA256
         30:46:02:21:00:bb:54:51:11:14:bb:15:c7:6a:53:99:c4:38:
         24:79:7e:18:0f:d9:1e:31:13:59:8a:69:9d:04:d7:75:da:df:
         5b:02:21:00:81:e9:0c:c0:3c:f4:35:66:57:f4:69:23:13:86:
         28:af:9c:9c:91:89:c9:b6:f3:c5:67:4e:e4:ea:8d:04:8f:ea
-----BEGIN CERTIFICATE-----
MIIB5jCCAYugAwIBAgIQVvi5fOpHZmIypWGrFSIw7DAKBggqhkjOPQQDAjAeMRww
GgYDVQQDDBNjbl9aeGxOWFBEemNsNUt4VmtYMB4XDTI1MTIwNjEzMTk1N1oXDTM1
MTIwNDEzMTk1N1owHjEcMBoGA1UEAwwTZGVkaWNhdGVkX21vbnRyZWFsMjBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABBEsbuysxrbH3X+ej0nJyH6/CvAgiO72Q1F0
4gX78zrmNCH23qCyL7lwjO0Zd6joXSWPdiSTF9zCU+YuW2Ru6n+jgaowgacwCQYD
VR0TBAIwADAdBgNVHQ4EFgQU9uO9YBSfGNBAQDd9Tkt4NUc4hfQwWQYDVR0jBFIw
UIAUxpOuDI0VpNVcNKIQdOyvAwYvvtuhIqQgMB4xHDAaBgNVBAMME2NuX1p4bE5Y
UER6Y2w1S3hWa1iCFD8DlygEGZs3xkcahVrXH4ySxwfcMBMGA1UdJQQMMAoGCCsG
AQUFBwMCMAsGA1UdDwQEAwIHgDAKBggqhkjOPQQDAgNJADBGAiEAu1RRERS7Fcdq
U5nEOCR5fhgP2R4xE1mKaZ0E13Xa31sCIQCB6QzAPPQ1Zlf0aSMThiivnJyRicm2
88VnTuTqjQSP6g==
-----END CERTIFICATE-----
</cert>
<key>
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgx0Jm4wMMMNoVd+eu
32piaQ5EONMNDKONLP3Mc1ApwJihRANCAAQRLG7srMa2x91/no9Jych+vwrwIIju
9kNRdOIF+/M65jQh9t6gsi+5cIztGXeo6F0lj3YkkxfcwlPmLltkbup/
-----END PRIVATE KEY-----
</key>
<tls-crypt>
#
# 2048 bit OpenVPN static key
#
-----BEGIN OpenVPN Static key V1-----
6b58aa16fcf8126054f593a0dbf1e911
d32a11156925eb797cd082b45478b87e
079f1f80b5ba12e4dbd04f189456cebc
7a75a9a7614f0c4d9be04b12511a8b08
af65fdbb0d91499ef4dcc01605580d46
a005513c6bb0766038c365a5fb024300
5a70681dca814f5e249b60660930599f
3db0c2cae9c8438626b7932b89246f96
eed14473d17db089b459b7c76dbe9af7
6c0f7144230ee06be3a49f2214fd4b93
3fe5fe22bc022a8e09e6899d9dca5325
824588b3cdc327314fc44a57828a36f5
310c80d880c1f79cadec3211c14e8865
7e683675a94e415607276a3f2537aba1
0695b6d8a824ff2be4cadd205f47bc3d
b65c07b9f1511a3962b9c9316401d598
-----END OpenVPN Static key V1-----
</tls-crypt>`.trim()

    const res = await proxyManager.connect(ovpnString, 8888, 1)
    console.log(res)
    
    await checkProxyWithAxios('http://127.0.0.1:8888');

})()
