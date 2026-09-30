// ContextFlow - Frontend JavaScript
let chart = null;
let isConfigured = false;
let currentSelectedFormat = 'auto';
let recognition = null;
let isListening = false;
let currentChatHistory = [];

/**
 * Helper to execute fetch requests safely without throwing unhandled 'Unexpected token' syntax errors
 */
async function safeFetchJson(url, options = {}) {
    let response;
    try {
        response = await fetch(url, options);
    } catch (networkErr) {
        throw new Error(`Network error: ${networkErr.message}`);
    }

    let rawText = '';
    try {
        rawText = await response.text();
    } catch (readErr) {
        throw new Error(`Error reading response body: ${readErr.message}`);
    }

    let jsonData = null;
    if (rawText && rawText.trim()) {
        try {
            jsonData = JSON.parse(rawText);
        } catch (jsonErr) {
            if (response.status === 413 || /too large|entity too large/i.test(rawText)) {
                throw new Error('File size limit exceeded (maximum 10MB allowed). Please upload a smaller file.');
            }
            if (!response.ok) {
                throw new Error(`Server error (${response.status}): ${rawText.substring(0, 150)}`);
            }
            throw new Error('Server returned invalid response. Expected JSON.');
        }
    }

    if (!response.ok) {
        const msg = (jsonData && jsonData.error) ? jsonData.error : `HTTP error ${response.status}`;
        throw new Error(msg);
    }

    return jsonData || { success: true };
}

// Select File Format tab/chip
function selectFormat(format, acceptFilter) {
    currentSelectedFormat = format;

    document.querySelectorAll('.format-chip').forEach(chip => chip.classList.remove('active'));
    const selectedChip = document.querySelector(`input[name="formatCategory"][value="${format}"]`);
    if (selectedChip) {
        const parentLabel = selectedChip.closest('.format-chip');
        if (parentLabel) parentLabel.classList.add('active');
        selectedChip.checked = true;
    }

    const fileInput = document.getElementById('uploadFile');
    const uploadBtnLabel = document.getElementById('uploadBtnLabel');
    if (fileInput) {
        fileInput.accept = acceptFilter || '*/*';
    }

    const labelsMap = {
        'auto': '📁 Choose File or Drag & Drop Here',
        'csv': '📊 Choose CSV / Excel File',
        'pdf': '📄 Choose PDF Document',
        'word': '📝 Choose Word Document',
        'slides': '📽️ Choose Presentation / Slides',
        'iwork': '🍎 Choose Pages / Keynote / Numbers',
        'image': '🖼️ Choose Image / HEIC File',
        'text': '📄 Choose Text / Code File'
    };

    if (uploadBtnLabel) {
        uploadBtnLabel.innerHTML = labelsMap[format] || '📁 Choose File';
    }

    updateExampleQuestions(format);
}

// Update example questions based on selected format
function updateExampleQuestions(format, customQuestions = null) {
    const exampleContainer = document.getElementById('exampleQuestions');
    if (!exampleContainer) return;

    if (customQuestions && customQuestions.length > 0) {
        let html = '<p>Recommended questions:</p>';
        customQuestions.forEach(q => {
            html += `<span class="example" onclick="setQuestion('${q.replace(/'/g, "\\'")}')">${q}</span> `;
        });
        exampleContainer.innerHTML = html;
        return;
    }

    let examples = [];
    if (format === 'csv') {
        examples = [
            { text: 'Which region had the highest revenue?', prompt: 'Which region had the highest revenue?' },
            { text: 'Show revenue by product category', prompt: 'Show revenue by product category' },
            { text: 'What was the total units sold in Q2?', prompt: 'What was the total units sold in Q2?' }
        ];
    } else if (format === 'pdf' || format === 'word' || format === 'iwork' || format === 'text') {
        examples = [
            { text: 'Summarize the main key points', prompt: 'Summarize the main key points of this document' },
            { text: 'What are the key conclusions?', prompt: 'What are the key conclusions or takeaways in this file?' },
            { text: 'Extract key figures & metrics', prompt: 'Extract key figures, dates, and metrics from this document' }
        ];
    } else if (format === 'slides') {
        examples = [
            { text: 'Give a slide-by-slide summary', prompt: 'Give a slide-by-slide summary of this presentation' },
            { text: 'What are the main action items?', prompt: 'What are the main topics and action items presented?' },
            { text: 'Extract all data metrics', prompt: 'Extract all data metrics and key slides' }
        ];
    } else if (format === 'image') {
        examples = [
            { text: 'Describe what is in this image', prompt: 'Describe in detail what is shown in this image' },
            { text: 'Read all text in this image', prompt: 'Extract and read all text present in this image' },
            { text: 'Analyze diagram / chart data', prompt: 'Analyze the chart or diagram in this image and extract data' }
        ];
    } else {
        examples = [
            { text: 'Summarize main points', prompt: 'Summarize the main points of this file' },
            { text: 'Which item has highest value?', prompt: 'Which region or item has the highest value?' },
            { text: 'Extract key metrics', prompt: 'Extract all key metrics and insights' }
        ];
    }

    let html = '<p>Try asking:</p>';
    examples.forEach(item => {
        html += `<span class="example" onclick="setQuestion('${item.prompt.replace(/'/g, "\\'")}')">${item.text}</span> `;
    });
    exampleContainer.innerHTML = html;
}

// Configure API Provider
async function configureAPI() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const providerRadio = document.querySelector('input[name="provider"]:checked');
    const provider = providerRadio ? providerRadio.value : 'gemini';
    
    if (!apiKey) {
        alert('Please enter an API key');
        return;
    }

    if (provider === 'openai' && !apiKey.startsWith('sk-')) {
        alert('Invalid OpenAI API key. Should start with "sk-"');
        return;
    }
    
    if (provider === 'groq' && !apiKey.startsWith('gsk_')) {
        alert('Invalid Groq API key. Should start with "gsk_"');
        return;
    }

    try {
        const result = await safeFetchJson('/api/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, provider })
        });
        
        if (result.success) {
            isConfigured = true;
            
            localStorage.setItem('contextflow_apiKey', apiKey);
            localStorage.setItem('contextflow_provider', provider);
            
            document.getElementById('configSection').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            
            let providerName = 'Google Gemini';
            if (result.provider === 'openai') providerName = 'OpenAI';
            else if (result.provider === 'groq') providerName = 'Groq';
            
            document.querySelector('footer p:first-child').textContent = 
                `🤖 ContextFlow | Powered by ${providerName}`;
            
            alert(`✅ ${result.message}`);
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Error configuring API: ' + error.message);
    }
}

// Drag and Drop Handlers
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById('dropzone').classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const dropzone = document.getElementById('dropzone');
    dropzone.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
        const fileInput = document.getElementById('uploadFile');
        fileInput.files = files;
        handleFileUpload();
    }
}

// Handle file upload
async function handleFileUpload() {
    const fileInput = document.getElementById('uploadFile');
    const file = fileInput.files[0];
    
    if (!file) return;

    document.getElementById('fileName').textContent = file.name;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('format', currentSelectedFormat);

    try {
        const result = await safeFetchJson('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (result.success) {
            displayDataInfo(result);
            if (result.executiveSummary) {
                displayExecutiveSummary(result.executiveSummary);
            }
            currentChatHistory = [];
            renderChatTimeline();
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Error uploading file: ' + error.message);
    }
}

// Load sample data
async function loadSampleData() {
    if (!isConfigured) {
        alert('Please configure your API key first');
        return;
    }

    try {
        const result = await safeFetchJson('/api/sample-data');
        if (result.success) {
            displayDataInfo(result);
            if (result.executiveSummary) {
                displayExecutiveSummary(result.executiveSummary);
            }
            currentChatHistory = [];
            renderChatTimeline();
        }
    } catch (error) {
        alert('Error loading sample data: ' + error.message);
    }
}

// Display Executive Briefing Summary Card
function displayExecutiveSummary(execData) {
    const section = document.getElementById('executiveSummarySection');
    const container = document.getElementById('execSummaryContent');
    if (!section || !container || !execData) return;

    section.style.display = 'block';

    let formattedSummary = (execData.summary || '')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    let metricsHtml = '';
    if (execData.keyMetrics && execData.keyMetrics.length > 0) {
        metricsHtml = '<div class="exec-metrics-grid">';
        execData.keyMetrics.forEach(m => {
            metricsHtml += `<span class="metric-pill">📌 ${m}</span>`;
        });
        metricsHtml += '</div>';
    }

    container.innerHTML = `<p>${formattedSummary}</p>${metricsHtml}`;

    if (execData.suggestedQuestions) {
        updateExampleQuestions(currentSelectedFormat, execData.suggestedQuestions);
    }
}

// Display data info card for uploaded file
function displayDataInfo(result) {
    const dataInfo = document.getElementById('dataInfo');
    const dataInfoContent = document.getElementById('dataInfoContent');
    dataInfo.style.display = 'block';

    const fmtBadge = `<span class="data-badge">${(result.format || 'file').toUpperCase()}</span>`;

    if (result.fileType === 'tabular') {
        dataInfoContent.innerHTML = `
            <p>✅ ${fmtBadge} <strong>${result.fileName || 'Data File'}</strong> | <strong id="rowCount">${result.rowCount}</strong> rows loaded | <strong id="colCount">${(result.columns || []).length}</strong> columns</p>
            <p class="columns-list">Columns: <span id="columnsDisplay">${(result.columns || []).join(', ')}</span></p>
        `;
    } else if (result.fileType === 'document') {
        const words = result.wordCount ? `${result.wordCount.toLocaleString()} words` : 'Document Loaded';
        const pageInfo = result.metaInfo && result.metaInfo.pageCount ? ` | ${result.metaInfo.pageCount} Pages` : '';
        const slideInfo = result.metaInfo && result.metaInfo.slideCount ? ` | ${result.metaInfo.slideCount} Slides` : '';

        dataInfoContent.innerHTML = `
            <p>✅ ${fmtBadge} <strong>${result.fileName}</strong> | <strong>${words}</strong>${pageInfo}${slideInfo}</p>
            ${result.previewText ? `<div class="preview-text">Preview: "${result.previewText}..."</div>` : ''}
        `;
    } else if (result.fileType === 'image') {
        dataInfoContent.innerHTML = `
            <p>✅ ${fmtBadge} <strong>${result.fileName}</strong> | Image format: <strong>${result.imageMimeType || 'image'}</strong></p>
            <p class="columns-list">Multimodal vision analysis enabled for this image.</p>
        `;
    } else {
        dataInfoContent.innerHTML = `
            <p>✅ ${fmtBadge} <strong>${result.fileName || 'Uploaded File'}</strong> processed successfully.</p>
        `;
    }
}

// Voice Input (Speech-to-Text) Toggle
function toggleVoiceInput() {
    const voiceBtn = document.getElementById('voiceBtn');
    const questionInput = document.getElementById('question');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert('Voice input is not supported in this browser. Please try Chrome, Edge, or Safari.');
        return;
    }

    if (isListening) {
        if (recognition) recognition.stop();
        isListening = false;
        voiceBtn.classList.remove('listening');
        return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = function() {
        isListening = true;
        voiceBtn.classList.add('listening');
        questionInput.placeholder = 'Listening... Speak your question clearly';
    };

    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        questionInput.value = transcript;
        isListening = false;
        voiceBtn.classList.remove('listening');
        questionInput.placeholder = 'Ask anything about your file...';
    };

    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        isListening = false;
        voiceBtn.classList.remove('listening');
        questionInput.placeholder = 'Ask anything about your file...';
    };

    recognition.onend = function() {
        isListening = false;
        voiceBtn.classList.remove('listening');
        questionInput.placeholder = 'Ask anything about your file...';
    };

    recognition.start();
}

// Keyboard shortcuts
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
}

// Set question from examples
function setQuestion(questionText) {
    document.getElementById('question').value = questionText;
}

// Ask question & update Threaded Chat
async function askQuestion() {
    const questionInput = document.getElementById('question');
    const question = questionInput.value.trim();
    
    if (!question) {
        alert('Please enter a question');
        return;
    }

    if (!isConfigured) {
        alert('Please configure your API key first');
        return;
    }

    // Add user question to local chat timeline immediately
    currentChatHistory.push({ role: 'user', content: question });
    renderChatTimeline();
    questionInput.value = '';

    try {
        const result = await safeFetchJson('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });
        
        if (result.error) {
            currentChatHistory.push({ role: 'bot', content: `Error: ${result.error}` });
            renderChatTimeline();
            return;
        }

        // Add bot answer & visualization to timeline
        currentChatHistory.push({ 
            role: 'bot', 
            content: result.answer, 
            visualization: result.visualization 
        });
        renderChatTimeline();

        // Handle active chart visualization
        const chartContainer = document.getElementById('dataChart');
        const noChart = document.getElementById('noChart');
        
        if (result.visualization && result.visualization.type && result.visualization.labels && result.visualization.values) {
            noChart.style.display = 'none';
            chartContainer.style.display = 'block';
            renderChart(result.visualization);
        }

    } catch (error) {
        currentChatHistory.push({ role: 'bot', content: `Error: ${error.message}` });
        renderChatTimeline();
    }
}

// Render Threaded Chat Timeline
function renderChatTimeline() {
    const timeline = document.getElementById('chatTimeline');
    if (!timeline) return;

    if (currentChatHistory.length === 0) {
        timeline.innerHTML = `
            <div class="chat-message bot">
                <div class="avatar">🐰</div>
                <div class="bubble">Upload a file or load sample data to begin our conversation!</div>
            </div>
        `;
        return;
    }

    let html = '';
    currentChatHistory.forEach(msg => {
        if (msg.role === 'user') {
            html += `
                <div class="chat-message user">
                    <div class="avatar">👤</div>
                    <div class="bubble">${msg.content}</div>
                </div>
            `;
        } else {
            let formattedContent = (msg.content || '')
                .replace(/\n\n/g, '</p><p>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            html += `
                <div class="chat-message bot">
                    <div class="avatar">🐰</div>
                    <div class="bubble">
                        <p>${formattedContent}</p>
                        ${msg.visualization ? `<div class="hint" style="margin-top: 8px;">📊 Generated ${msg.visualization.type} chart: "${msg.visualization.title}"</div>` : ''}
                    </div>
                </div>
            `;
        }
    });

    timeline.innerHTML = html;
    timeline.scrollTop = timeline.scrollHeight;
}

// Clear Chat Timeline
async function clearChatHistory() {
    currentChatHistory = [];
    try {
        await safeFetchJson('/api/clear-history', { method: 'POST' });
    } catch (_) {}
    renderChatTimeline();
}

// Export Insight Report
function exportReport() {
    if (currentChatHistory.length === 0) {
        alert('No conversation history to export.');
        return;
    }

    let reportText = `# ContextFlow Executive Report\nGenerated: ${new Date().toLocaleString()}\n\n`;
    currentChatHistory.forEach(item => {
        if (item.role === 'user') {
            reportText += `### ❓ User Query: ${item.content}\n\n`;
        } else {
            reportText += `**🤖 ContextFlow Analysis:**\n${item.content}\n\n`;
            if (item.visualization) {
                reportText += `*Chart Generated:* ${item.visualization.title} (${item.visualization.type})\n\n`;
            }
        }
        reportText += `---\n\n`;
    });

    const blob = new Blob([reportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ContextFlow_Report_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

// Render chart using Chart.js
function renderChart(chartData) {
    const canvas = document.getElementById('dataChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (chart) {
        chart.destroy();
    }

    const colors = [
        'rgba(233, 69, 96, 0.85)',
        'rgba(255, 107, 107, 0.85)',
        'rgba(78, 205, 196, 0.85)',
        'rgba(85, 98, 234, 0.85)',
        'rgba(255, 195, 113, 0.85)',
        'rgba(199, 125, 255, 0.85)'
    ];

    const borderColors = colors.map(c => c.replace('0.85', '1'));
    const chartType = ['bar', 'line', 'pie'].includes(chartData.type) ? chartData.type : 'bar';

    const config = {
        type: chartType === 'pie' ? 'pie' : 'bar',
        data: {
            labels: chartData.labels || [],
            datasets: [{
                label: chartData.title || 'Data',
                data: chartData.values || [],
                backgroundColor: colors,
                borderColor: borderColors,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: { color: '#fff', font: { size: 13 } }
                },
                title: {
                    display: true,
                    text: chartData.title || 'Visualization',
                    color: '#fff',
                    font: { size: 18, weight: 'bold' }
                }
            },
            scales: chartType !== 'pie' ? {
                y: {
                    ticks: { color: '#cbd5e1' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: {
                    ticks: { color: '#cbd5e1' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            } : {}
        }
    };

    if (chartData.type === 'line') {
        config.type = 'line';
        config.data.datasets[0].fill = true;
        config.data.datasets[0].backgroundColor = 'rgba(233, 69, 96, 0.25)';
        config.data.datasets[0].borderColor = '#e94560';
        config.data.datasets[0].tension = 0.4;
    } else if (chartData.type === 'table') {
        config.type = 'bar';
        config.options.indexAxis = 'y';
    }

    chart = new Chart(ctx, config);
}

// Check API health and auto-configure on load
window.onload = async function() {
    try {
        const response = await fetch('/api/health');
        if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const result = await response.json();
                console.log('API Status:', result.message);
            }
        }
    } catch (error) {
        console.log('API initial connection check:', error.message);
    }
    
    try {
        const result = await safeFetchJson('/api/provider');
        if (result && result.active) {
            isConfigured = true;
            document.getElementById('configSection').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            
            let providerName = 'Google Gemini';
            if (result.provider === 'openai') providerName = 'OpenAI';
            else if (result.provider === 'groq') providerName = 'Groq';
            
            document.querySelector('footer p:first-child').textContent = 
                `🤖 ContextFlow | Powered by ${providerName}`;
            return;
        }
    } catch (e) {
        console.log('Backend provider status check:', e.message);
    }

    const savedKey = localStorage.getItem('contextflow_apiKey');
    const savedProvider = localStorage.getItem('contextflow_provider') || 'gemini';
    
    if (savedKey) {
        document.getElementById('apiKey').value = savedKey;
        const providerRadio = document.querySelector(`input[name="provider"][value="${savedProvider}"]`);
        if (providerRadio) {
            providerRadio.checked = true;
        }
        
        try {
            const result = await safeFetchJson('/api/configure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: savedKey, provider: savedProvider })
            });

            if (result.success) {
                isConfigured = true;
                document.getElementById('configSection').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';
                
                let providerName = 'Google Gemini';
                if (result.provider === 'openai') providerName = 'OpenAI';
                else if (result.provider === 'groq') providerName = 'Groq';
                
                document.querySelector('footer p:first-child').textContent = 
                    `🤖 ContextFlow | Powered by ${providerName}`;
            }
        } catch (error) {
            console.log('Auto-configure with stored key failed:', error.message);
        }
    }
};
