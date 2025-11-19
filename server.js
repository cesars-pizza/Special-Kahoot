const http = require('http')
const fs = require('fs')

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
        console.log(await GetPlayingSong(users[userKeys[i]]))
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

    server.listen(8080)
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

//playlistID: "",
      //  playlistURL: "",

    if (headUser == undefined) headUser = userEntry

    var createdPlaylist = await SendRequest(`https://api.spotify.com/v1/users/${headUser.id}/playlists?name=abc`, {
        method: "POST",
        body: JSON.stringify({name: `Kahoot Player (${user.display_name})`, description: user.id, public: false}),
        headers: {
            "Authorization": "Bearer " + accessToken.access_token,
            "Content-Type": "application/json"
        }
    }, user)

    userEntry.playlistID = createdPlaylist.id
    userEntry.playlistURL = createdPlaylist.external_urls.spotify

    users[user.id] = userEntry

    return userEntry
}

async function SendRequest(url, params, user) {
    var request = await fetch(url, params)
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
        var refreshedTokens = await refreshReq.json()
        user.access_token = refreshedTokens.access_token
        if (refreshedTokens.refresh_token != undefined) user.refresh_token = refreshedTokens.refresh_token
        
        return await SendRequest(url, params, user)
    } else {
        var response = await request.json()
        response.responseStatus = request.status
        console.log(`${request.status} - ${response.error.message}`)
        return response
    }
}

async function GetPlayingSong(user) {
    var playbackState = await SendRequest("https://api.spotify.com/v1/me/player", {
        method: "GET",
        headers: {
            "authorization": "Authorization: Bearer " + user.access_token
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

    return playingType
}