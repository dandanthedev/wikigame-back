const { Server } = require('socket.io');
const { createServer } = require('http');

const server = createServer();

const io = new Server(server, {
    cors: {
        origin: '*', //TODO: fix
    }
});

const lobbies = new Map();
const connectedSockets = new Map();
const socketPages = new Map();
const userScores = new Map();
const checkNavigation = new Map();

const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomString(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateGamePin() {
    let pin = '';
    for (let i = 0; i < 6; i++) {
        pin += Math.floor(Math.random() * 10);
    }

    return pin;
}

function isHost(pin, socket) {
    const data = lobbies.get(pin);

    if (data) {
        if (data.host === socket.userid) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

function getUsersInLobby(pin) {
    const data = lobbies.get(pin);
    if (!data) return [];
    let usersByName = [];

    for (let socketId of data.sockets) {
        const socketName = socketIdToName(socketId);
        usersByName.push(socketName);
    }

    //filter out nulls
    usersByName = usersByName.filter((user) => user !== null);

    return usersByName;
}

function socketIdToName(socketId) {
    return connectedSockets.get(socketId) || null;
}

function createLobby(pin) {
    lobbies.set(pin, {
        sockets: []
    });
}

function sendLeaderboaard(pin, user) {
    const data = lobbies.get(pin);
    if (!data) return;

    const scores = data.scores;

    //sort by clicks, if tie, sort by time
    scores.sort((a, b) => {
        if (a.clicks === b.clicks) {
            return b.time - a.time;
        } else {
            return b.clicks - a.clicks;
        }
    });


    //reverse order so least clicks are at the top
    scores.reverse();

    //move DNF's to the end
    scores.forEach((score, index) => {
        if (score.clicks === "DNF") {
            scores.splice(index, 1);
            scores.push(score);
        }
    });


    io.to(pin).emit("scores", scores);

    if (user) {
        user.emit("scores", scores);
    }
}

function removeUserFromLobby(userid, pin, socket) {
    const lobby = lobbies.get(pin);
    if (!lobby) return;
    if (socket) socket.leave(pin);
    lobby.sockets.splice(lobby.sockets.indexOf(userid), 1);

    if (lobby.host === userid && lobby.sockets.length > 0) {
        const random = Math.floor(Math.random() * lobby.sockets.length);
        lobby.host = lobby.sockets[random];
        io.to(lobby.host).emit("isHost", true);
    }

    io.to(pin).emit("users", getUsersInLobby(pin));

    if (lobby.sockets.length === 0) {
        lobbies.delete(pin);
    }
}

io.on('connection', (socket) => {
    socket.on('disconnect', async () => {
        console.log(`user ${socket.userid} disconnected`);
        //remove all sockets from lobby
        lobbies.forEach((data, pin) => {
            if (data.sockets.includes(socket.userid)) {
                data.sockets.splice(data.sockets.indexOf(socket.userid), 1);

            }
            if (data.host === socket.userid) {
                //pick new host
                const newHost = data.sockets[Math.floor(Math.random() * data.sockets.length)];
                data.host = newHost;
                //send message to new host
                io.to(newHost).emit("isHost", true);
            }
            io.to(pin).emit("users", getUsersInLobby(pin));
        });

    });

    socket.on("signOn", async ({ name, id }) => {
        socket.name = name;
        socket.userid = id;
        socket.emit("name", name);
        socket.emit("id", id);
        socket.join(id);
        connectedSockets.set(socket.userid, name);
    });

    socket.on("generateId", () => {
        const id = randomString(10);
        socket.userid = id;
        socket.join(id);
        socket.emit("id", id);
    });


    socket.on("host", () => {
        const pin = generateGamePin();

        createLobby(pin);

        socket.emit("join", pin);


    });

    socket.on("isHost", (pin) => {
        if (!socket.name) return socket.emit("noName");

        const userIsHost = isHost(pin, socket);
        socket.emit("isHost", userIsHost);
    });

    socket.on("discoverGame", (pin) => {
        if (!socket.name) return socket.emit("noName");
        const data = lobbies.get(pin);
        if (data) return socket.emit("join", pin);
        else return socket.emit("joinError", "This game does not exist!");
    });

    socket.on("exists", (pin) => {
        if (!socket.name) return socket.emit("noName");
        const data = lobbies.get(pin);
        return socket.emit("exists", !!data);
    });

    socket.on("join", (pin) => {
        if (socket.gameId === pin) return;
        if (!socket.name) return socket.emit("noName");
        const data = lobbies.get(pin);
        if (!data) return socket.emit("joinError", "This game does not exist!");
        socket.gameId = pin;

        if (data.sockets.length === 0) data.host = socket.userid;

        data.sockets.push(socket.userid);
        socket.join(pin);
        socket.emit("join", pin);

        const usersByName = getUsersInLobby(pin);

        io.to(pin).emit("users", usersByName);

        if (data.started) {
            let articleToGo;
            let route;
            let clicks;
            const socketPage = socketPages.get(socket.userid);
            if (socketPage && socketPage.gameId === pin) {
                articleToGo = socketPage.page;
                route = socketPage.route;
                clicks = socketPage.clicks;

            } else {
                articleToGo = data.sourceArticle;
            }
            socket.emit("start", "/wiki/" + articleToGo + "?lang=" + data.language + "&gameId=" + pin);

        }
    });

    socket.on("getRoute", (pin) => {
        if (!socket.name) return socket.emit("noName");

        const score = userScores.get(`${socket.userid}-${pin}`);
        socket.emit("route", {
            route: score?.route ?? "",
            clicks: score?.clicks ?? 0
        });

    });

    socket.on("gameDetails", (pin) => {
        if (!socket.name) return socket.emit("noName");
        const data = lobbies.get(pin);
        if (!data) return socket.emit("joinError", "This game does not exist!");
        if (!data.sockets.includes(socket.userid)) return socket.emit("joinError", "You are not in this game!");

        socket.emit("exists", true);
        socket.emit("isHost", isHost(pin, socket));
        socket.emit("users", getUsersInLobby(pin));

        socket.emit("sourceArticle", data.sourceArticle);
        socket.emit("destinationArticle", data.destinationArticle);
        socket.emit("language", data.language || "en");
    });



    socket.on("getUsers", (pin) => {
        socket.emit("users", getUsersInLobby(pin));
    });

    socket.on("sourceArticle", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data.pin) return socket.emit("sourceArticleError", "No pin provided!");
        if (!data.article) data.article = null;
        const lobby = lobbies.get(data.pin);
        if (!lobby) return socket.emit("sourceArticleError", "This game does not exist!");
        if (lobby.host !== socket.userid) return socket.emit("sourceArticleError", "You are not the host of this game!");
        lobby.sourceArticle = data.article?.replaceAll(" ", "_") ?? null;

        io.to(data.pin).emit("sourceArticle", lobby.sourceArticle);

    });

    socket.on("destinationArticle", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data.pin) return socket.emit("destinationArticleError", "No pin provided!");
        if (!data.article) data.article = null;
        const lobby = lobbies.get(data.pin);
        if (!lobby) return socket.emit("destinationArticleError", "This game does not exist!");
        if (lobby.host !== socket.userid) return socket.emit("destinationArticleError", "You are not the host of this game!");
        lobby.destinationArticle = data.article?.replaceAll(" ", "_") ?? null;
        io.to(data.pin).emit("destinationArticle", lobby.destinationArticle);
    });

    socket.on("language", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data.pin || !data.language) return socket.emit("languageError", "No pin or language provided!");
        const lobby = lobbies.get(data.pin);
        if (!lobby) return socket.emit("languageError", "This game does not exist!");
        if (lobby.host !== socket.userid) return socket.emit("languageError", "You are not the host of this game!");
        lobby.language = data.language;
        lobby.sourceArticle = null;
        lobby.destinationArticle = null;
        io.to(data.pin).emit("language", lobby.language);
        io.to(data.pin).emit("sourceArticle", null);
        io.to(data.pin).emit("destinationArticle", null);
    });

    socket.on("start", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("startError", "No pin provided!");

        const lobby = lobbies.get(pin);
        if (!lobby) return socket.emit("startError", "This game does not exist!");
        if (lobby.host !== socket.userid) return socket.emit("startError", "You are not the host of this game!");

        //set started in lobby to true
        if (!lobby.language) lobby.language = "en";
        lobby.started = true;
        lobby.startTime = Date.now() + 3000;

        lobbies.set(pin, lobby);


        io.to(pin).emit
            ("start", "/wiki/" + lobby.sourceArticle + "?lang=" + lobby.language + "&gameId=" + pin);


    });

    socket.on("checkNavigation", (data) => {
        if (!socket.name) return socket.emit("noName");
        const { id, error, result } = data;
        const check = checkNavigation.get(id);
        if (!check) return socket.emit("checkNavigationError", "No check found");
        if (check.id !== socket.userid) return socket.emit("checkNavigationError", "This check is not for you!");
        if (error) {
            if (check.i > 2) {
                checkNavigation.delete(id);
                //welp, guess the cheaters win this time
                return;
            }
            //assign to new random user
            const random = Math.floor(Math.random() * lobbies.get(id).sockets.length);
            const randomUser = lobbies.get(id).sockets[random];
            io.to(randomUser).emit("checkNavigation", {
                id,
                from: result.from,
                to: result.to,
                lang: result.lang,
            });
            checkNavigation.set(id, {
                id: randomUser,
                i: parseInt(check.i) || 0 + 1,
            });
        }
        if (result === false) {
            //kick user for cheating
            removeUserFromLobby(check.targetUser, check.pin);
            checkNavigation.delete(id);
            io.to(check.targetUser).emit("cheater");

        }
    });

    socket.on("pageNavigation", (data) => {
        if (!socket.name) return socket.emit("noName");

        socketPages.set(socket.userid, data);
        const score = userScores.get(`${socket.userid}-${data.gameId}`);
        const lobby = lobbies.get(data.gameId);


        if (!lobby) return socket.emit("pageNavigationError", "This game does not exist!");
        if (data.page === lobby?.sourceArticle) return; //if just starting, don't count
        if (data.page === score?.currentPage) return; //dont count refresh dingen


        if (Math.random() > 0.5) {
            //pick a random person from the lobby
            const random = Math.floor(Math.random() * lobby.sockets.length);
            const randomUser = lobby.sockets[random];
            //ask to check this
            io.to(randomUser).emit("checkNavigation", {
                id: `${socket.userid}-${data.gameId}`,
                from: score?.currentPage ?? lobby.sourceArticle,
                to: data.page,
                redirectedFrom: data.redirectedFrom,
                lang: lobby.language,
            });
            checkNavigation.set(`${socket.userid}-${data.gameId}`, {
                id: randomUser,
                targetUser: socket.userid,
                pin: data.gameId,
                i: 0,
            });
        }

        userScores.set(`${socket.userid}-${data.gameId}`, {
            clicks: score?.clicks || 0 + 1,
            route: `${!score?.route ? lobby.sourceArticle.replaceAll("_", " ") : score.route} -> ${data.page.replaceAll("_", " ")}`,
            currentPage: data.page,
        });



    });

    socket.on("score", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data) return socket.emit("scoreError", "No gameId provided!");

        // if (!data.clicks || !data.route) return socket.emit("scoreError", "No clicks or route provided!");

        const lobby = lobbies.get(data);
        if (!lobby) return socket.emit("scoreError", "This game does not exist!");

        if (!lobby.scores) lobby.scores = [];

        const score = userScores.get(`${socket.userid}-${data}`);

        lobby.scores.push({
            id: socket.userid,
            name: socket.name,
            //include the click to the target page
            clicks: (score?.clicks || 0) + 1,
            route: `${score?.route ?? lobby.sourceArticle} -> ${lobby.destinationArticle.replaceAll("_", " ")} 🏁`,
            time: Date.now(),
        });

        sendLeaderboaard(data, socket);

        socket.emit("gotoScores", data);
    });

    socket.on("giveUp", ({ id, route }) => {
        const pin = id;

        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("giveUpError", "No pin provided!");

        const lobby = lobbies.get(pin);
        if (!lobby) return socket.emit("giveUpError", "This game does not exist!");
        if (!lobby.scores) lobby.scores = [];

        lobby.scores.push({
            id: socket.userid,
            name: socket.name,
            clicks: "DNF",
            route,
            time: Date.now(),
        });

        sendLeaderboaard(pin, socket);

        socket.emit("gotoScores", pin);
    });

    socket.on("scores", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("scoresError", "No pin provided!");

        const lobby = lobbies.get(pin);
        if (!lobby) return socket.emit("scoresError", "This game does not exist!");

        sendLeaderboaard(pin, socket);
        socket.emit("started", lobby.startTime);
    });

    socket.on("leave", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("leaveError", "No pin provided!");

        const lobby = lobbies.get(pin);
        if (!lobby) return socket.emit("leaveError", "This game does not exist!");

        removeUserFromLobby(socket.userid, pin, socket);


    });

    socket.on("newLobby", (pin) => {
        if (!pin) return socket.emit("newLobbyError", "No pin provided!");
        const lobby = lobbies.get(pin);

        if (!lobby) return socket.emit("newLobbyError", "This game does not exist!");

        //leave current lobby
        lobby.sockets.splice(lobby.sockets.indexOf(socket.userid), 1);
        socket.leave(pin);
        io.to(pin).emit("users", getUsersInLobby(pin));


        if (lobby.newLobby) socket.emit("join", lobby.newLobby);


        else {

            const newLobby = generateGamePin();

            createLobby(newLobby);

            lobby.newLobby = newLobby;
            socket.emit("join", newLobby);
        }

        const newLobby = lobbies.get(lobby.newLobby);

        //set host
        if (socket.userid === lobby.host && newLobby.host !== socket.userid) {
            io.to(newLobby.host).emit("isHost", false);
            newLobby.host = socket.userid;
            io.to(newLobby.host).emit("isHost", true);
        }

        if (lobby.sockets.length === 0) {
            lobbies.delete(pin);
        }



    });


});



server.listen(process.env.PORT || 3000, () => {
    console.log(`Server is listening on port ${process.env.PORT || 3000}`);
});