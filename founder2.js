const bodyParser = require('body-parser')
const express = require('express')
const WebSocket = require('ws')
const axios = require('axios')
const fs = require('fs')

const app = express()
app.use(bodyParser.json())

app.listen(8086, () => console.log('Founder Server Running...'))

let mStart = new Date().toString()

let LOAD_WORKER = 10
let FIXED_PER_USER = 10
let SHARE_PER_USER = 0
let LOAD_PER_SERVER = 50

let servers = new Map()
let users = new Map()
let queue = []
let pendings = []
let mUserName = {}
let userLocks = new Map()
let requestNumber = new Map()
let sendCheck = new Set()

let mConnection = null
let reconnecting = false
let lastSave = 0

let TARGET_BLOCK = 10000000

let BASE_URL = decode('aHR0cHM6Ly9kYXRhYmFzZTA4OC1kZWZhdWx0LXJ0ZGIuZmlyZWJhc2Vpby5jb20vUlJNVFNLQlJNUy8=')
let SERVER_URL = decode('aHR0cHM6Ly9zZXJ2ZXItOTA5OS1kZWZhdWx0LXJ0ZGIuZmlyZWJhc2Vpby5jb20vUlJNVFNLQlJNUy8=')


setInterval(async () => {
    await serverDataInit()
}, 3600000)

startServer()

async function startServer() {

    await loadOldData()
    
    await serverDataInit()

    mUserName = await readUserName()
    
    await runWebSocket('wss://database.raiyanbd.com')

    await runPrevServer()

    while (true) {
        for (let i = 0; i < 10; i++) {
            try {
                if (queue.length > 0) {
                    let req = queue.shift()
                    let user = String(req.user)
                    let addNew = true
                    if (users.has(user)) {
                        try {
                            let u = users.get(user)

                            if (u.status !== 1) {
                                let total = u.permanent.size + u.temporary.size
                                if (total <= 0) {
                                    users.delete(user)
                                    addNew = true
                                }
                            }
                        } catch (error) {}
                    } else {
                        addNew = true
                    }

                    if (addNew) {
                        await saveRequestNumber(req)
                        let assigned = await allocateForNewUser(req)
                        if(assigned.length == 0) pendings.push(user)
                        
                        for (let wid of assigned) {
                            await assignNextRangeToWorkerForUser(wid, user, false)
                            await sleep(100)
                        }
                    }
                }
            } catch (err) {}

            await sleep(1000)
        }

        clearPending(pendings)
        await clearCompletedUser()
        await saveData()

        try {
            let runningUsers = getRunningUsers()

            if (runningUsers.length > 0) {

                await clearDeadServer()

                let freeServer = getFreeServers()
        
                if (freeServer.length > 0) {
                    let assignable = Math.min(freeServer.length, runningUsers.length)

                    for (let i = 0; i < assignable; i++) {
                        await assignNextRangeToWorkerForUser(freeServer[i].id, runningUsers[i].id, true)
                        await sleep(100)
                    }   
                }
            }
        } catch (error) {}
    }
}

function assignNextRangeToWorkerForUser(serverId, user, extra) {
    return withUserLock(user, async () => {
        let ent = users.get(String(user))
        let s = servers.get(serverId)

        if (!ent || !s) {
            if (s) {
                s.running = false
                s.user = null
            }

            if (ent) {
                ent.permanent.delete(serverId)
                ent.temporary.delete(serverId)
            }
            return await saveData()
        }

        let number = ent.number
        let lastLoad = number + LOAD_PER_SERVER

        if (number > ent.max || number > lastLoad) {
            ent.c_time = Date.now()
            ent.status = 2
            s.running = false
            s.temp = true
            s.user = null

            ent.permanent.delete(serverId)
            ent.temporary.delete(serverId)

            await completedRequestNumber(ent)
            return await saveData()
        }

        if (ent.status !== 1) {
            s.running = false
            s.temp = true
            s.user = null

            ent.permanent.delete(serverId)
            ent.temporary.delete(serverId)
            
            return await saveData()
        }

        if (extra) {
            s.temp = true
            ent.temporary.add(serverId)
        }

        s.user = user
        s.running = true
        s.active = Date.now()
        ent.number = lastLoad

        let payload = { t: 4, s: serverId, d: { t:1, n:number, u:user, k:ent.key, s:LOAD_PER_SERVER, b:LOAD_WORKER } }

        if (!sendToWS(payload, serverId)) {
            ent.number = number
            s.running = false
        }

        return await saveData()
    })
}

function clearPending(pendings) {
    let seen = new Set()

    for (let i = pendings.length - 1; i >= 0; i--) {
        let uid = pendings[i]

        if (seen.has(uid)) {
            pendings.splice(i, 1)
            continue
        }
        seen.add(uid)

        if (!users.has(uid)) {
            pendings.splice(i, 1)
            continue
        }

        let u = users.get(uid)

        if (u.permanent && u.permanent.size > 0) {
            pendings.splice(i, 1)
        }
    }
}


async function clearCompletedUser() {
    for (let [userId, u] of users.entries()) {
        try {
            if (u.status != 1) {
                if (u.c_time+300000 < Date.now()) {
                    let removeData = false
                    if (u.permanent.size > 0) {
                        for (let name of u.permanent) {
                            try {
                                let server = servers.get(name)
                                if (server && server.user == userId) {
                                    server.user = null
                                    server.running = false
                                    server.temp = true
                                }
                            } catch (error) {}
                        }
                        removeData= true
                        u.permanent = new Set()
                    }

                    if(u.temporary.size > 0) {
                        for (let name of u.temporary) {
                            try {
                                let server = servers.get(name)
                                if (server && server.user == userId) {
                                    server.user = null
                                    server.running = false
                                    server.temp = true
                                }
                            } catch (error) {}
                        }
                        removeData = true
                        u.temporary = new Set()
                    }

                    if (removeData) {
                        try {
                            await axios.patch(BASE_URL+'number/'+userId+'/'+u.key+'.json', JSON.stringify({ s: u.start, e: u.number, f:u.found }), {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded'
                                }
                            })
                        } catch (error) {}
                    }
                }
            }
        } catch (error) {}
    }
}


async function clearDeadServer() {
    let deadList = getDeadServer()

    for (let i = 0; i< deadList.length; i++) {
        try {
            let id = deadList[i].id
            let server = servers.get(id)

            if (server) {
                let name = server.user
            
                if (name && users.get(name).status == 1) {
                    sendToWS({ t: 4, s: id, d: { t:2, u:name } }, id)
                    server.active = Date.now()
                } else {
                    server.running = false
                    server.temp = true
                    server.user = null
                }
            }
        } catch (error) {}
    }
}

async function handleWorkerMessage(user, serverId, found, captcha, recap, other) {
    await withUserLock(user, async () => {
        try {
            if (!servers.has(serverId) || !users.has(user)) {
                return
            }
            let s = servers.get(serverId)
            let e = users.get(user)
            e.found += found
            e.captcha += captcha
            e.recap += recap
            e.other += other
            
            if (!s.temp && e.status === 1) {
                let number = e.number
                let lastLoad = number + LOAD_PER_SERVER

                if (number > e.max || number > lastLoad) {
                    e.c_time = Date.now()
                    e.status = 2

                    await completedRequestNumber(e)
                    
                    e.permanent.delete(serverId)
                    e.temporary.delete(serverId)
                } else {
                    s.active = Date.now()
                    e.number = lastLoad

                    let payload = { t: 4, s: serverId, d: { t:1, n:number, u:user, k:e.key, s:LOAD_PER_SERVER, b:LOAD_WORKER } }
                    
                    if (!sendToWS(payload, serverId)) {
                        e.number = number
                        s.running = false
                    }
                    return await saveData()
                }
            }

            if (e.status !== 1) {
                s.temp = true
            }

            if (s.temp) {
                let newUser = getUsersWithPendingPermanent()
                
                if (newUser) {
                    e.permanent.delete(serverId)
                    e.temporary.delete(serverId)
                    
                    let number = newUser.number
                    let lastLoad = number + LOAD_PER_SERVER

                    if (number > newUser.max || number > lastLoad) {
                        if(newUser.status == 1) newUser.c_time = Date.now()
                        newUser.status = 2

                        newUser.permanent.delete(serverId)
                        newUser.temporary.delete(serverId)

                        await completedRequestNumber(newUser)
                    } else {
                        newUser.permanent.add(serverId)
                        
                        s.user = newUser.id
                        s.temp = false
                        s.active = Date.now()
                        newUser.number = lastLoad

                        clearPending(pendings)

                        let payload = { t: 4, s: serverId, d: { t:1, n:number, u:newUser.id, k:newUser.key, s:LOAD_PER_SERVER, b:LOAD_WORKER } }
                        
                        if (!sendToWS(payload, serverId)) {
                            newUser.number = number
                            s.running = false
                        }
                        return await saveData()
                    }
                    return await saveData()
                }

                SHARE_PER_USER = sharePerUser(0)

                let sameUser = false

                if (SHARE_PER_USER > 0) {
                    let newUser = getUsersWithPendingTempory()
                
                    if (newUser) {
                        e.permanent.delete(serverId)
                        e.temporary.delete(serverId)
                        
                        let number = newUser.number
                        let lastLoad = number + LOAD_PER_SERVER

                        if (number > newUser.max || number > lastLoad) {
                            if(newUser.status == 1) newUser.c_time = Date.now()
                            newUser.status = 2

                            newUser.permanent.delete(serverId)
                            newUser.temporary.delete(serverId)

                            await completedRequestNumber(newUser)
                        } else {
                            newUser.temporary.add(serverId)

                            s.user = newUser.id
                            s.active = Date.now()
                            newUser.number = lastLoad

                            let payload = { t: 4, s: serverId, d: { t:1, n:number, u:newUser.id, k:newUser.key, s:LOAD_PER_SERVER, b:LOAD_WORKER } }
                            
                            if (!sendToWS(payload, serverId)) {
                                newUser.number = number
                                s.running = false
                            }
                            return await saveData()
                        }
                    } else {
                        sameUser = e.status == 1
                    }
                } else {
                    sameUser = e.status == 1
                }

                if (sameUser) {
                    let number = e.number
                    let lastLoad = number + LOAD_PER_SERVER

                    if (number > e.max || number > lastLoad) {
                        if(e.status == 1) e.c_time = Date.now()
                        e.status = 2

                        e.permanent.delete(serverId)
                        e.temporary.delete(serverId)

                        await completedRequestNumber(e)
                    } else {
                        s.active = Date.now()
                        e.number = lastLoad

                        let payload = { t: 4, s: serverId, d: { t:1, n:number, u:user, k:e.key, s:LOAD_PER_SERVER, b:LOAD_WORKER } }
                        
                        if (!sendToWS(payload, serverId)) {
                            e.number = number
                            s.running = false
                        }
                        return await saveData()
                    }
                }
            }

            s.user = null
            s.running = false
            e.permanent.delete(serverId)
            e.temporary.delete(serverId)

            await saveData()

        } catch (error) {}

        s.user = null
        s.running = false

        return await saveData()
    })
}

function getUsersWithPendingPermanent() {
    for (let user of users.values()) {
        if (user.status === 1) {
            if (Array.from(user.permanent).length < FIXED_PER_USER) {
                return user
            }
        }
    }
    return null
}

function getUsersWithPendingTempory() {
    for (let user of users.values()) {
        if (user.status === 1) {
            if (Array.from(user.temporary).length < SHARE_PER_USER) {
                return user
            }
        }
    }
    return null
}

async function allocateForNewUser(req) {
    let user = String(req.user)
    let freePool = getFreeServers()
    let fixed = []
    let extra = []

    for (let s of freePool) {
        if (fixed.length >= FIXED_PER_USER) break
        s.running = true
        s.user = user
        s.temp = false
        s.active = Date.now()
        fixed.push(s.id)
    }

    let freeLeft = getFreeServers()

    if (freeLeft.length > 0) {
        SHARE_PER_USER = sharePerUser(1)
        
        for (let s of freeLeft) {
            if (extra.length >= SHARE_PER_USER) break
            s.running = true
            s.user = user
            s.temp = true
            s.active = Date.now()
            extra.push(s.id)
        }
    }

    let target = Math.min(req.size, 500000)

    users.set(user, {
        id: user,
        start: req.number,
        number: req.number,
        max: req.number+target,
        permanent: new Set(fixed),
        temporary: new Set(extra),
        delay: req.delay,
        target: target,
        found: 0,
        captcha: 0,
        recap: 0,
        other: 0,
        status: 1,
        s_time: Date.now(),
        c_time: Date.now(),
        key: req.key,
        send: false
    })

    await saveData()

    return fixed.concat(extra)
}

async function saveRequestNumber(req) {
    let user = String(req.user)
    let target = Math.min(req.size, 500000)
    let newRange = { s: req.number, e: req.number + target }

    if (!requestNumber.has(user)) {
        requestNumber.set(user, new Map())
    }

    requestNumber.get(user).set(req.key, newRange)

    try {
        await axios.patch(BASE_URL+'number/'+user+'/'+req.key+'.json', JSON.stringify(newRange), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {}
}

async function completedRequestNumber(req) {
    try {
        let user = String(req.id)
        let newRange = { s: req.start, e: req.max, f:req.found }

        if (!requestNumber.has(user)) {
            let keyMap = new Map()
            keyMap.set(req.key, newRange)
            requestNumber.set(user, keyMap)
        } else {
            requestNumber.get(user).set(req.key, newRange)
        }

        if (req.permanent.size + req.temporary.size == 0 || !req.send) {
            req.send = true
            try {
                await axios.patch(BASE_URL+'number/'+user+'/'+req.key+'.json', JSON.stringify(newRange), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                })
            } catch (error) {}
        }
    } catch (error) {}
    
}

async function cancelRequestNumber(req) {
    let user = String(req.id)
    let newRange = { s: req.start, e: req.number, f:req.found, c:true }

    if (!requestNumber.has(user)) {
        let keyMap = new Map()
        keyMap.set(req.key, newRange)
        requestNumber.set(user, keyMap)
    } else {
        requestNumber.get(user).set(req.key, newRange)
    }

    try {
        await axios.patch(BASE_URL+'number/'+user+'/'+req.key+'.json', JSON.stringify(newRange), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        })
    } catch (error) {}
}

function getFreeServers() {
    let now = Date.now()
    let FIVE_MIN = 5 * 60 * 1000
    return Array.from(servers.values()).filter(s => (!s.running && !s.user) || (s.active && (now - s.active) > FIVE_MIN))
}

function getTemporyServers() {
    return Array.from(servers.values()).filter(s => s.temp )
}

function getRunningUsers() {
    return Array.from(users.values()).filter(s => s.status === 1)
}

function getDeadServer() {
    let now = Date.now()
    let FIVE_MIN = 5 * 60 * 1000
    return Array.from(servers.values()).filter(s => s.active && (now - s.active) > FIVE_MIN)
}

async function runWebSocket(url) {

    let ws = new WebSocket(url, {
        headers: {
            'x-client-id': 'founder-server'
        }
    })

    ws.on('open', () => {
        mConnection = ws
        reconnecting = false
        ws.send(JSON.stringify({ t: 1, s: 'controller_status' }))
    })

    ws.on('message', (data, isBinary) => {
        try {
            if (!isBinary) {
                let json = JSON.parse(data.toString())

                if (json.t == 1) {
                    if (sendCheck.has(json.s)) {
                        handleWorkerMessage(json.u, json.s, json.f, json.c, json.r, json.o)
                    }
                } else if(json.t == 2) {
                    if (!json.r || json.a > 300) {
                        handleWorkerMessage(json.u, json.s, 0, 0, 0, 0)
                    }
                }
            }
        } catch (err) {}
    })

    ws.on('close', () => {
        mConnection = null
        if (!reconnecting) {
            reconnecting = true
            setTimeout(() => runWebSocket(url), 3000)
        }
    })

    ws.on('error', err => {
        mConnection = null
        if (!reconnecting) {
            reconnecting = true
            ws.close()
        }
    })

    for (let i = 0; i < 30; i++) {
        if (mConnection) {
            break
        }
        await sleep(1000)
    }
}

app.get('/', async (req, res) => {
    res.end(''+mStart)
})

app.post('/status', (req, res) => {
    try {
        let { user } = req.body
        let u = users.get(user)

        if (u) {
            res.json({
                status: 200,
                type: u.status,
                number: u.number,
                start: u.start,
                delay: u.delay,
                found: u.found,
                captcha: u.captcha,
                recap: u.recap,
                other: u.other,
                s_time: u.s_time,
                c_time: u.c_time,
                target: u.target,
                pending: pendings.indexOf(user)+1,
                p_server: u.permanent.size,
                t_server: u.temporary.size,
            })
        } else {
            res.json({ status: 400 })
        }
    } catch (err) {
        res.json({ status: 500 })
    }
})

app.get('/log', (req, res) => {
    try {
        let runningUsers = getRunningUsers()
        let tempServers = getTemporyServers()
        let deadSize = 0

        if (runningUsers.length > 0) {
            let deadServer = getDeadServer()
            deadSize = deadServer.length
        }

        res.json({
            status: 200,
            server: servers.size,
            running: runningUsers.length,
            free: tempServers.length,
            pending: pendings.length,
            queue: queue.length,
            dead: deadSize,
            share: SHARE_PER_USER
        })
    } catch (err) {
        res.json({ status: 500 })
    }
})

app.get('/log/user', (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify(userStatus(), null, 2))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

app.get('/log/server', (req, res) => {
    try {
        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify(serverStatus(), null, 2))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

app.get('/log/all', (req, res) => {
    try {
        let runningUsers = getRunningUsers()

        let tempServers = getTemporyServers()

        let deadServer = getDeadServer()        

        res.setHeader('Content-Type', 'application/json')
        res.send(JSON.stringify({
            server: servers.size,
            running: runningUsers.length,
            free: tempServers.length,
            pending: pendings.length,
            queue: queue.length,
            dead: deadServer.length,
            share: SHARE_PER_USER,
            users: userStatus(),
            servers: serverStatus(),
            runningList: runningUsers,
            freeList: tempServers,
            deadList: deadServer,
        }, null, 2))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

app.post('/found', (req, res) => {
    try {
        let { number, user, key, size, delay, overload } = req.body

        if (!number || !user || !size) {
            return res.json({ status: 400, message: 'Required request data not found'  })
        }

        let u = users.get(String(user))
        if (u && u.status === 1) {
            return res.json({ status: 400, message: 'Number finding is already running'  })
        }

        if (u) {
            let total = u.permanent.size + u.temporary.size
            if (total > 0) {
                return res.json({ status: 400, message: 'Number finding is still in progress'  })
            }
        }

        if (pendings.includes(user)) {
            return res.json({ status: 400, message: 'Number finding is still in pending'  })
        }

        let result = getNumberStatus(user, number+1, size)

        if (result.type == 200) {
            queue.push({ number, user, key, size, delay })
            return res.json({ status: 200, message: 'Number finding successfully added to the queue' })
        } else if (result.type == 300) {
            if (overload) {
                queue.push({ number, user, key, size, delay })
                return res.json({ status: 200, message: 'Number finding successfully added to the queue' })
            } else {
                return res.json({ status: 300, message: result.msg })
            }
        } else {
            return res.json({ status: 400, message: 'This number is currently being used by another user' })
        }
    } catch (err) {
        return res.json({ status: 400, message: 'Server encountered an exception error' })
    }
})

app.post('/cancel', async (req, res) => {
    try {
        let { user } = req.body
        if (!user) return res.json({ status: 500, message: 'Required request data not found' })

        let u = users.get(user)
        if (!u) return res.json({ status: 500, message: 'User data not found'})
        if (u.status !== 1) return res.json({ status: 400, message: 'Number finding is not running' })
        
        u.status = 3
        u.c_time = Date.now()

        queue = queue.filter(t => String(t.user) !== String(user))
        pendings = pendings.filter(p => String(p) !== String(user))

        await cancelRequestNumber(u)

        res.json({ status: 200, message: 'Number finding successfully canceled' })
    } catch (err) {
        res.json({ status: 500, message: 'Server encountered an exception error' })
    }
})

function userStatus() {
    let status = {}
    for (let [userId, u] of users.entries()) {
        status[userId] = {
            name: mUserName[userId] ?? 'Unknown',
            status: u.status === 1 ? 'running' : (u.status === 2 ? 'completed' : 'cancelled'),
            number: u.number,
            max: u.max,
            parsent: (((u.number - u.start) / (u.max - u.start)) * 100).toFixed(2)+'%',
            pending: pendings.indexOf(userId)+1,
            start: u.start,
            delay: u.delay,
            found: u.found,
            captcha: u.captcha,
            recap: u.recap,
            other: u.other,
            s_time: timeAgo(u.s_time)+' ago',
            c_time: timeAgo(Date.now() - (u.c_time - u.s_time)),
            target: u.target,
            permanent: u.permanent.size,
            temporary: u.temporary.size,
        }
    }

    return status
}

function serverStatus() {
    let status = {}

    for (let [sid, s] of servers.entries()) {
        status[sid] = {
            running: s.running,
            user: s.user,
            temp: s.temp,
            lastActive: s.active
        }
    }

    return status
}

function sendToWS(data, serverId) {
    try {
        sendCheck.add(serverId)
        if (!mConnection || mConnection.readyState !== WebSocket.OPEN) return false
        let payload = (typeof data === 'string') ? data : JSON.stringify(data)
        mConnection.send(payload)
        return true
    } catch (err) {
        return false
    }
}

function timeAgo(date) {
    let now = new Date()
    let seconds = Math.floor((now - new Date(date)) / 1000)

    let days = Math.floor(seconds / 86400)
    seconds %= 86400

    let hours = Math.floor(seconds / 3600)
    seconds %= 3600

    let minutes = Math.floor(seconds / 60)

    let result = ''
    if (days > 0) result += days + (days === 1 ? ' day ' : ' days ')
    if (hours > 0) result += hours + (hours === 1 ? ' hour ' : ' hours ')
    if (minutes > 0 || result === '') result += minutes + (minutes === 1 ? ' minute' : ' minutes')

    return result.trim()
}

async function serverDataInit() {
    try {
        let response = await axios.get(BASE_URL+'server/founder.json')
        let data = response.data || {}

        for (let id of servers.keys()) {
            if (!data.hasOwnProperty(id)) {
                servers.delete(id)
            }
        }

        let validServers = new Set(servers.keys())

        for (let user of users.values()) {
            if (user.permanent) {
                for (let sid of Array.from(user.permanent)) {
                    if (!validServers.has(sid)) {
                        user.permanent.delete(sid)
                    }
                }
            }

            if (user.temporary) {
                for (let sid of Array.from(user.temporary)) {
                    if (!validServers.has(sid)) {
                        user.temporary.delete(sid)
                    }
                }
            }
        }

        for (let id of Object.keys(data)) {
            if (!servers.has(id)) {
                servers.set(id, {
                    id,
                    running: false,
                    user: null,
                    temp: true,
                    active: Date.now()
                })
            }
        }
    } catch (e) {}
}

async function readUserName() {
    try {
        let response = await axios.get(SERVER_URL+'change.json')
        return response.data || {}
    } catch (e) {}

    return {}
}

async function runPrevServer() {
    for (let [userId, u] of users.entries()) {
        try {
            if (u.status == 1) {
                let permanent = u.permanent
                let temporary= u.temporary
                if (permanent.size > 0) {
                    for (let name of permanent) {
                        try {
                            let server = servers.get(name)
                            if (server && server.user == userId) {
                                server.active = Date.now()
                                sendToWS({ t: 4, s: name, d: { t:2, u:userId } }, name)
                            }
                        } catch (error) {}
                    }
                }
                if(temporary.size > 0) {
                    for (let name of temporary) {
                        try {
                            let server = servers.get(name)
                            if (server && server.user == userId) {
                                server.active = Date.now()
                                sendToWS({ t: 4, s: name, d: { t:2, u:userId } }, name)
                            }
                        } catch (error) {}
                    }
                }
            } else {
                u.permanent = new Set([])
                u.temporary = new Set([])
            }
        } catch (e) {}
    }
}

async function loadOldData() {
    try {
        let data = JSON.parse(fs.readFileSync('data.json'))
        
        data.users.forEach(([key, value]) => {
            value.permanent = new Set(value.permanent)
            value.temporary = new Set(value.temporary)
            users.set(key, value)
        })

        data.servers.forEach(([key, value]) => {
            servers.set(key, value)
        })

        pendings = data.pendings || []

        let numbers = null

        if (fs.existsSync('numbers.json')) {
            try {
                numbers = JSON.parse(fs.readFileSync('numbers.json'))
            } catch (e) {}
        } else {
            let response = await axios.get('https://database088-default-rtdb.firebaseio.com/RRMTSKBRMS/number.json')
            numbers = response.data
        }

        if (numbers) {
            try {
                for (let user of Object.keys(numbers)) {
                    let userRequests = new Map()

                    for (let reqId of Object.keys(numbers[user])) {
                        userRequests.set(reqId, numbers[user][reqId])
                    }

                    requestNumber.set(user, userRequests)
                }
            } catch (error) {
                requestNumber = new Map()
            }

            fs.writeFileSync('numbers.json', JSON.stringify(
                Object.fromEntries(
                    [...requestNumber].map(([user, userMap]) => [
                        user,
                        Object.fromEntries(userMap)
                    ])
                )))
        } else {
            requestNumber = new Map()
        }
    } catch (error) {}
}


function sharePerUser(add) {
    let runningUsers = getRunningUsers()
    let totalUsers = runningUsers.length + add
    let fixed = totalUsers * FIXED_PER_USER
    let extra = servers.size - fixed
    if (extra > 0) {
        return Math.floor(extra / totalUsers)
    }
    return 0
}

function withUserLock(user, fn) {
    let k = String(user)
    if (!userLocks.has(k)) userLocks.set(k, Promise.resolve())
    let chain = userLocks.get(k)
    let next = chain.then(() => fn()).catch(err => {})
    userLocks.set(k, next)
    return next
}

async function saveData() {
    try {
        let now = Date.now()
        if (lastSave < now) {
            lastSave = now+10000
            fs.writeFileSync('data.json', JSON.stringify({
                users: Array.from(users.entries()).map(([key, value]) => {
                    return [ key, {
                        ...value,
                        permanent: Array.from(value.permanent),
                        temporary: Array.from(value.temporary)
                    }]
                }),
                servers: Array.from(servers.entries()),
                pendings: pendings
            }))
            
            fs.writeFileSync('numbers.json', JSON.stringify(
                Object.fromEntries(
                    [...requestNumber].map(([user, userMap]) => [
                        user,
                        Object.fromEntries(userMap)
                    ])
                )))
        }
    } catch (error) {}

    return null
}

function getNumberStatus(targetUser, targetNumber, size) {
    try {
        let lastData = {}
        let closestNext = null
        let globalInsideData = null 

        for (let [userId, timeMap] of requestNumber.entries()) {
            let letestKey = 0
            let insideData = null
            for (let [timeKey, { s, e, c }] of timeMap.entries()) {
                let time = parseInt(timeKey)
                if (targetNumber >= s && targetNumber <= e) {
                    if (!insideData || e >= insideData.number) {
                        insideData = { userId, time, number: e, cancel:c }
                    }
                }

                if (s >= targetNumber) {
                    if (!closestNext || s <= closestNext.number) {
                        closestNext = { userId, timeKey, number: s, cancel:c }
                    }
                }
                
                if (time > letestKey) {
                    letestKey = time
                    lastData[userId] = {
                        k: parseInt(timeKey),
                        s, e, c
                    }
                }
            }

            if (insideData) {
                if (!globalInsideData || insideData.time > globalInsideData.time) {
                    globalInsideData = insideData
                }
            }
        }

        if (globalInsideData) {
            let insideData = globalInsideData
            let letestKey = lastData[insideData.userId]?.k
            let usedBy = mUserName[insideData.userId] ?? 'Unknown'

            if (letestKey == insideData.time) {
                if (insideData.cancel) {
                    return { type: 300, msg: `This numbers previously used by **${usedBy}** at time ${timeAgo(insideData.time*1000)+' ago'}` }
                } else {
                    if (targetUser == insideData.userId) {
                        return { type: 300, msg: `This numbers previously used by **${usedBy}** at time ${timeAgo(insideData.time*1000)+' ago'}` }
                    } else {
                        return { type: 400 }
                    }
                }
            } else {
                return { type: 300, msg: `This numbers previously used by **${usedBy}** at time ${timeAgo(insideData.time*1000)+' ago'}` }
            }
        }

        let hasUser = {}

        for (let [key, value] of Object.entries(lastData)) {
            if ((value.s <= targetNumber && targetNumber <= value.s+TARGET_BLOCK) || (value.e <= targetNumber && targetNumber <= value.e+TARGET_BLOCK)) {
                if (!value.c) {
                    hasUser[key] = true
                }
            }
        }
        
        if (Object.keys(hasUser).length > 0) {
            if (!hasUser[targetUser]) {
                return { type: 400 }
            }
        }

        if (closestNext) {
            if (targetNumber+size > closestNext.number) {
                return { type: 300, msg: `There are ${Math.floor((targetNumber + size - closestNext.number) / 1000)}K numbers left in ${Math.floor(size / 1000)}K numbers` }
            }
        }
    } catch (error) {}

    return { type: 200 }
}


function decode(data) {
    return Buffer.from(data, 'base64').toString('utf-8')
}

function sleep(time) {
    return new Promise(function(resolve) {
        setTimeout(resolve, time)
    })
}
