const http = require('http')
const fs = require('fs')
const ws = require('ws')
const googleAuth = require('@google-cloud/local-auth')
const googleAPI = require('googleapis')
const googleAuthLib = require('google-auth-library')
const nodePath = require('node:path')

/**
 * @type {{spotify:{clientID:string,clientSecret:string,scope:string,redirectURI:string,state:string,"songMap":{Letters:{A:string,B:string,C:string,D:string,E:string,F:string,G:string,H:string,I:string,J:string,K:string,L:string,M:string,N:string,O:string,P:string,Q:string,R:string,S:string,T:string,U:string,V:string,W:string,X:string,Y:string,Z:string},Space:string,Finish:string,QuizAnswers:{Red:string,Yellow:string,Green:string,Blue:string}}},googleSlides:{APIKey:string,clientID:string,scopes:string[],colors:{white:{red:number,green:number,blue:number},gray:{red:number,green:number,blue:number},black:{red:number,green:number,blue:number},purple0:{red:number,green:number,blue:number},purple1:{red:number,green:number,blue:number},purple2:{red:number,green:number,blue:number},purple3:{red:number,green:number,blue:number},purple4:{red:number,green:number,blue:number},answerRed:{red:number,green:number,blue:number},answerYellow:{red:number,green:number,blue:number},answerGreen:{red:number,green:number,blue:number},answerBlue:{red:number,green:number,blue:number},correctAnswer:{red:number,green:number,blue:number},incorrectAnswer:{red:number,green:number,blue:number},bronzeInner:{red:number,green:number,blue:number},bronzeOuter:{red:number,green:number,blue:number},silverInner:{red:number,green:number,blue:number},silverOuter:{red:number,green:number,blue:number},goldInner:{red:number,green:number,blue:number},goldOuter:{red:number,green:number,blue:number}}}}}
 */
var config = {}
var users = {}
var headUser = undefined

var connectPage = ""
var connectErrPage = ""
var authRedirectPage = ""
var profilePage = ""

var playlistCover = ""

var activeGames = []

var keyboardLetterSongs = []
var quizAnswerSongs = []

/** @type {googleAPI.slides_v1.Slides} */
var slidesAPI = {}

const server = http.createServer(async (request, response) => {
    url = {
        path: request.url.split("?")[0],
        uri: request.url.split("?")[1]
    }
    if (url.uri != undefined) {
        var values = url.uri.split("&").map(value => [decodeURIComponent(value.split("=")[0]), decodeURIComponent(value.split("=")[1])])
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
    } else if (url.path == "/rmgame") {
        activeGames.splice(activeGames.map(game => game.pin).indexOf(url.uri.pin), 1)
        users[url.uri.user].currentGamePins.splice(users[url.uri.user].currentGamePins.indexOf(url.uri.pin), 1)

        response.writeHead(200, {"content-type": "application/json"})
        response.end("")

        var userKeys = Object.keys(users)
        for (var i = 0; i < userKeys.length; i++) {
            if (users[userKeys[i]].state == "idle") SetSpotifyPlaylistTracks(users[userKeys[i]], activeGames.map(game => game.song))
        }
    } else if (url.path == "/addgame") {
        var songID = url.uri.song.substring(url.uri.song.lastIndexOf("/") + 1, url.uri.song.indexOf("?"))
        activeGames.push({pin: url.uri.pin, song: songID, owner: url.uri.user})
        users[url.uri.user].currentGamePins.push(url.uri.pin)

        response.writeHead(200, {"content-type": "application/json"})
        response.end("")

        var userKeys = Object.keys(users)
        for (var i = 0; i < userKeys.length; i++) {
            if (users[userKeys[i]].state == "idle") SetSpotifyPlaylistTracks(users[userKeys[i]], activeGames.map(game => game.song))
        }
    } else if (url.path == "/song_cover") {
        var imgData = fs.readFileSync(`./song_covers/${url.uri.location}.png`)

        response.writeHead(200, {"content-type": "image/png", "Access-Control-Allow-Origin": "*"})
        response.end(imgData)

        var userKeys = Object.keys(users)
        for (var i = 0; i < userKeys.length; i++) {
            if (users[userKeys[i]].state == "idle") SetSpotifyPlaylistTracks(users[userKeys[i]], activeGames.map(game => game.song))
        }
    } else {
        response.writeHead(200, {"content-type": "text/html"})
        response.end(connectPage)
    }
})

setInterval(async () => {
    fs.writeFileSync('./users.json', JSON.stringify(users, (key, value) => {if (key == "kahootConnection" || key == "kahootConnectionMeta") return undefined; else return value}))
    console.log("Saved")

    if (activeGames.length > 0) {
        var userKeys = Object.keys(users)
        for (var i = 0; i < userKeys.length; i++) {
            if (users[userKeys].state == "idle") {
                var currentTrack = await GetPlayingSong(users[userKeys[i]])
                if (currentTrack.type == "track") {
                    var selectedGame = activeGames[activeGames.map(game => game.song).indexOf(currentTrack.track)]

                    var kahoot = await KahootLogin(selectedGame.pin, users[userKeys[i]])
                    users[userKeys[i]].state = "name"
                    users[userKeys[i]].kahootConnection = kahoot.connection
                    users[userKeys[i]].kahootConnectionMeta = kahoot.meta
                    SetSpotifyPlaylistTracks(users[userKeys[i]], keyboardLetterSongs)
                }
            } else if (users[userKeys].state == "name") {
                var currentTrack = await GetPlayingSong(users[userKeys[i]])
                if (currentTrack.type == "none" || currentTrack.type == "other") {
                    QuitKahoot(users[userKeys[i]])
                } else if (currentTrack.type == "track") {
                    var keyboardInput = GetSpotifyKeyboardInput(currentTrack.track)
                    
                    if (users[userKeys[i]].kahootConnectionMeta.nickname == "")
                        SetSpotifyPlaylistTracks(users[userKeys[i]], keyboardLetterSongs.concat([config.spotify.songMap.Space, config.spotify.songMap.Finish]))
                    
                    users[userKeys[i]].kahootConnectionMeta.nickname += keyboardInput.character
                    console.log(`Setting Name: ${users[userKeys[i]].kahootConnectionMeta.nickname}`)
                    if (keyboardInput.finish) {
                        console.log("Joined Lobby")
                        SetKahootName(users[userKeys[i]].kahootConnection, users[userKeys[i]].kahootConnectionMeta, users[userKeys[i]].kahootConnectionMeta.nickname)
                        SetSpotifyPlaylistTracks(users[userKeys[i]], [users[userKeys[i]].backgroundTrack])
                        users[userKeys[i]].state = "lobby"
                    }
                }
            }
        }
    }
}, 8000);

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

        users[userKeys[i]].currentGamePins = []
        users[userKeys[i]].state = "idle"
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

    keyboardLetterSongs = [
        config.spotify.songMap.Letters.A,
        config.spotify.songMap.Letters.B,
        config.spotify.songMap.Letters.C,
        config.spotify.songMap.Letters.D,
        config.spotify.songMap.Letters.E,
        config.spotify.songMap.Letters.F,
        config.spotify.songMap.Letters.G,
        config.spotify.songMap.Letters.H,
        config.spotify.songMap.Letters.I,
        config.spotify.songMap.Letters.J,
        config.spotify.songMap.Letters.K,
        config.spotify.songMap.Letters.L,
        config.spotify.songMap.Letters.M,
        config.spotify.songMap.Letters.N,
        config.spotify.songMap.Letters.O,
        config.spotify.songMap.Letters.P,
        config.spotify.songMap.Letters.Q,
        config.spotify.songMap.Letters.R,
        config.spotify.songMap.Letters.S,
        config.spotify.songMap.Letters.T,
        config.spotify.songMap.Letters.U,
        config.spotify.songMap.Letters.V,
        config.spotify.songMap.Letters.W,
        config.spotify.songMap.Letters.X,
        config.spotify.songMap.Letters.Y,
        config.spotify.songMap.Letters.Z
    ]

    quizAnswerSongs = [
        config.spotify.songMap.QuizAnswers.Red,
        config.spotify.songMap.QuizAnswers.Blue,
        config.spotify.songMap.QuizAnswers.Yellow,
        config.spotify.songMap.QuizAnswers.Green
    ]

    var presentationColorKeys = Object.keys(config.googleSlides.colors)
    for (var i = 0; i < presentationColorKeys.length; i++) {
        config.googleSlides.colors[presentationColorKeys[i]] = ConvertHexToColor(config.googleSlides.colors[presentationColorKeys[i]])
    }

    await AuthenticateGoogle()

    server.listen(8080)

    for (var i = 0; i < userKeys.length; i++) {
        SetSpotifyPlaylistTracks(users[userKeys[i]], [])
    }

    //SetPresentationPage_AvailableGames(headUser.presentationID, [
    //    {pin: "817563", songTitle: "Link Up (Metro Boomin & Don Toliver, Wizkid feat. BEAM & Toian) - Spider-Verse Remix (Spider-Man: Across the Spider-Verse)", songCover: "http://67.185.133.83:8080/song_cover?location=ab67616d00001e026ed9aef791159496b286179f"},
    //    {pin: "452636", songTitle: "Between the Lines", songCover: "http://67.185.133.83:8080/song_cover?location=ab67616d0000e1a345ed27c2e2a8f723f350f96e"},
    //    {pin: "3858417", songTitle: "A Hatful of Dreams", songCover: "http://67.185.133.83:8080/song_cover?location=ab67616d0000e1a3427d87c552dadb429dfeaf34"},
    //    {pin: "105729", songTitle: "Seasons of Love", songCover: "http://67.185.133.83:8080/song_cover?location=ab67616d0000e1a3d272c37389bd3d9c20564166"},
    //    {pin: "5829578", songTitle: "Something to Hold Onto"},
    //    {pin: "572659", songTitle: "Inner Thoughts (Reprise)"},
    //    {pin: "264957", songTitle: "Say it in Other Words"},
    //])

    //SetPresentationPage_EnterNickname(headUser.presentationID, "Hello", "756294", true, "Google Slides API Is Angered\nWatch Out")

    //SetPresentationPage_Connected(headUser.presentationID, "Cesar's Pizza", "542867", true, {title: "Lobby Music Christmas Edition", artist: "Kahoot!", cover: "http://67.185.133.83:8080/song_cover?location=ab67616d00001e02669a41183a8feb2e9e1a0dd6"})

    //SetPresentationPage_GetReady(headUser.presentationID, "Cesar's Pizza", "482860", true, "Lesson 1 Terms & Definitions", false)

    //SetPresentationPage_QuizQuestionPrep(headUser.presentationID, "Cesar's Pizza", "820185", false, 4, 54, 43146, "How many songs are there in Between the Lines?")

    //SetPresentationPage_QuizQuestion(headUser.presentationID, "Cesar's Pizza", "2956295", false, 4, 54, 15, "How many songs are there in Between the Lines?", ["Ten (10)", "Twenty Two (22)"], undefined)

    //SetPresentationPage_PostQuestion(headUser.presentationID, "Cesar's Pizza", "294084", false, 4, 76, 2576, "no response", 1, 950, 2)

    SetPresentationPage_EndOfGame(headUser.presentationID, "Cesar's Pizza", "486729", 12, 12, 10456, 7)

    //SetPresentationPage_Quit(headUser.presentationID)

    console.log("Started")
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
        presentationURL: "",
        currentGamePins: [],
        state: "idle",
        kahootConnection: {},
        kahootConnectionMeta: {},
        backgroundTrack: "7IEdlE4ZwzPDxnoWFv10aj"
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

    var presentation = await slidesAPI.presentations.create({
        requestBody: {
            title: `Kahoot Display - ${user.display_name}`
        }
    })
    userEntry.presentationID = presentation.data.presentationId
    userEntry.presentationURL = `https://docs.google.com/presentation/d/${presentation.data.presentationId}/edit?slide=id.p#slide=id.p`

    users[user.id] = userEntry

    return userEntry
}

async function SendSpotifyRequest(url, params, user) {
    var request = await fetch(url, params)
    var shortenedURL = url
    if (shortenedURL.length > 100) shortenedURL = url.substring(0, 97) + "..."
    console.log(`${shortenedURL} -> ${request.status}`)
    if (request.ok) {
        var response = await request.text()
        if (response.length > 0)
            response = JSON.parse(response)
        else response = {}
        response.responseStatus = request.status
        return response
    } else if (request.status == 401) {
        var refreshReq = await fetch(`https://accounts.spotify.com/api/token?grant_type=refresh_token&refresh_token=${user.refresh_token}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${Buffer.from(`${config.spotify.clientID}:${config.spotify.clientSecret}`).toString('base64')}`
            }
        })
        var refreshData = await refreshReq.text()
        if (!refreshReq.ok) {
            console.log("Failed to refresh access token!")
            return {}
        } else {
            var refreshedTokens = JSON.parse(refreshData)
            user.access_token = refreshedTokens.access_token
            if (refreshedTokens.refresh_token != undefined) user.refresh_token = refreshedTokens.refresh_token
            
            params.headers.Authorization = "Bearer " + user.access_token
            return await SendSpotifyRequest(url, params, user)
        }
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

async function SetSpotifyPlaylistTracks(user, tracks) {
    await SendSpotifyRequest(`https://api.spotify.com/v1/playlists/${user.playlistID}/tracks?uris=${encodeURIComponent(tracks.map(track => `spotify:track:${track}`).join(','))}`, {
        method: "PUT",
        headers: {
            "Authorization": `Bearer ${headUser.access_token}`
        }
    }, headUser)
}

async function KahootLogin(pin, user) {
    var reserveReq = await fetch(`https://kahoot.it/reserve/session/${pin}/?${new Date().getTime()}`)
    var sessionToken = reserveReq.headers.get("x-kahoot-session-token")
    var reservation = await reserveReq.json()
    
    var decodedSessionToken = DecodeKahootSessionToken(sessionToken, reservation.challenge)

    const KahootConnection = new ws.WebSocket(`https://kahoot.it/cometd/${pin}/${decodedSessionToken}`)
    var connectionMeta = {
        id: 1,
        pin: pin,
        startTime: new Date().getTime(),
        clientID: "",
        nickname: "",
        questionIndex: 0
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
            console.log(data)

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
                connectionMeta.questionIndex = actionData.questionIndex
            } else if (actionID == 2) { // Question Start
                for (var i = 0; i < actionData.choices.length; i++) {
                    console.log(`${i}: ${actionData.choices[i].answer}`)
                }
                SetSpotifyPlaylistTracks(user, quizAnswerSongs.slice(0, actionData.choices.length))
                setTimeout((user, index) => {AnswerKahootQuizQuestion(user, index)}, 10000, user, connectionMeta.questionIndex)
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

function GetSpotifyKeyboardInput(track) {
    if (track == config.spotify.songMap.Finish) return {finish: true, character: ""}
    else if (track == config.spotify.songMap.Space) return {finish: false, character: " "}
    else {
        var alphabetKeys = Object.keys(config.spotify.songMap.Letters)
        for (var i = 0; i < alphabetKeys.length; i++) {
            if (track == config.spotify.songMap.Letters[alphabetKeys[i]]) return {finish: false, character: alphabetKeys[i]}
        }
    }

    return {finish: false, character: "?"}
}

async function AnswerKahootQuizQuestion(user, questionIndex) {
    var currentTrack = await GetPlayingSong(user)

    var answerIndex = -1

    if (currentTrack.type == "other" || currentTrack.type == "none") {
        QuitKahoot(user)
        return
    }

    if (currentTrack.type == "track") {
        for (var i = 0; i < quizAnswerSongs.length; i++) {
            if (currentTrack.track == quizAnswerSongs[i]) answerIndex = i
        }
    }

    user.kahootConnection.send(JSON.stringify({
        channel: "/service/controller",
        clientId: user.kahootConnectionMeta.clientID,
        data: {
            content: JSON.stringify({type: "quiz", choice: answerIndex, questionIndex: questionIndex}),
            gameid: user.kahootConnectionMeta.pin,
            host: "kahoot.it",
            id: 45,
            type: "message"
        },
        ext: {},
        id: user.kahootConnectionMeta.id.toString()
    }))
    user.kahootConnectionMeta.id++
    console.log(`<-- /service/controller`)
}

function QuitKahoot(user) {
    console.log("Quit Kahoot")
    user.kahootConnection.close()
    user = "idle"
    SetSpotifyPlaylistTracks(users[userKeys[i]], activeGames.map(game => game.song))
}

async function AuthenticateGoogle() {
    const auth = new googleAuthLib.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/presentations"]
    })

    slidesAPI = googleAPI.google.slides({version: "v1", auth})
}

/**
 * @param {string} id 
 * @param {{pin: string, songTitle: string, songCover: string}[]} games 
 */
async function SetPresentationPage_AvailableGames(id, games) {
    var games = games.map(game => {
        if (game.songTitle.length > 80) return {pin: game.pin, songTitle: game.songTitle.substring(0, 80) + "...", songCover: game.songCover}
        else return game
    })

    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 5.29}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 4.13, y: 0.71}, {x: 2.93, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 4.13, y: 0.71}, {x: 2.93, y: 0.33}, "Available Games", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}})
    )

    if (games.length == 0) {
        requests = requests.concat(CreatePresentationTextbox(
            newSlideID, "3", {x: 9.67, y: 1.32}, {x: 0.17, y: 3.97}, "There are no available games right now\nCheck back later", {size: 20, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}
        ))
    } else {
        for (var i = 0; i < games.length && i < 4; i++) {
            var y = 1.21 + (0.88 * i)

            requests = requests.concat(
                CreatePresentationShape(newSlideID, `4-${i}`, "ROUND_RECTANGLE", {x: 9.33, y: 0.71}, {x: 0.33, y: y}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, `5-${i}`, {x: 6.74, y: 0.71}, {x: 1.05, y: y}, games[i].songTitle, {size: 20, weight: 500, color: config.googleSlides.colors.black, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationTextbox(newSlideID, `6-${i}`, {x: 1.71, y: 0.71}, {x: 7.79, y: y}, games[i].pin, {size: 20, weight: 500, color: config.googleSlides.colors.black, alignment: {x: "END", y: "MIDDLE"}}),
                CreatePresentationImage(newSlideID, `7-${i}`, {x: 0.71, y: 0.71}, {x: 0.33, y: y}, games[i].songCover)
            )
        }

        if (games.length > 4) {
            requests = requests.concat(CreatePresentationTextbox(newSlideID, "8", {x: 9.67, y: 0.56}, {x: 0.17, y: 4.73}, `+ ${games.length - 4} More`, {size: 20, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}))
        }
    }

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {boolean} repeatEnabled 
 * @param {string | undefined} error
 */
async function SetPresentationPage_EnterNickname(id, nickname, pin, repeatEnabled, error) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 4.03, y: 0.71}, {x: 2.99, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 4.03, y: 0.71}, {x: 2.99, y: 0.33}, "Enter Nickname", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0}),
    )

    if (repeatEnabled) requests = requests.concat([CreatePresentationTextbox(newSlideID, "4", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "4", {x: 10, y: 0.38}, {x: 0, y: 5.24}, "Make sure to turn on repeat mode to prevent accidentally quitting!", {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    if (error == undefined) requests = requests.concat([CreatePresentationShape(newSlideID, "5", "ROUND_RECTANGLE", {x: 5.71, y: 1.05}, {x: 2.15, y: 2.29}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0})])
    else {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "5", "ROUND_RECTANGLE", {x: 5.71, y: 2.06}, {x: 2.15, y: 2.29}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
            CreatePresentationTextbox(newSlideID, "6", {x: 5.37, y: 0.84}, {x: 2.31, y: 3.34}, error, {size: 20, weight: 500, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    }

    requests = requests.concat([CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 5.37, y: 0.71}, {x: 2.31, y: 2.46}, config.googleSlides.colors.white, {color: config.googleSlides.colors.gray, thickness: 3})])

    if (nickname == "") requests = requests.concat([CreatePresentationTextbox(newSlideID, "8", {x: 5.37, y: 0.71}, {x: 2.31, y: 2.46}, "Nickname", {size: 20, weight: 600, color: config.googleSlides.colors.gray, alignment: {x: "CENTER", y: "MIDDLE"}})])
    else if (error != undefined) requests = requests.concat([CreatePresentationTextbox(newSlideID, "8", {x: 5.37, y: 0.71}, {x: 2.31, y: 2.46}, nickname, {size: 20, weight: 600, color: config.googleSlides.colors.incorrectAnswer, alignment: {x: "CENTER", y: "MIDDLE"}})])
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "8", {x: 5.37, y: 0.71}, {x: 2.31, y: 2.46}, nickname, {size: 20, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}})])

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {boolean} repeatEnabled 
 * @param {{title: string, artist: string, cover: string}} backgroundTrack
 */
async function SetPresentationPage_Connected(id, nickname, pin, repeatEnabled, backgroundTrack) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 2.69, y: 0.71}, {x: 3.65, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 2.69, y: 0.71}, {x: 3.65, y: 0.33}, "Connected", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "4", "RECTANGLE", {x: 7.71, y: 2.72}, {x: 1.15, y: 1.21}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "6", {x: 4.87, y: 1.65}, {x: 3.82, y: 1.39}, backgroundTrack.title, {size: 20, weight: 500, color: config.googleSlides.colors.black, alignment: {x: "START", y: "TOP"}}),
        CreatePresentationTextbox(newSlideID, "7", {x: 4.87, y: 0.71}, {x: 3.82, y: 3.03}, `by ${backgroundTrack.artist}`, {size: 20, weight: 500, color: config.googleSlides.colors.black, alignment: {x: "START", y: "MIDDLE"}}),
        CreatePresentationImage(newSlideID, "8", {x: 2.36, y: 2.37}, {x: 1.31, y: 1.38}, backgroundTrack.cover),

        CreatePresentationTextbox(newSlideID, "9", {x: 8.5, y: 0.82}, {x: 0.67, y: 4.09}, "You can listen to some background music while you wait for the game to start", {size: 20, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
    )

    if (repeatEnabled) requests = requests.concat([CreatePresentationTextbox(newSlideID, "10", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${nickname} - Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "10", {x: 10, y: 0.38}, {x: 0, y: 5.24}, "Make sure to turn on repeat mode to prevent accidentally quitting!", {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {boolean} repeatEnabled 
 * @param {string} quizName
 * @param {boolean} playingAgain 
 */
async function SetPresentationPage_GetReady(id, nickname, pin, repeatEnabled, quizName, playingAgain) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 2.69, y: 0.71}, {x: 3.65, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 2.69, y: 0.71}, {x: 3.65, y: 0.33}, "Get Ready", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationTextbox(newSlideID, "4", {x: 8.5, y: 2.13}, {x: 0.75, y: 2.36}, quizName, {size: 30, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "TOP"}}),
    )

    if (playingAgain) requests = requests.concat([CreatePresentationTextbox(newSlideID, "5", {x: 8.5, y: 1.03}, {x: 0.75, y: 1.33}, "Playing Again", {size: 50, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "5", {x: 8.5, y: 1.03}, {x: 0.75, y: 1.33}, "Quiz Starting", {size: 50, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    if (repeatEnabled) requests = requests.concat([CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${nickname} - Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, "Make sure to turn on repeat mode to prevent accidentally quitting!", {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {boolean} repeatEnabled 
 * @param {number} questionIndex 
 * @param {number} totalQuestions 
 * @param {number} points 
 * @param {string} questionText 
 */
async function SetPresentationPage_QuizQuestionPrep(id, nickname, pin, repeatEnabled, questionIndex, totalQuestions, points, questionText) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 3.9, y: 0.71}, {x: 3.05, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 3.9, y: 0.71}, {x: 3.05, y: 0.33}, "Question - Quiz", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationTextbox(newSlideID, "4", {x: 8.5, y: 1.03}, {x: 0.75, y: 1.33}, `Question #${questionIndex}`, {size: 50, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
        CreatePresentationTextbox(newSlideID, "5", {x: 8.5, y: 2.13}, {x: 0.75, y: 2.36}, questionText, {size: 30, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "TOP"}}),
    )

    if (repeatEnabled) { 
        requests = requests.concat([
            CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `Question ${questionIndex} / ${totalQuestions}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "7", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${nickname} - Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "8", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${points} Points`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "END", y: "MIDDLE"}})
        ])
    }
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, "Make sure to turn on repeat mode to prevent accidentally quitting!", {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {boolean} repeatEnabled 
 * @param {number} questionIndex 
 * @param {number} totalQuestions 
 * @param {number} time 
 * @param {string} questionText 
 * @param {string[]} choices 
 * @param {string | undefined} image 
 */
async function SetPresentationPage_QuizQuestion(id, nickname, pin, repeatEnabled, questionIndex, totalQuestions, time, questionText, choices, image) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 9.33, y: 0.99}, {x: 0.33, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 9.33, y: 0.99}, {x: 0.33, y: 0.33}, questionText, {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0})
    )

    if (repeatEnabled) { 
        requests = requests.concat([
            CreatePresentationTextbox(newSlideID, "4", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `Question ${questionIndex} / ${totalQuestions}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "5", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${nickname} - Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${time} Seconds`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "END", y: "MIDDLE"}})
        ])
    }
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "4", {x: 10, y: 0.38}, {x: 0, y: 5.24}, "Make sure to turn on repeat mode to prevent accidentally quitting!", {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    if (image == undefined) {
        if (choices.length == 4) {
            requests = requests.concat([
                CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 0.33, y: 1.49}, config.googleSlides.colors.answerRed, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "8", {x: 3.7, y: 1.26}, {x: 1.05, y: 1.66}, choices[0], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "9", "TRIANGLE", {x: 0.38, y: 0.33}, {x: 0.5, y: 2.14}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "10", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 5.08, y: 1.49}, config.googleSlides.colors.answerBlue, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "11", {x: 3.7, y: 1.26}, {x: 5.8, y: 1.66}, choices[1], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.38, y: 0.38}, {x: 5.25, y: 2.12}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
                
                CreatePresentationShape(newSlideID, "13", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 0.33, y: 3.29}, config.googleSlides.colors.answerYellow, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "14", {x: 3.7, y: 1.26}, {x: 1.05, y: 3.45}, choices[2], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "15", "ELLIPSE", {x: 0.38, y: 0.38}, {x: 0.5, y: 3.91}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "16", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 5.08, y: 3.29}, config.googleSlides.colors.answerGreen, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "17", {x: 3.7, y: 1.26}, {x: 5.8, y: 3.45}, choices[3], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "18", "RECTANGLE", {x: 0.38, y: 0.38}, {x: 5.25, y: 3.91}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0})
            ])
        } else if (choices.length == 3) {
            requests = requests.concat([
                CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 0.33, y: 1.49}, config.googleSlides.colors.answerRed, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "8", {x: 3.7, y: 1.26}, {x: 1.05, y: 1.66}, choices[0], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "9", "TRIANGLE", {x: 0.38, y: 0.33}, {x: 0.5, y: 2.14}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "10", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 5.08, y: 1.49}, config.googleSlides.colors.answerBlue, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "11", {x: 3.7, y: 1.26}, {x: 5.8, y: 1.66}, choices[1], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.38, y: 0.38}, {x: 5.25, y: 2.12}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "13", "ROUND_RECTANGLE", {x: 4.58, y: 1.63}, {x: 0.33, y: 3.29}, config.googleSlides.colors.answerYellow, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "14", {x: 3.7, y: 1.26}, {x: 1.05, y: 3.45}, choices[2], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "15", "ELLIPSE", {x: 0.38, y: 0.38}, {x: 0.5, y: 3.91}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0})
            ])
        } else {
            requests = requests.concat([
                CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 4.58, y: 3.42}, {x: 0.33, y: 1.49}, config.googleSlides.colors.answerRed, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "8", {x: 3.7, y: 3.08}, {x: 1.05, y: 1.66}, choices[0], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "9", "TRIANGLE", {x: 0.38, y: 0.33}, {x: 0.5, y: 3.04}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "10", "ROUND_RECTANGLE", {x: 4.58, y: 3.42}, {x: 5.08, y: 1.49}, config.googleSlides.colors.answerBlue, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "11", {x: 3.7, y: 3.08}, {x: 5.8, y: 1.66}, choices[1], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.38, y: 0.38}, {x: 5.25, y: 3.05}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0})
            ])
        }
    } else {
        if (choices.length == 4) {
            requests = requests.concat([
                CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 6.24, y: 0.73}, {x: 3.43, y: 1.49}, config.googleSlides.colors.answerRed, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "8", {x: 5.35, y: 0.41}, {x: 4.15, y: 1.66}, choices[0], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "9", "TRIANGLE", {x: 0.38, y: 0.33}, {x: 3.6, y: 1.7}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "10", "ROUND_RECTANGLE", {x: 6.24, y: 0.73}, {x: 3.43, y: 2.39}, config.googleSlides.colors.answerBlue, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "11", {x: 5.35, y: 0.41}, {x: 4.15, y: 2.56}, choices[1], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.38, y: 0.38}, {x: 3.6, y: 2.57}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "13", "ROUND_RECTANGLE", {x: 6.24, y: 0.73}, {x: 3.43, y: 3.29}, config.googleSlides.colors.answerYellow, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "14", {x: 5.35, y: 0.41}, {x: 4.15, y: 3.45}, choices[2], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "15", "ELLIPSE", {x: 0.38, y: 0.38}, {x: 3.6, y: 3.46}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "16", "ROUND_RECTANGLE", {x: 6.24, y: 0.73}, {x: 3.43, y: 4.18}, config.googleSlides.colors.answerGreen, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "17", {x: 5.35, y: 0.41}, {x: 4.15, y: 4.35}, choices[3], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "18", "RECTANGLE", {x: 0.38, y: 0.38}, {x: 3.6, y: 4.35}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationImage(newSlideID, "19", {x: 2.93, y: 3.42}, {x: 0.33, y: 1.49}, image)
            ])
        } else if (choices.length == 3) {
            requests = requests.concat([
                CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 6.24, y: 1.03}, {x: 3.43, y: 1.49}, config.googleSlides.colors.answerRed, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "8", {x: 5.35, y: 0.66}, {x: 4.15, y: 1.66}, choices[0], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "9", "TRIANGLE", {x: 0.38, y: 0.33}, {x: 3.6, y: 1.84}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "10", "ROUND_RECTANGLE", {x: 6.24, y: 1.03}, {x: 3.43, y: 2.69}, config.googleSlides.colors.answerBlue, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "11", {x: 5.35, y: 0.66}, {x: 4.15, y: 2.87}, choices[1], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.38, y: 0.38}, {x: 3.6, y: 3.01}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "13", "ROUND_RECTANGLE", {x: 6.24, y: 1.03}, {x: 3.43, y: 3.88}, config.googleSlides.colors.answerYellow, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "14", {x: 5.35, y: 0.66}, {x: 4.15, y: 4.06}, choices[2], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "15", "ELLIPSE", {x: 0.38, y: 0.38}, {x: 3.6, y: 4.23}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationImage(newSlideID, "19", {x: 2.93, y: 3.42}, {x: 0.33, y: 1.49}, image)
            ])
        } else {
            requests = requests.concat([
                CreatePresentationShape(newSlideID, "7", "ROUND_RECTANGLE", {x: 6.24, y: 1.63}, {x: 3.43, y: 1.49}, config.googleSlides.colors.answerRed, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "8", {x: 5.35, y: 1.29}, {x: 4.15, y: 1.66}, choices[0], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "9", "TRIANGLE", {x: 0.38, y: 0.33}, {x: 3.6, y: 2.14}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationShape(newSlideID, "10", "ROUND_RECTANGLE", {x: 6.24, y: 1.63}, {x: 3.43, y: 3.29}, config.googleSlides.colors.answerBlue, {color: config.googleSlides.colors.black, thickness: 0}),
                CreatePresentationTextbox(newSlideID, "11", {x: 5.35, y: 1.29}, {x: 4.15, y: 3.45}, choices[1], {size: 18, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
                CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.38, y: 0.38}, {x: 3.6, y: 3.91}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),

                CreatePresentationImage(newSlideID, "19", {x: 2.93, y: 3.42}, {x: 0.33, y: 1.49}, image)
            ])
        }
    }

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {boolean} repeatEnabled 
 * @param {number} questionIndex 
 * @param {number} totalQuestions 
 * @param {number} points 
 * @param {"correct" | "incorrect" | "no response"} questionOutcome 
 * @param {number} rank 
 * @param {number} pointGain 
 * @param {number} answerStreak 
 */
async function SetPresentationPage_PostQuestion(id, nickname, pin, repeatEnabled, questionIndex, totalQuestions, points, questionOutcome, rank, pointGain, answerStreak) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 3.9, y: 0.71}, {x: 3.05, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 3.9, y: 0.71}, {x: 3.05, y: 0.33}, "Post-Question", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0}),
    )

    if (rank == 1) {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "4", "ROUND_RECTANGLE", {x: 9.33, y: 1.05}, {x: 0.33, y: 2.1}, config.googleSlides.colors.purple3, {color: config.googleSlides.colors.goldOuter, thickness: 12}),
            CreatePresentationTextbox(newSlideID, "5", {x: 3.9, y: 1.05}, {x: 5.75, y: 2.1}, `Ranked #${rank}`, {size: 30, weight: 500, color: config.googleSlides.colors.goldOuter, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else if (rank == 2) {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "4", "ROUND_RECTANGLE", {x: 9.33, y: 1.05}, {x: 0.33, y: 2.1}, config.googleSlides.colors.purple3, {color: config.googleSlides.colors.silverOuter, thickness: 8}),
            CreatePresentationTextbox(newSlideID, "5", {x: 3.9, y: 1.05}, {x: 5.75, y: 2.1}, `Ranked #${rank}`, {size: 30, weight: 500, color: config.googleSlides.colors.silverOuter, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else if (rank == 3) {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "4", "ROUND_RECTANGLE", {x: 9.33, y: 1.05}, {x: 0.33, y: 2.1}, config.googleSlides.colors.purple3, {color: config.googleSlides.colors.bronzeOuter, thickness: 4}),
            CreatePresentationTextbox(newSlideID, "5", {x: 3.9, y: 1.05}, {x: 5.75, y: 2.1}, `Ranked #${rank}`, {size: 30, weight: 500, color: config.googleSlides.colors.bronzeOuter, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "4", "ROUND_RECTANGLE", {x: 9.33, y: 1.05}, {x: 0.33, y: 2.1}, config.googleSlides.colors.purple3, {color: config.googleSlides.colors.black, thickness: 0}),
            CreatePresentationTextbox(newSlideID, "5", {x: 3.9, y: 1.05}, {x: 5.75, y: 2.1}, `Ranked #${rank}`, {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    }

    if (repeatEnabled) { 
        requests = requests.concat([
            CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `Question ${questionIndex} / ${totalQuestions}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "START", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "7", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${nickname} - Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "8", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${points} Points`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "END", y: "MIDDLE"}})
        ])
    }
    else requests = requests.concat([CreatePresentationTextbox(newSlideID, "6", {x: 10, y: 0.38}, {x: 0, y: 5.24}, "Make sure to turn on repeat mode to prevent accidentally quitting!", {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})])

    if (questionOutcome == "correct") {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "9", "ELLIPSE", {x: 1.77, y: 1.77}, {x: 4.11, y: 1.74}, config.googleSlides.colors.correctAnswer, {color: config.googleSlides.colors.white, thickness: 8}),
            CreatePresentationShape(newSlideID, "10", "DIAMOND", {x: 0.46, y: 0.46}, {x: 4.42, y: 2.39}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "11", "DIAMOND", {x: 0.46, y: 0.46}, {x: 4.65, y: 2.62}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.46, y: 0.46}, {x: 4.88, y: 2.39}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "13", "DIAMOND", {x: 0.46, y: 0.46}, {x: 5.11, y: 2.16}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),

            CreatePresentationTextbox(newSlideID, "14", {x: 3.9, y: 1.05}, {x: 0.33, y: 2.1}, `+ ${pointGain} Points`, {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),

            CreatePresentationTextbox(newSlideID, "15", {x: 2.92, y: 0.63}, {x: 3.65, y: 4.06}, "Answer Streak", {size: 25, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationShape(newSlideID, "16", "ELLIPSE", {x: 0.96, y: 0.96}, {x: 2.52, y: 3.9}, config.googleSlides.colors.bronzeOuter, {color: config.googleSlides.colors.white, thickness: 4}),
            CreatePresentationShape(newSlideID, "17", "ELLIPSE", {x: 0.96, y: 0.96}, {x: 6.73, y: 3.9}, config.googleSlides.colors.bronzeOuter, {color: config.googleSlides.colors.white, thickness: 4}),
            CreatePresentationTextbox(newSlideID, "18", {x: 2.92, y: 0.63}, {x: 1.54, y: 4.06}, answerStreak.toString(), {size: 35, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "19", {x: 2.92, y: 0.63}, {x: 5.75, y: 4.06}, answerStreak.toString(), {size: 35, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
        ])
    } else if (questionOutcome == "incorrect") {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "9", "ELLIPSE", {x: 1.77, y: 1.77}, {x: 4.11, y: 1.74}, config.googleSlides.colors.incorrectAnswer, {color: config.googleSlides.colors.white, thickness: 8}),
            CreatePresentationShape(newSlideID, "10", "DIAMOND", {x: 0.46, y: 0.46}, {x: 4.54, y: 2.16}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "11", "DIAMOND", {x: 0.46, y: 0.46}, {x: 4.54, y: 2.62}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "12", "DIAMOND", {x: 0.46, y: 0.46}, {x: 4.77, y: 2.39}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "13", "DIAMOND", {x: 0.46, y: 0.46}, {x: 5, y: 2.16}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),
            CreatePresentationShape(newSlideID, "14", "DIAMOND", {x: 0.46, y: 0.46}, {x: 5, y: 2.62}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),

            CreatePresentationTextbox(newSlideID, "15", {x: 3.9, y: 1.05}, {x: 0.33, y: 2.1}, "Incorrect!", {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else if (questionOutcome == "no response") {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "9", "ELLIPSE", {x: 1.77, y: 1.77}, {x: 4.11, y: 1.74}, config.googleSlides.colors.gray, {color: config.googleSlides.colors.white, thickness: 8}),
            CreatePresentationShape(newSlideID, "10", "RECTANGLE", {x: 0.93, y: 0.31}, {x: 4.54, y: 2.47}, config.googleSlides.colors.white, {color: config.googleSlides.colors.white, thickness: 0}),

            CreatePresentationTextbox(newSlideID, "11", {x: 3.9, y: 1.05}, {x: 0.33, y: 2.1}, "No Response", {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    }

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id 
 * @param {string} nickname
 * @param {string} pin 
 * @param {number} correctQuestions 
 * @param {number} totalQuestions 
 * @param {number} points 
 * @param {number} rank 
 */
async function SetPresentationPage_EndOfGame(id, nickname, pin, correctQuestions, totalQuestions, points, rank) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    var requests = [].concat(
        CreatePresenationPage(newSlideID, 0),
        SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),

        CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 4.91}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),

        CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 3.28, y: 0.71}, {x: 3.36, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "2", {x: 3.28, y: 0.71}, {x: 3.36, y: 0.33}, "End of Game", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),

        CreatePresentationShape(newSlideID, "3", "RECTANGLE", {x: 10, y: 0.38}, {x: 0, y: 5.24}, config.googleSlides.colors.purple4, {color: config.googleSlides.colors.black, thickness: 0}),
        CreatePresentationTextbox(newSlideID, "4", {x: 10, y: 0.38}, {x: 0, y: 5.24}, `${nickname} - Game PIN: ${pin}`, {size: 12, weight: 600, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
        
        CreatePresentationShape(newSlideID, "5", "ROUND_RECTANGLE", {x: 9.33, y: 1.05}, {x: 0.33, y: 2.1}, config.googleSlides.colors.purple3, {color: config.googleSlides.colors.black, thickness: 0}),
        
        CreatePresentationTextbox(newSlideID, "6", {x: 8.5, y: 0.82}, {x: 0.75, y: 4.06}, "Pause Spotify or play a song outside the playlist to exit the game", {size: 20, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
    )

    if (rank == 1) {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "7", "PENTAGON", {x: 1.96, y: 1.86}, {x: 4.02, y: 1.55}, config.googleSlides.colors.goldInner, {color: config.googleSlides.colors.goldOuter, thickness: 8}),
            CreatePresentationTextbox(newSlideID, "8", {x: 3.9, y: 1.05}, {x: 3.05, y: 2.1}, `#${rank}`, {size: 60, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else if (rank == 2) {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "7", "PENTAGON", {x: 1.96, y: 1.86}, {x: 4.02, y: 1.55}, config.googleSlides.colors.silverInner, {color: config.googleSlides.colors.silverOuter, thickness: 8}),
            CreatePresentationTextbox(newSlideID, "8", {x: 3.9, y: 1.05}, {x: 3.05, y: 2.1}, `#${rank}`, {size: 50, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else if (rank == 3) {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "7", "PENTAGON", {x: 1.96, y: 1.86}, {x: 4.02, y: 1.55}, config.googleSlides.colors.bronzeInner, {color: config.googleSlides.colors.bronzeOuter, thickness: 8}),
            CreatePresentationTextbox(newSlideID, "8", {x: 3.9, y: 1.05}, {x: 3.05, y: 2.1}, `#${rank}`, {size: 40, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else {
        requests = requests.concat([
            CreatePresentationShape(newSlideID, "7", "PENTAGON", {x: 1.96, y: 1.86}, {x: 4.02, y: 1.55}, config.googleSlides.colors.purple3, {color: config.googleSlides.colors.white, thickness: 8}),
            CreatePresentationTextbox(newSlideID, "8", {x: 3.9, y: 1.05}, {x: 3.05, y: 2.1}, `#${rank}`, {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    }

    if (correctQuestions == totalQuestions) {
        requests = requests.concat([
            CreatePresentationTextbox(newSlideID, "9", {x: 3.9, y: 0.71}, {x: 0.33, y: 2.27}, `${points} Points`, {size: 30, weight: 500, color: config.googleSlides.colors.goldOuter, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "10", {x: 3.9, y: 0.71}, {x: 5.77, y: 2.27}, `${correctQuestions} / ${totalQuestions} Correct`, {size: 30, weight: 500, color: config.googleSlides.colors.goldOuter, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    } else {
        requests = requests.concat([
            CreatePresentationTextbox(newSlideID, "9", {x: 3.9, y: 0.71}, {x: 0.33, y: 2.27}, `${points} Points`, {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "10", {x: 3.9, y: 0.71}, {x: 5.77, y: 2.27}, `${correctQuestions} / ${totalQuestions} Correct`, {size: 30, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}})
        ])
    }

    requests = requests.concat(DeletePresentationObject(oldSlideID))

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: requests}
    })
}

/**
 * @param {string} id
 */
async function SetPresentationPage_Quit(id) {
    var thisSlide = await slidesAPI.presentations.get({presentationId:id})

    var oldSlideID = thisSlide.data.slides[0].objectId

    var newSlideID = 1 + Number(oldSlideID)
    if (isNaN(newSlideID)) newSlideID = 0
    newSlideID = newSlideID.toString().padStart(5, '0')

    await slidesAPI.presentations.batchUpdate({
        presentationId: id,
        requestBody: {requests: [].concat(
            CreatePresenationPage(newSlideID, 0),
            SetPresentationBackground(newSlideID, config.googleSlides.colors.purple2),
            CreatePresentationShape(newSlideID, "0", "ROUND_RECTANGLE", {x: 9.67, y: 5.29}, {x: 0.17, y: 0.17}, config.googleSlides.colors.purple1, {color: config.googleSlides.colors.black, thickness: 0}),
            CreatePresentationShape(newSlideID, "1", "ROUND_RECTANGLE", {x: 1.26, y: 0.71}, {x: 4.37, y: 0.33}, config.googleSlides.colors.white, {color: config.googleSlides.colors.black, thickness: 0}),
            CreatePresentationTextbox(newSlideID, "2", {x: 1.26, y: 0.71}, {x: 4.37, y: 0.33}, "Quit", {size: 30, weight: 600, color: config.googleSlides.colors.black, alignment: {x: "CENTER", y: "MIDDLE"}}),
            CreatePresentationTextbox(newSlideID, "3", {x: 8.5, y: 0.52}, {x: 0.75, y: 2.7}, "You have exited the match", {size: 20, weight: 500, color: config.googleSlides.colors.white, alignment: {x: "CENTER", y: "MIDDLE"}}),
            DeletePresentationObject(oldSlideID))
        }
    })
}

function CreatePresenationPage(pageObject, index) {
    return [{createSlide: {
        objectId: pageObject,
        insertionIndex: index,
    }}]
}

/**
 * @param {string} pageObject 
 * @param {string} objectIndex 
 * @param {{x: number, y: number}} size 
 * @param {{x: number, y: number}} position 
 * @param {string} text 
 * @param {{size: number, weight: number, color: {red: number, green: number, blue: number}, alignment: {x: "START" | "CENTER" | "END", y: "BOTTOM" | "MIDDLE" | "TOP"}}} font 
 */
function CreatePresentationTextbox(pageObject, objectIndex, size, position, text, font) {
    return [{createShape: {
        objectId: `${pageObject}_${objectIndex}`,
        shapeType: "TEXT_BOX",
        elementProperties: {
            pageObjectId: pageObject,
            size: {
                width: {magnitude: Math.round(size.x * 914400), unit: "EMU"},
                height: {magnitude: Math.round(size.y * 914400), unit: "EMU"}
            },
            transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: Math.round(position.x * 914400),
                translateY: Math.round(position.y * 914400),
                unit: "EMU"
            }
        }
    }},{insertText: {
        objectId: `${pageObject}_${objectIndex}`,
        text: text,
        insertionIndex: 0
    }},{updateTextStyle: {
        objectId: `${pageObject}_${objectIndex}`,
        style: {
            weightedFontFamily: {
                fontFamily: 'Montserrat',
                weight: font.weight
            },
            fontSize: {
                magnitude: font.size,
                unit: "PT"
            },
            foregroundColor: {
                opaqueColor: {
                    rgbColor: font.color
                }
            }
        },
        textRange: {
            type: "ALL"
        },
        fields: "weightedFontFamily, fontSize, foregroundColor"
    }},{updateParagraphStyle: {
        objectId: `${pageObject}_${objectIndex}`,
        style: {
            alignment: font.alignment.x
        },
        textRange: {
            type: "ALL"
        },
        fields: "alignment"
    }},{updateShapeProperties: {
        objectId: `${pageObject}_${objectIndex}`,
        shapeProperties: {
            contentAlignment: font.alignment.y
        },
        fields: "contentAlignment"
    }}]
}

/**
 * @param {string} pageObject 
 * @param {string} objectIndex 
 * @param {"RECTANGLE" | "ROUND_RECTANGLE"} shape
 * @param {{x: number, y: number}} size 
 * @param {{x: number, y: number}} position 
 * @param {{red: number, green: number, blue: number}} color 
 * @param {{color: {red: number, green: number, blue: number}, thickness: number}} outline 
 */
function CreatePresentationShape(pageObject, objectIndex, shape, size, position, color, outline) {
    if (outline.thickness == 0) outline.thickness = 0.001

    return [{createShape: {
        objectId: `${pageObject}_${objectIndex}`,
        shapeType: shape,
        elementProperties: {
            pageObjectId: pageObject,
            size: {
                width: {magnitude: Math.round(size.x * 914400), unit: "EMU"},
                height: {magnitude: Math.round(size.y * 914400), unit: "EMU"}
            },
            transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: Math.round(position.x * 914400),
                translateY: Math.round(position.y * 914400),
                unit: "EMU"
            }
        }
    }},{updateShapeProperties: {
        objectId: `${pageObject}_${objectIndex}`,
        shapeProperties: {
            shapeBackgroundFill: {
                propertyState: "RENDERED",
                solidFill: {
                    color: {
                        rgbColor: color
                    },
                    alpha: (color != undefined) ? 1 : 0
                }
            },
            outline: {
                outlineFill: {
                    solidFill: {
                        color: {
                            rgbColor: outline.color
                        },
                        alpha: 1
                    }
                },
                weight: {magnitude: outline.thickness * 0.7, unit: "PT"},
                propertyState: "RENDERED"
            }
        },
        fields: "shapeBackgroundFill, outline"
    }}]
}

function DeletePresentationObject(objectID) {
    return [{deleteObject: {
        objectId: objectID
    }}]
}

function SetPresentationBackground(id, color) {
    return [{
        updatePageProperties: {
            objectId: id,
            pageProperties: {
                pageBackgroundFill: {
                    propertyState: "RENDERED",
                    solidFill: {
                        color: {
                            rgbColor: color
                        }, alpha: 1
                    }
                }
            },
            fields: "pageBackgroundFill"
        }
    }]
}

/**
 * @param {string} pageObject 
 * @param {string} objectIndex 
 * @param {{x: number, y: number}} size 
 * @param {{x: number, y: number}} position 
 * @param {string} imageURL 
 */
function CreatePresentationImage(pageObject, objectIndex, size, position, imageURL) {
    return [{createImage: {
        objectId: `${pageObject}_${objectIndex}`,
        elementProperties: {
            pageObjectId: pageObject,
            size: {
                width: {magnitude: Math.round(size.x * 914400), unit: "EMU"},
                height: {magnitude: Math.round(size.y * 914400), unit: "EMU"}
            },
            transform: {
                scaleX: 1,
                scaleY: 1,
                translateX: Math.round(position.x * 914400),
                translateY: Math.round(position.y * 914400),
                unit: "EMU"
            }
        },
        url: imageURL
    }}]
}

function ConvertHexToColor(hex) {
    var numbericValue = Array.from(hex).map(char => Number("0x" + char))

    return {
        red: (16 * numbericValue[0] + numbericValue[1]) / 255,
        green: (16 * numbericValue[2] + numbericValue[3]) / 255,
        blue: (16 * numbericValue[4] + numbericValue[5]) / 255
    }
}