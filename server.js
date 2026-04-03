const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });

const app = express();
const port = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_12345';

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const mixtralClient = new OpenAI({
    apiKey: (process.env.NVIDIA_API_KEY || '').trim(),
    baseURL: (process.env.NVIDIA_BASE_URL || '').trim()
});

const gemmaClient = new OpenAI({
    apiKey: (process.env.GEMMA_API_KEY || '').trim(),
    baseURL: (process.env.NVIDIA_BASE_URL || '').trim()
});

const MIXTRAL_MODEL = (process.env.MODEL_NAME || '').trim();
const GEMMA_MODEL = (process.env.GEMMA_MODEL_NAME || '').trim();

const translateClient = new OpenAI({
    apiKey: (process.env.TRANSLATE_API_KEY || '').trim(),
    baseURL: (process.env.NVIDIA_BASE_URL || '').trim()
});
const TRANSLATE_MODEL = (process.env.TRANSLATE_MODEL_NAME || 'baichuan-inc/baichuan2-13b-chat').trim();

// Document Analyzer Client
const analyzerClient = new OpenAI({
    apiKey: (process.env.ANALYZER_API_KEY || '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').trim(),
    baseURL: (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').trim()
});
const ANALYZER_MODEL = 'nvidia/mistral-nemo-minitron-8b-base';

// Helper to read users
const getUsers = () => {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
};

// Helper to save users
const saveUsers = (users) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

// Auth Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Access denied. Token missing.' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token.' });
        req.user = user;
        next();
    });
};

// Signup Endpoint
app.post('/api/signup', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const users = getUsers();
    if (users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'User already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword });
    saveUsers(users);

    res.status(201).json({ message: 'User created successfully.' });
});

// Login Endpoint
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const users = getUsers();
    const user = users.find(u => u.username === username);

    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, username: user.username });
});

app.post('/api/chat', authenticateToken, async (req, res) => {
    const { messages, model } = req.body;
    console.log(`Received chat request from ${req.user.username}:`, JSON.stringify(messages));

    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Keep only last 10 messages for speed (matching user's request for "fastest")
        const shortHistory = messages.slice(-10);

        let activeClient = mixtralClient;
        let activeModel = MIXTRAL_MODEL;

        if (model === 'gemma') {
            activeClient = gemmaClient;
            activeModel = GEMMA_MODEL;
        }

        console.log('Using model:', activeModel);
        const stream = await activeClient.chat.completions.create({
            model: activeModel,
            messages: shortHistory,
            temperature: 0.7,
            top_p: 0.7,
            max_tokens: 1024,
            stream: true,
        }).catch(err => {
            console.error('Initial API call failed:', err);
            throw err;
        });

        console.log('Stream started.');

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            const reasoning = delta.reasoning_content || '';
            const content = delta.content || '';

            if (reasoning || content) {
                const data = JSON.stringify({ reasoning, content });
                res.write(`data: ${data}\n\n`);
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
        console.log('Stream ended successfully.');
    } catch (error) {
        console.error('NVIDIA API Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// Translation Endpoint
app.post('/api/translate', authenticateToken, async (req, res) => {
    const { text, sourceLang, targetLang } = req.body;
    if (!text || !targetLang) {
        return res.status(400).json({ error: 'text and targetLang are required.' });
    }

    const src = sourceLang || 'English';
    console.log(`Translate request from ${req.user.username}: ${src} → ${targetLang}`);

    try {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const stream = await translateClient.chat.completions.create({
            model: TRANSLATE_MODEL,
            messages: [
                {
                    role: 'system',
                    content: `You are a professional translator. Translate the provided text from ${src} to ${targetLang} accurately. Output only the translated text, nothing else.`
                },
                {
                    role: 'user',
                    content: `Translate this to ${targetLang}:\n\n${text}`
                }
            ],
            temperature: 0.3,
            max_tokens: 1024,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        console.error('Translation Error:', error);
        res.status(500).json({ error: error.message || 'Translation failed' });
    }
});

// Analyzer Endpoint
app.post('/api/analyze', authenticateToken, upload.single('document'), async (req, res) => {
    try {
        let textContent = '';
        const promptQuery = req.body.prompt || 'Summarize this document.';

        if (req.file) {
            if (req.file.mimetype === 'application/pdf') {
                const pdfData = await pdfParse(req.file.buffer);
                textContent = pdfData.text;
            } else if (req.file.mimetype === 'text/plain') {
                textContent = req.file.buffer.toString('utf-8');
            } else {
                return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or TXT file.' });
            }
        } else if (req.body.text) {
            textContent = req.body.text; // Support raw text pasting
        } else {
            return res.status(400).json({ error: 'No document provided.' });
        }

        console.log(`Analyze request from ${req.user.username}`);

        // Truncate document text if it's exceedingly long to avoid token limits
        const truncatedDoc = textContent.substring(0, 15000); 

        const fullPrompt = `Document Content:\n${truncatedDoc}\n\nTask: ${promptQuery}\n\nAnalysis:\n`;

        const completion = await analyzerClient.completions.create({
            model: ANALYZER_MODEL,
            prompt: fullPrompt,
            max_tokens: 500,
            temperature: 0,
            top_p: 1.0
        });

        res.json({ result: completion.choices[0].text });

    } catch (error) {
        console.error('Analyzer Error:', error);
        res.status(500).json({ error: error.message || 'Analysis failed' });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
