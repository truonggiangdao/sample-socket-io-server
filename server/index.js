const compression = require('compression');
const express = require("express");
const http = require("http");
const app = express();
var cors = require('cors')
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
    }
});

const local = false;


const users = {};

app.use(compression());

app.options('*', cors());
var indexFile = 'index.html',
  path = local ? '.' : '/home/site/wwwroot';

app.use('/', express.static(path, { index: indexFile }));
app.get('/', (req, res) => {
    res.sendFile(path + '/' + indexFile);
});

app.get('/check', (req, res) => {
    return res.send('Look ok!');
});

io.on("connection", socket => {
    console.log("Connected");

    socket.on("hello", payload => {
        console.log("Hello fired", payload);
        if (!users[payload.fromSessionId]) {
            users[payload.fromSessionId] = socket.id;
        }
        socket.join('users');
        socket.broadcast.to('users').emit('hello', payload);
    });

    socket.on("offer", payload => {
        if (users[payload.target]) {
            console.log("Offer fired", payload);
            socket.to(users[payload.target]).emit("offer", payload);
        }
    });

    socket.on("answer", payload => {
        if (users[payload.target]) {
            console.log("Answer fired", payload);
            socket.to(users[payload.target]).emit("answer", payload);
        }
    });

    socket.on("ice-candidate", incoming => {
        if (users[incoming.target]) {
            console.log("Ice candidate fired", incoming);
            socket.to(users[incoming.target]).emit("ice-candidate", incoming);
        }
    });
});

// Serve the website using Express
// server.listen(process.env.PORT);
server.listen(local ? 9999 : process.env.PORT);
