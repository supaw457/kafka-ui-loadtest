const express = require('express');
const { Kafka } = require('kafkajs');
const { exec } = require('child_process');
const path = require('path');
const PORT = 3000;

const app = express();
const kafka = new Kafka({
    clientId: 'my-app',
    brokers: ['localhost:9092']
});

const producer = kafka.producer();

app.use(express.json());
app.use(express.static('public'));

const admin = kafka.admin();

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // ให้สามารถเข้าถึงจากทุกๆ ต้นทาง
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});


app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/topics', async (req, res) => {
    try {
        await admin.connect();
        const topics = await admin.listTopics();
        await admin.disconnect();
        res.json(topics);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/send', async (req, res) => {
    const { message, topic } = req.body;
    await producer.send({
        topic,
        messages: [{ value: message }],
    });
    console.log('Message sent to Kafka');
    res.send('Message sent to Kafka');
});

app.post('/send-message-loop', async (req, res) => {
    try {
        const { message, topic, count } = req.body;
        const messageString = JSON.stringify(message);

        for (let i = 0; i < count; i++) {
            await producer.send({
                topic,
                messages: [{ value: messageString }],
            });
        }

        return res.send('Message sent to Kafka');
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).send('Failed to send message to Kafka');
    }
});

app.post('/send-message-loop-v2', async (req, res) => {
    try {
        const { message, topic, count } = req.body;
        const messageString = JSON.stringify(message);

        await Promise.all(
            Array.from({ length: count }, () =>
                producer.send({
                    topic,
                    messages: [{ value: messageString }],
                })
            )
        );

        return res.send('Message sent to Kafka');
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).send('Failed to send message to Kafka');
    }
});

async function startKafkaProducer() {
    await producer.connect();
}

startKafkaProducer().catch(e => console.error(`Producer Error: ${e}`));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
