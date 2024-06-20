const { Server } = require('socket.io');
const { createServer } = require('http');

const server = createServer();

const io = new Server(server, {
    cors: {
        origin: '*', //TODO: fix
    }
});

const lobbys = new Map();

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
    const data = lobbys.get(pin);

    if (data) {
        if (data.host === socket.id) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

function getUsersInLobby(pin) {
    const data = lobbys.get(pin);
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
    return io.sockets.sockets.get(socketId)?.name || null;
}

function createLobby(pin) {
    lobbys.set(pin, {
        sockets: []
    });
}

io.on('connection', (socket) => {
    console.log(`user ${socket.id} connected`);
    socket.on('disconnect', async () => {
        console.log(`user ${socket.id} disconnected`);
        //remove all sockets from lobby
        lobbys.forEach((data, pin) => {
            if (data.sockets.includes(socket.id)) {
                data.sockets.splice(data.sockets.indexOf(socket.id), 1);

            }
            if (data.host === socket.id) {
                //pick new host
                const newHost = data.sockets[Math.floor(Math.random() * data.sockets.length)];
                data.host = newHost;
                //send message to new host
                io.to(newHost).emit("host", true);
            }
            io.to(pin).emit("users", getUsersInLobby(pin));
        });

    });

    socket.on("name", (name) => {
        socket.name = name;
        socket.emit("name", name);
    });

    socket.on("host", (name) => {
        if (!socket.name) return socket.emit("noName");
        const pin = generateGamePin();

        createLobby(pin);

        socket.emit("gameCreated", pin);


    });

    socket.on("isHost", (pin) => {
        if (!socket.name) return socket.emit("noName");

        const userIsHost = isHost(pin, socket);
        socket.emit("isHost", userIsHost);
    });

    socket.on("exists", (pin) => {
        if (!socket.name) return socket.emit("noName");
        const data = lobbys.get(pin);
        return socket.emit("exists", !!data);
    });

    socket.on("join", (pin) => {
        if (!socket.name) return socket.emit("noName");
        const data = lobbys.get(pin);
        if (!data) return socket.emit("joinError", "This game does not exist!");
        //check if someone with the same name is already in the lobby
        for (let socketId of data.sockets) {
            const socketName = socketIdToName(socketId);

            if (socketName === socket.name) {
                let randomChars = randomString(3);
                socket.name = `${socket.name}-${randomChars}`;
                socket.emit("name", socket.name);
            }
        }

        if (data.sockets.length === 0) data.host = socket.id;

        data.sockets.push(socket.id);
        socket.join(pin);
        socket.emit("join", pin);

        const usersByName = getUsersInLobby(pin);

        io.to(pin).emit("users", usersByName);
    });

    socket.on("gameDetails", (pin) => {
        if (!socket.name) return socket.emit("noName");
        const data = lobbys.get(pin);
        if (!data) return socket.emit("joinError", "This game does not exist!");
        if (!data.sockets.includes(socket.id)) return socket.emit("joinError", "You are not in this game!");

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
        const lobby = lobbys.get(data.pin);
        if (!lobby) return socket.emit("sourceArticleError", "This game does not exist!");
        if (lobby.host !== socket.id) return socket.emit("sourceArticleError", "You are not the host of this game!");
        lobby.sourceArticle = data.article?.replaceAll(" ", "_") ?? null;

        io.to(data.pin).emit("sourceArticle", lobby.sourceArticle);

    });

    socket.on("destinationArticle", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data.pin) return socket.emit("destinationArticleError", "No pin provided!");
        if (!data.article) data.article = null;
        const lobby = lobbys.get(data.pin);
        if (!lobby) return socket.emit("destinationArticleError", "This game does not exist!");
        if (lobby.host !== socket.id) return socket.emit("destinationArticleError", "You are not the host of this game!");
        lobby.destinationArticle = data.article?.replaceAll(" ", "_") ?? null;
        io.to(data.pin).emit("destinationArticle", lobby.destinationArticle);
    });

    socket.on("language", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data.pin || !data.language) return socket.emit("languageError", "No pin or language provided!");
        const lobby = lobbys.get(data.pin);
        if (!lobby) return socket.emit("languageError", "This game does not exist!");
        if (lobby.host !== socket.id) return socket.emit("languageError", "You are not the host of this game!");
        lobby.language = data.language;
        io.to(data.pin).emit("language", lobby.language);
    });

    socket.on("start", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("startError", "No pin provided!");

        const lobby = lobbys.get(pin);
        if (!lobby) return socket.emit("startError", "This game does not exist!");
        if (lobby.host !== socket.id) return socket.emit("startError", "You are not the host of this game!");

        io.to(pin).emit("start", "/wiki/" + lobby.sourceArticle + "?lang=" + lobby.language + "&gameId=" + pin);


    });

    socket.on("score", (data) => {
        if (!socket.name) return socket.emit("noName");
        if (!data.gameId) return socket.emit("scoreError", "No gameId provided!");

        if (!data.clicks || !data.route) return socket.emit("scoreError", "No clicks or route provided!");

        const lobby = lobbys.get(data.gameId);
        if (!lobby) return socket.emit("scoreError", "This game does not exist!");

        if (!lobby.scores) lobby.scores = [];
        lobby.scores.push({
            id: socket.id,
            name: socket.name,
            clicks: data.clicks,
            route: data.route
        });

        io.to(data.gameId).emit("scores", lobby.scores);

        socket.emit("gotoScores", data.gameId);
    });

    socket.on("giveUp", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("giveUpError", "No pin provided!");

        const lobby = lobbys.get(pin);
        if (!lobby) return socket.emit("giveUpError", "This game does not exist!");
        if (lobby.host !== socket.id) return socket.emit("giveUpError", "You are not the host of this game!");
        if (!lobby.scores) lobby.scores = [];

        lobby.scores.push({
            id: socket.id,
            name: socket.name,
            clicks: "DNF",
            route: "DNF"
        });

        io.to(pin).emit("scores", lobby.scores);

        socket.emit("gotoScores", pin);
    });

    socket.on("scores", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("scoresError", "No pin provided!");

        const lobby = lobbys.get(pin);
        if (!lobby) return socket.emit("scoresError", "This game does not exist!");

        socket.emit("scores", lobby.scores || []);
    });

    socket.on("leave", (pin) => {
        if (!socket.name) return socket.emit("noName");
        if (!pin) return socket.emit("leaveError", "No pin provided!");

        const lobby = lobbys.get(pin);
        if (!lobby) return socket.emit("leaveError", "This game does not exist!");


        lobby.sockets.splice(lobby.sockets.indexOf(socket.id), 1);
        socket.leave(pin);

        io.to(pin).emit("users", getUsersInLobby(pin));

        if (lobby.sockets.length === 0) {
            lobbys.delete(pin);
        }
    });

    socket.on("newLobby", (pin) => {
        if (!pin) return socket.emit("newLobbyError", "No pin provided!");
        const lobby = lobbys.get(pin);

        if (!lobby) return socket.emit("newLobbyError", "This game does not exist!");

        //leave current lobby
        lobby.sockets.splice(lobby.sockets.indexOf(socket.id), 1);
        socket.leave(pin);
        io.to(pin).emit("users", getUsersInLobby(pin));

        if (lobby.sockets.length === 0) {
            lobbys.delete(pin);
        }

        if (lobby.newLobby) return socket.emit("newLobby", lobby.newLobby);

        const newLobby = generateGamePin();

        createLobby(newLobby);

        lobby.newLobby = newLobby;
        socket.emit("gameCreated", newLobby);


    });


});



server.listen(process.env.PORT || 3000, () => {
    console.log(`Server is listening on port ${process.env.PORT || 3000}`);
});