const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const modelSelect = document.getElementById('model-select');
const chatHistoryContainer = document.querySelector('.chat-history');

// File Upload Elements
const fileUpload = document.getElementById('file-upload');
const attachBtn = document.getElementById('attach-btn');
const filePreviewContainer = document.getElementById('file-preview-container');
const filePreviewName = document.getElementById('file-preview-name');
const removeFileBtn = document.getElementById('remove-file-btn');

let messageHistory = [];
let currentChatId = null;
let allChats = JSON.parse(localStorage.getItem('ai_chats') || '{}');

// ── Auth & User UI ──────────────────────────────────────
const loggedInUsername = localStorage.getItem('username') || 'User';

// Populate sidebar user display
const avatarEl = document.getElementById('user-avatar');
const nameEl   = document.getElementById('user-display-name');
if (avatarEl) avatarEl.innerText = loggedInUsername.substring(0, 2).toUpperCase();
if (nameEl)   nameEl.innerText   = loggedInUsername;

// Logout
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        window.location.href = 'auth.html';
    });
}

// Configure marked
marked.setOptions({
    highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
    },
    breaks: true
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = chatInput.scrollHeight + 'px';
    sendBtn.disabled = !chatInput.value.trim();
});

// Handle enter key
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

// Document Uploader Logic
if (attachBtn) {
    attachBtn.addEventListener('click', () => {
        fileUpload.click();
    });
}
if (fileUpload) {
    fileUpload.addEventListener('change', () => {
        if (fileUpload.files.length > 0) {
            filePreviewName.textContent = fileUpload.files[0].name;
            filePreviewContainer.style.display = 'flex';
        }
    });
}
if (removeFileBtn) {
    removeFileBtn.addEventListener('click', () => {
        fileUpload.value = '';
        filePreviewContainer.style.display = 'none';
        chatInput.focus();
    });
}

// Initialize
renderHistory();
startNewChat();

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    // Ensure we have a chat ID if this is the first message
    if (!currentChatId) {
        currentChatId = 'chat_' + Date.now();
        allChats[currentChatId] = {
            id: currentChatId,
            title: text.substring(0, 30) + (text.length > 30 ? '...' : ''),
            messages: [],
            model: modelSelect.value,
            timestamp: Date.now()
        };
    }

    // Reset UI
    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Clear welcome message if first chat
    const welcome = document.querySelector('.welcome');
    if (welcome) welcome.remove();

    // Add User Message
    addMessage('user', text);
    messageHistory.push({ role: 'user', content: text });

    // Add Assistant Message Placeholder
    const assistantMessage = addMessage('assistant', '');
    const messageContent = assistantMessage.querySelector('.message-content');
    
    // Create elements for streaming
    let reasoningBlock = null;
    const contentText = document.createElement('div');
    messageContent.appendChild(contentText);

    const isFileAttached = fileUpload && fileUpload.files && fileUpload.files.length > 0;

    let reasoningBuffer = '';
    let contentBuffer = '';

    try {
        if (isFileAttached) {
            // --- Document Analysis Logic ---
            contentText.innerHTML = '<span style="color:var(--text-secondary);font-style:italic;">Analyzing document...</span>';
            
            const formData = new FormData();
            formData.append('document', fileUpload.files[0]);
            formData.append('prompt', text); // Pass the user message as the prompt

            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: formData
            });

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                window.location.href = 'auth.html';
                return;
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to analyze document');
            }

            const data = await response.json();
            contentBuffer = data.result || 'Analysis completed, but no text was returned.';
            contentText.innerHTML = marked.parse(contentBuffer);
            contentText.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));

            // Clear file upload UI
            fileUpload.value = '';
            filePreviewContainer.style.display = 'none';

        } else {
            // --- Standard Chat Logic ---
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ 
                    messages: messageHistory,
                    model: modelSelect.value 
                })
            });

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem('token');
                localStorage.removeItem('username');
                window.location.href = 'auth.html';
                return;
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to connect to assistant');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep partial line in buffer

                for (const line of lines) {
                    const cleanedLine = line.trim();
                    if (cleanedLine.startsWith('data: ')) {
                        const dataStr = cleanedLine.slice(6);
                        if (dataStr === '[DONE]') break;

                        try {
                            const data = JSON.parse(dataStr);
                            
                            if (data.reasoning) {
                                if (!reasoningBlock) {
                                    reasoningBlock = document.createElement('div');
                                    reasoningBlock.className = 'reasoning-block';
                                    messageContent.insertBefore(reasoningBlock, contentText);
                                }
                                reasoningBuffer += data.reasoning;
                                reasoningBlock.textContent = reasoningBuffer;
                            }

                            if (data.content) {
                                contentBuffer += data.content;
                                contentText.innerHTML = marked.parse(contentBuffer);
                                // Highlight new code blocks
                                contentText.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
                            }

                            scrollToBottom();
                        } catch (e) {
                            console.warn('Partial or invalid JSON in SSE line:', dataStr);
                        }
                    }
                }
            }
        }

        // Add history and re-render
        messageHistory.push({ role: 'assistant', content: contentBuffer });
        saveCurrentChat();
        renderHistory();
        scrollToBottom();
    } catch (error) {
        console.error('Error:', error);
        contentText.innerHTML = '<p style="color: #ef4444;">Error: Failed to connect to server.</p>';
    }
}

function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `
        <div class="message-content">
            ${role === 'user' ? `<p>${escapeHTML(content)}</p>` : ''}
        </div>
    `;
    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

newChatBtn.addEventListener('click', () => {
    startNewChat();
});

function startNewChat() {
    messageHistory = [];
    currentChatId = null;
    chatMessages.innerHTML = `
        <div class="message assistant welcome">
            <div class="message-content">
                <h2 id="welcome-title">Welcome back, ${escapeHTML(loggedInUsername)}!</h2>
                <p>I'm your AI assistant powered by Mixtral. How can I help you today?</p>
                <div class="suggestions">
                    <button onclick="setInput('Write a python script for a simple web scraper')">Write a python script...</button>
                    <button onclick="setInput('Explain quantum entanglement in simple terms')">Explain quantum entanglement...</button>
                    <button onclick="setInput('Summarize the benefits of machine learning')">Summarize AI benefits...</button>
                </div>
            </div>
        </div>
    `;
    renderHistory();
    lucide.createIcons();
}

function saveCurrentChat() {
    if (!currentChatId) return;
    allChats[currentChatId].messages = messageHistory;
    allChats[currentChatId].model = modelSelect.value;
    allChats[currentChatId].timestamp = Date.now();
    localStorage.setItem('ai_chats', JSON.stringify(allChats));
}

function renderHistory() {
    chatHistoryContainer.innerHTML = '';
    const sortedChats = Object.values(allChats).sort((a, b) => b.timestamp - a.timestamp);

    sortedChats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
        item.innerHTML = `
            <i data-lucide="message-square"></i>
            <span class="history-item-title">${escapeHTML(chat.title)}</span>
            <i data-lucide="trash-2" class="delete-chat-btn" onclick="deleteChat(event, '${chat.id}')"></i>
        `;
        item.onclick = () => loadChat(chat.id);
        chatHistoryContainer.appendChild(item);
    });
    lucide.createIcons();
}

function loadChat(id) {
    if (id === currentChatId) return;
    const chat = allChats[id];
    if (!chat) return;

    currentChatId = id;
    messageHistory = [...chat.messages];
    modelSelect.value = chat.model || 'mixtral';
    
    // Clear display and render messages
    chatMessages.innerHTML = '';
    messageHistory.forEach(msg => {
        const msgDiv = addMessage(msg.role, msg.content);
        if (msg.role === 'assistant') {
            msgDiv.querySelector('.message-content').innerHTML = marked.parse(msg.content);
            msgDiv.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
        }
    });
    
    renderHistory();
    scrollToBottom();
}

window.deleteChat = function(event, id) {
    event.stopPropagation();
    if (confirm('Delete this chat?')) {
        delete allChats[id];
        localStorage.setItem('ai_chats', JSON.stringify(allChats));
        if (currentChatId === id) {
            startNewChat();
        } else {
            renderHistory();
        }
    }
};

modelSelect.addEventListener('change', () => {
    if (currentChatId) {
        allChats[currentChatId].model = modelSelect.value;
        saveCurrentChat();
    }
    const welcomeH2 = document.querySelector('.welcome h2');
    const welcomeP = document.querySelector('.welcome p');
    
    if (welcomeH2 && welcomeP) {
        if (modelSelect.value === 'gemma') {
            welcomeH2.textContent = 'Gemma 7B Code Gen';
            welcomeP.textContent = 'I am optimized for code generation and technical questions. How can I assist you?';
        } else {
            welcomeH2.textContent = 'Welcome back!';
            welcomeP.textContent = "I'm your AI assistant powered by Mixtral. How can I help you today?";
        }
    }
});
