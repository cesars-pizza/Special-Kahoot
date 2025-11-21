const http = require('http')
const fs = require('fs')
const ws = require('ws')

/**
 * @type {{spotify:{clientID:string,clientSecret:string,scope:string,redirectURI:string,state:string}}}
 */
var config = {}
var users = {}
var headUser = undefined

var connectPage = ""
var connectErrPage = ""
var authRedirectPage = ""
var profilePage = ""

var playlistCover = ""

var activeGames = [
    {pin: "", owner: "", song: ""}
]

const server = http.createServer(async (request, response) => {
    var url = decodeURIComponent(request.url)
    url = {
        path: url.split("?")[0],
        uri: url.split("?")[1]
    }
    if (url.uri != undefined) {
        var values = url.uri.split("&").map(value => [value.split("=")[0], value.split("=")[1]])
        url.uri = {}
        for (var i = 0; i < values.length; i++) {
            url.uri[values[i][0]] = values[i][1]
        }
    } else url.uri = {}
    
    if (url.path == "/auth") {
        var accessTokenReq = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            body: new URLSearchParams(`grant_type=authorization_code&code=${url.uri.code}&redirect_uri=${config.spotify.redirectURI}`),
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "authorization": "Basic " + (new Buffer.from(config.spotify.clientID + ":" + config.spotify.clientSecret).toString('base64'))
            }
        })
        var accessToken = await accessTokenReq.json()

        if (accessTokenReq.status == 200) {
            var profileReq = await fetch("https://api.spotify.com/v1/me", {
                method: "GET",
                headers: {
                    "authorization": "Authorization: Bearer " + accessToken.access_token
                }
            })
            var profile = await profileReq.json()

            var selectedUser = users[profile.id]
            if (selectedUser == undefined) selectedUser = await GenerateUser(profile, accessToken)
            else {
                selectedUser.access_token = accessToken.access_token
                selectedUser.refresh_token = accessToken.refresh_token
            }

            response.writeHead(200, {"content-type": "text/html"})
            response.end(authRedirectPage.replace("#{id}", profile.id))
        } else {
            response.writeHead(200, {"content-type": "text/html"})
            response.end(connectErrPage)
        }
    } else if (url.path == "/profile") {
        response.writeHead(200, {"content-type": "text/html"})
        response.end(profilePage)
    } else if (url.path == "/userdat") {
        response.writeHead(200, {"content-type": "application/json"})
        response.end(JSON.stringify(users[url.uri.id]))
    } else {
        response.writeHead(200, {"content-type": "text/html"})
        response.end(connectPage)
    }
})

setInterval(async () => {
    fs.writeFileSync('./users.json', JSON.stringify(users))
    console.log("Saved")

    var userKeys = Object.keys(users)
    for (var i = 0; i < userKeys.length; i++) {
        //console.log(await GetPlayingSong(users[userKeys[i]]))
        //await SetPlaylistTracks(users[userKeys[i]], [sampleTracks[sampleIndex]])
        //sampleIndex = (sampleIndex + 1) % 5
    }
}, 10000);

Main()
async function Main() {
    if (fs.existsSync('./dev-config.json'))
        config = await JSON.parse(fs.readFileSync('./dev-config.json'))
    else
        config = await JSON.parse(fs.readFileSync('./config.json'))

    if (!fs.existsSync('./users.json'))
        fs.writeFileSync('./users.json', "{}")
    users = await JSON.parse(fs.readFileSync('./users.json'))
    var userKeys = Object.keys(users)
    for (var i = 0; i < userKeys.length; i++) {
        if (users[userKeys[i]].head) headUser = users[userKeys[i]]
    }

    connectPage = fs.readFileSync('./pages/connect.html').toString('utf8')
    connectPage = connectPage.replace("#{client_id}", config.spotify.clientID)
    connectPage = connectPage.replace("#{scope}", config.spotify.scope)
    connectPage = connectPage.replace("#{redirect_uri}", config.spotify.redirectURI)
    connectPage = connectPage.replace("#{state}", config.spotify.state)

    connectErrPage = fs.readFileSync('./pages/connectErr.html').toString('utf8')
    connectErrPage = connectErrPage.replace("#{client_id}", config.spotify.clientID)
    connectErrPage = connectErrPage.replace("#{scope}", config.spotify.scope)
    connectErrPage = connectErrPage.replace("#{redirect_uri}", config.spotify.redirectURI)
    connectErrPage = connectErrPage.replace("#{state}", config.spotify.state)

    authRedirectPage = fs.readFileSync('./pages/authRedirect.html').toString('utf8')

    profilePage = fs.readFileSync('./pages/profile.html').toString('utf8')

    playlistCover = fs.readFileSync('./playlistCover.jpg').toString('base64')

    server.listen(8080)

    var connectionData = await KahootLogin("9888341")
    setTimeout((connectionData) => {
        SetKahootName(connectionData.connection, connectionData.meta, "B")
    }, 5000, connectionData)
}

async function GenerateUser(user, accessToken) {
    var userEntry = {
        id: user.id,
        name: user.display_name,
        picture: user.images[0].url,
        access_token: accessToken.access_token,
        refresh_token: accessToken.refresh_token,
        head: headUser == undefined,
        presentationID: "",
        presentationURL: ""
    }

    if (headUser == undefined) headUser = userEntry

    var createdPlaylist = await SendSpotifyRequest(`https://api.spotify.com/v1/users/${headUser.id}/playlists`, {
        method: "POST",
        body: JSON.stringify({name: `Kahoot Player (${user.display_name})`, description: user.id, public: false}),
        headers: {
            "Authorization": "Bearer " + headUser.access_token,
            "Content-Type": "application/json"
        }
    }, headUser)

    userEntry.playlistID = createdPlaylist.id
    userEntry.playlistURL = createdPlaylist.external_urls.spotify

    //console.log(playlistCover)
    await SendSpotifyRequest(`https://api.spotify.com/v1/playlists/${userEntry.playlistID}/images`, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${headUser.access_token}`,
            "Content-Type": "image/jpeg"
        },
        body: playlistCover
    }, headUser)

    users[user.id] = userEntry

    return userEntry
}

async function SendSpotifyRequest(url, params, user) {
    var request = await fetch(url, params)
    console.log(`${url} -> ${request.status}`)
    if (request.ok) {
        var response = await request.text()
        if (response.length > 0)
            response = JSON.parse(response)
        else response = {}
        response.responseStatus = request.status
        return response
    } else if (request.status == 401) {
        console.log(await request.text())
        var refreshReq = await fetch(`https://accounts.spotify.com/api/token?grant_type=refresh_token&refresh_token=${user.refresh_token}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${Buffer.from(`${config.spotify.clientID}:${config.spotify.clientSecret}`).toString('base64')}`
            }
        })
        var refreshedTokens = await refreshReq.json()
        user.access_token = refreshedTokens.access_token
        if (refreshedTokens.refresh_token != undefined) user.refresh_token = refreshedTokens.refresh_token
        
        return await SendSpotifyRequest(url, params, user)
    } else {
        var response = await request.text()
        console.log(`${request.status} - ${response}`)
        return response
    }
}

async function GetPlayingSong(user) {
    var playbackState = await SendSpotifyRequest("https://api.spotify.com/v1/me/player", {
        method: "GET",
        headers: {
            "Authorization": "Bearer " + user.access_token
        }
    }, user)

    if (playbackState.responseStatus == 204) {
        return {
            type: "none",
            repeat: false,
            track: ""
        }
    }

    var playingType = "track"
    if (playbackState.currently_playing_type != "track") playingType = "ad"
    if (playbackState.context == undefined) playbackState.context = {uri: ""}
    if (playbackState.context.uri != "spotify:playlist:" + user.playlistID) playingType = "other"
    if (!playbackState.is_playing) playingType = "none"

    var repeating = playbackState.repeat_state != "off"

    if (playbackState.item == undefined) playbackState.item = {id: ""}
    var track = playbackState.item.id

    return {
        type: playingType,
        repeat: repeating,
        track: track
    }
}

async function SetPlaylistTracks(user, tracks) {
    await SendSpotifyRequest(`https://api.spotify.com/v1/playlists/${user.playlistID}/tracks?uris=${encodeURIComponent(tracks.map(track => `spotify:track:${track}`).join(','))}`, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${headUser.access_token}`,
        }
    }, user)
}

async function KahootLogin(pin) {
    var reserveReq = await fetch(`https://kahoot.it/reserve/session/${pin}/?${new Date().getTime()}`)
    var sessionToken = reserveReq.headers.get("x-kahoot-session-token")
    var reservation = await reserveReq.json()
    
    var decodedSessionToken = DecodeKahootSessionToken(sessionToken, reservation.challenge)

    const KahootConnection = new ws.WebSocket(`https://kahoot.it/cometd/${pin}/${decodedSessionToken}`)
    var connectionMeta = {
        id: 1,
        pin: pin,
        startTime: new Date().getTime(),
        clientID: ""
    }

    KahootConnection.on("open", event => {
        KahootConnection.send(JSON.stringify({
            advice: {
                timeout: 60000,
                interval: 0
            },
            channel: "/meta/handshake",
            ext: {
                ack: true,
                timesync: {tc: new Date().getTime(), l: 0, o: 0}
            },
            id: connectionMeta.id.toString(),
            minimum_version: "1.0",
            supportedConnectionTypes: ["websocket", "long-polling", "callback-polling"],
            version: "1.0"
        }))
        connectionMeta.id++

        console.log("Connected to Kahoot!")
    })

    KahootConnection.on("message", event => {
        var data = JSON.parse(event.toString())[0]

        var channel = data.channel

        if (channel == "/meta/handshake") {
            console.log(`--> ${channel}`)

            connectionMeta.clientID = data.clientId

            KahootConnection.send(JSON.stringify({
                advice: {
                    timeout: 0
                },
                channel: "/meta/connect",
                clientId: connectionMeta.clientID,
                connectionType: "websocket",
                ext: {
                    ack: true,
                    timesync: GetKahootTimesync(connectionMeta.startTime)
                },
                id: connectionMeta.id.toString()
            }))
            connectionMeta.id++
            console.log(`<-- /meta/connect`)
        } else if (channel == "/meta/connect") {
            console.log(`--> ${channel}`)
            console.log(data.ext.ack)

            KahootConnection.send(JSON.stringify({
                channel: "/meta/connect",
                clientId: connectionMeta.clientID,
                connectionType: "websocket",
                ext: {
                    ack: data.ext.ack,
                    timesync: GetKahootTimesync(connectionMeta.startTime)
                },
                id: connectionMeta.id.toString()
            }))
            connectionMeta.id++
            console.log(`<-- /meta/connect`)
        } else if (channel == "/service/controller") {
            console.log(`--> ${channel}`)

            if (data.data != undefined) {
                KahootConnection.send(JSON.stringify({
                    channel: "/service/controller",
                    clientId: connectionMeta.clientID,
                    data: {
                        gameid: connectionMeta.pin,
                        type: "message",
                        host: "kahoot.it",
                        id: 16,
                        content: '{"usingNamerator":false}'
                    },
                    ext: {},
                    id: connectionMeta.id.toString()
                }))
                connectionMeta.id++
                console.log(`<-- /service/controller`)
            }
        } else if (channel == "/service/status") {console.log(`--> ${channel}`)} 
        else if (channel == "/service/player") {
            console.log(`--> ${channel}`)

            var actionID = data.data.id
            var actionData = JSON.parse(data.data.content)

            if (actionID == 14) { // Connected

            } else if (actionID == 17) { // Connection Ext.
                
            } else if (actionID == 9) { // Quiz Started
                console.log("Started Quiz")
            } else if (actionID == 1) { // Question Loading
                console.log(`Question #${actionData.questionIndex} (${actionData.gameBlockType}): ${actionData.title}`)
            } else if (actionID == 2) { // Question Start
                for (var i = 0; i < actionData.choices.length; i++) {
                    console.log(`${i}: ${actionData.choices[i].answer}`)
                }
            }
        } else {
            console.log(`--? ${channel}`)
            console.log(data)
        }
    })

    return {
        connection: KahootConnection,
        meta: connectionMeta
    }
}

function GetKahootTimesync(startTime) {
    var currentTime = new Date().getTime()

    return {
        tc: currentTime,
        l: currentTime - startTime,
        o: currentTime - startTime
    }
}

function DecodeKahootChallenge(challenge) {
    var de = /'(\d*[a-z]*[A-Z]*)\w+'/
    var pe = challenge.search("=")
    var me = challenge.slice(pe + 1)
    var st = me.search(";")
    var Et = me.slice(0, Math.max(0, st)).trim()
    var _t = de.exec(challenge)

    return {
        message: (_t && _t.length > 0 ? _t[0] : "").slice(1, -1),
        offsetEquation: Et
    }
}

function DecodeKahootSessionToken(sessionToken, challenge) {
    var decodedChallenge = DecodeKahootChallenge(challenge)

    const decode = message => message.replaceAll(/./g, (char, position) => String.fromCharCode((char.charCodeAt(0) * position + eval(decodedChallenge.offsetEquation)) % 77 + 48));
    var answeredChallenge = decode(decodedChallenge.message)
    var decodedSessionToken = Buffer.from(sessionToken, "base64").toString('utf8')
    
    var finalSessionToken = ""
    for (var i = 0; i < decodedSessionToken.length; i++) {
        var sessionTokenValue = decodedSessionToken.charCodeAt(i)
        var challengeValue = answeredChallenge.charCodeAt(i % answeredChallenge.length)
        var xorValue = sessionTokenValue ^ challengeValue
        finalSessionToken += String.fromCharCode(xorValue)
    }

    return finalSessionToken
}

function SetKahootName(connection, connectionMeta, name) {
    connection.send(JSON.stringify({
        channel: "/service/controller",
        clientId: connectionMeta.clientID,
        data: {
            content: "{}",
            gameid: connectionMeta.pin,
            host: "kahoot.it",
            name: name,
            type: "login"
        },
        ext: {},
        id: connectionMeta.id.toString()
    }))
    connectionMeta.id++
    console.log(`<-- /service/controller`)
}

function AnswerKahootQuizQuestion(connection, connectionMeta, answerIndex) {

}