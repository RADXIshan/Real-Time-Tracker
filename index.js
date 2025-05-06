const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public')); // Assuming files are in a 'public' folder
app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    res.render('index');
});

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('send-location', (data) => {
        socket.broadcast.emit('receive-location', data);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});