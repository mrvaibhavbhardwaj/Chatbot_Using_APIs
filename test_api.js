const OpenAI = require('openai');
const dotenv = require('dotenv');
dotenv.config();

const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL
});

async function test() {
    console.log('Testing with model:', process.env.MODEL_NAME);
    try {
        const stream = await client.chat.completions.create({
            model: process.env.MODEL_NAME,
            messages: [{ role: 'user', content: 'Hello, what is your thinking process?' }],
            temperature: 1,
            top_p: 0.95,
            max_tokens: 200,
            extra_body: { "chat_template_kwargs": { "thinking": true } },
            stream: true,
        });

        console.log('Stream started. Receiving chunks...');
        for await (const chunk of stream) {
            process.stdout.write(chunk.choices[0]?.delta?.reasoning_content || '');
            process.stdout.write(chunk.choices[0]?.delta?.content || '');
        }
        console.log('\nStream completed.');
    } catch (error) {
        console.error('API Error Details:');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
        console.error('Type:', error.type);
        console.error('Data:', JSON.stringify(error.data, null, 2));
    }
}

test();
