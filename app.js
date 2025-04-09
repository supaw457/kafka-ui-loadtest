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
        let topics = await admin.listTopics();
        topics = removeStringsWithUnderscore(topics)
        topics.sort()
        await admin.disconnect();
        res.json(topics);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add this API endpoint for creating a new topic
app.post('/create-topic', async (req, res) => {
    try {
        const { topicName, numPartitions = 1, replicationFactor = 1 } = req.body;

        // Validate input
        if (!topicName) {
            return res.status(400).json({ error: 'Topic name is required' });
        }

        // Connect to Kafka admin
        await admin.connect();

        // Create the topic
        await admin.createTopics({
            topics: [{
                topic: topicName,
                numPartitions,
                replicationFactor
            }]
        });

        await admin.disconnect();
        res.status(201).json({ message: `Topic '${topicName}' created successfully` });
    } catch (error) {
        console.error('Error creating topic:', error);
        res.status(500).json({ error: error.message });
    }
});

// เพิ่ม API endpoint สำหรับลบ Topic
app.delete('/delete-topic', async (req, res) => {
    try {
        const { topicName } = req.body;

        // ตรวจสอบว่ามีการส่งชื่อ Topic มาหรือไม่
        if (!topicName) {
            return res.status(400).json({ error: 'Topic name is required' });
        }

        // เชื่อมต่อกับ Kafka admin
        await admin.connect();

        // ลบ Topic
        await admin.deleteTopics({
            topics: [topicName],
            timeout: 5000 // timeout 5 วินาที
        });

        await admin.disconnect();
        res.status(200).json({ message: `Topic '${topicName}' deleted successfully` });
    } catch (error) {
        console.error('Error deleting topic:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/send', async (req, res) => {
    const { message, topic } = req.body;
    await producer.send({
        topic,
        messages: [{ value: message }],
    });
    res.send('Message sent to Kafka');
});

// load test function
app.post('/send-message-loop', async (req, res) => {
    try {
        const { message, topic, count } = req.body;
        //console.log("req :", req)
        const messageString = JSON.stringify(message);
        await producer.send({
            topic,
            messages: [{ value: messageString }],
        });

        return res.send('Message sent to Kafka');
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).send('Failed to send message to Kafka');
    }
});

// load test function
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

// เพิ่ม API endpoint สำหรับตรวจสอบสถานะการเชื่อมต่อ
app.get('/health', async (req, res) => {
    try {
        const isConnected = await checkKafkaConnection();
        if (isConnected) {
            res.status(200).json({ status: 'ok', message: 'Connected to Kafka broker' });
        } else {
            res.status(503).json({ status: 'error', message: 'Failed to connect to Kafka broker' });
        }
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// เพิ่ม API endpoint สำหรับดูรายละเอียดของ Topic
app.get('/topic/:topicName', async (req, res) => {
    try {
        const { topicName } = req.params;
        
        if (!topicName) {
            return res.status(400).json({ error: 'Topic name is required' });
        }
        
        await admin.connect();
        
        // ดึงข้อมูล metadata ของ Topic
        const metadata = await admin.fetchTopicMetadata({ topics: [topicName] });
        
        if (!metadata.topics || metadata.topics.length === 0) {
            await admin.disconnect();
            return res.status(404).json({ error: `Topic '${topicName}' not found` });
        }
        
        const topicInfo = metadata.topics[0];
        
        // ดึงข้อมูล configuration ของ Topic
        const configs = await admin.describeConfigs({
            resources: [{
                type: 2, // Type 2 is for TOPIC
                name: topicName
            }]
        });
        
        await admin.disconnect();
        
        res.json({
            name: topicInfo.name,
            partitions: topicInfo.partitions,
            configs: configs.resources[0]?.configEntries || []
        });
    } catch (error) {
        console.error('Error fetching topic details:', error);
        res.status(500).json({ error: error.message });
    }
});

// เพิ่ม API endpoint สำหรับส่งข้อมูลพร้อม key
app.post('/send-with-key', async (req, res) => {
    try {
        const { message, topic, key } = req.body;
        
        // ตรวจสอบข้อมูลที่จำเป็น
        if (!message || !topic) {
            return res.status(400).json({ error: 'Message and topic are required' });
        }
        
        // แปลง message เป็น string ถ้ายังไม่ใช่
        const messageValue = typeof message === 'object' ? JSON.stringify(message) : message;
        const messageKey = key ? String(key) : null;
        
        // ส่งข้อมูลไปยัง Kafka พร้อม key
        await producer.send({
            topic,
            messages: [{ 
                key: messageKey,
                value: messageValue 
            }],
        });
        
        res.status(200).json({ 
            success: true,
            message: `Message sent to topic '${topic}'${messageKey ? ` with key '${messageKey}'` : ''}` 
        });
    } catch (error) {
        console.error('Error sending message with key:', error);
        res.status(500).json({ error: error.message });
    }
});

// เพิ่ม API endpoint สำหรับสร้าง Topic แบบกำหนด config เพิ่มเติมได้
app.post('/create-topic-advanced', async (req, res) => {
    try {
        const { 
            topicName, 
            numPartitions = 1, 
            replicationFactor = 1,
            configs = {} // เช่น { 'cleanup.policy': 'compact', 'retention.ms': '86400000' }
        } = req.body;

        // ตรวจสอบข้อมูลที่จำเป็น
        if (!topicName) {
            return res.status(400).json({ error: 'Topic name is required' });
        }

        // เชื่อมต่อกับ Kafka admin
        await admin.connect();

        // สร้าง Topic พร้อมกำหนด configs
        await admin.createTopics({
            topics: [{
                topic: topicName,
                numPartitions,
                replicationFactor,
                configEntries: Object.entries(configs).map(([name, value]) => ({ name, value }))
            }]
        });

        await admin.disconnect();
        res.status(201).json({ 
            message: `Topic '${topicName}' created successfully with custom configurations`,
            configs
        });
    } catch (error) {
        console.error('Error creating topic with custom configs:', error);
        res.status(500).json({ error: error.message });
    }
});

// ฟังก์ชันสำหรับตรวจสอบการเชื่อมต่อกับ Kafka
async function checkKafkaConnection() {
    try {
        // พยายามเชื่อมต่อกับ Kafka admin
        await admin.connect();
        // ลองเรียกใช้งาน API เพื่อตรวจสอบการเชื่อมต่อ
        await admin.listTopics();
        await admin.disconnect();
        return true;
    } catch (error) {
        console.error('Kafka connection check failed:', error);
        return false;
    }
}

function removeStringsWithUnderscore(obj) {
    if (Array.isArray(obj)) {
        return obj.map(removeStringsWithUnderscore).filter(v => v !== null);
    } else if (typeof obj === "object" && obj !== null) {
        return Object.fromEntries(
            Object.entries(obj)
                .map(([k, v]) => [k, removeStringsWithUnderscore(v)])
                .filter(([_, v]) => v !== null)
        );
    } else if (typeof obj === "string" && obj.includes("_")) {
        return null; // Remove string with '_'
    }
    return obj;
}

async function startKafkaProducer() {
    await producer.connect();
}

startKafkaProducer().catch(e => console.error(`Producer Error: ${e}`));

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});