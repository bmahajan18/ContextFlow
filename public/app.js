// Talking Rabbitt - Frontend JavaScript
let chart = null;
let isConfigured = false;

// Configure API
async function configureAPI() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const provider = document.querySelector('input[name="provider"]:checked').value;
    
    if (!apiKey) {
        alert('Please enter an API key');
        return;
    }

    // Validate API key based on provider
    if (provider === 'openai' && !apiKey.startsWith('sk-')) {
        alert('Invalid OpenAI API key. Should start with "sk-"');
        return;
    }
    
    if (provider === 'gemini' && !apiKey.startsWith('AIzaSy')) {
        alert('Invalid Gemini API key. Should start with "AIzaSy"');
        return;
    }
    
    if (provider === 'groq' && !apiKey.startsWith('gsk_')) {
        alert('Invalid Groq API key. Should start with "gsk_"');
        return;
    }

    try {
        const response = await fetch('/api/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, provider })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server returned non-OK response:', response.status, errorText.substring(0, 500));
            alert('Server error (' + response.status + '). Please check Vercel function logs.');
            return;
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const errorText = await response.text();
            console.error('Server returned non-JSON response:', errorText.substring(0, 500));
            alert('Server returned unexpected response. Please check Vercel function logs.');
            return;
        }

        const result = await response.json();
        
        if (result.success) {
            isConfigured = true;
            document.getElementById('configSection').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            
            // Update footer to show current provider
            let providerName = 'Google Gemini';
            if (result.provider === 'openai') providerName = 'OpenAI';
            else if (result.provider === 'groq') providerName = 'Groq';
            
            document.querySelector('footer p:first-child').textContent = 
                `🤖 Talking Rabbitt | Powered by ${providerName}`;
            
            alert(`✅ ${result.message}`);
        } else {
            alert('Error: ' + result.error);
        }
    } catch (error) {
        alert('Error configuring API: ' + error.message);
    }
}

// Auto-configure with Gemini API key on load
async function autoConfigureGemini() {
    const apiKey = document.getElementById('apiKey').value.trim();
    
    if (!apiKey || !apiKey.startsWith('AIzaSy')) {
        return;
    }

    try {
        const response = await fetch('/api/configure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey })
        });

        const result = await response.json();
        
        if (result.success) {
            isConfigured = true;
            document.getElementById('configSection').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
        }
    } catch (error) {
        console.log('Auto-configure failed:', error.message);
    }
}

// Handle file upload
async function handleFileUpload() {
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    
    if (!file) return;

    // Show file name
    document.getElementById('fileName').textContent = file.name;

    // Create FormData and append the file
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (result.success) {
            displayDataInfo(result);
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
        const response = await fetch('/api/sample-data');
        const result = await response.json();
        
        if (result.success) {
            displayDataInfo(result);
        }
    } catch (error) {
        alert('Error loading sample data: ' + error.message);
    }
}

// Display data info
function displayDataInfo(result) {
    document.getElementById('dataInfo').style.display = 'block';
    document.getElementById('rowCount').textContent = result.rowCount;
    document.getElementById('colCount').textContent = result.columns.length;
    document.getElementById('columnsDisplay').textContent = result.columns.join(', ');
}

// Handle enter key
function handleKeyPress(event) {
    if (event.key === 'Enter') {
        askQuestion();
    }
}

// Set example question
function setQuestion(question) {
    document.getElementById('question').value = question;
}

// Ask question
async function askQuestion() {
    const question = document.getElementById('question').value.trim();
    
    if (!question) {
        alert('Please enter a question');
        return;
    }

    if (!isConfigured) {
        alert('Please configure your API key first');
        return;
    }

    const answerBox = document.getElementById('answer');
    answerBox.innerHTML = '<div class="loading"></div> Analyzing your data...';

    try {
        const response = await fetch('/api/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question })
        });

        const result = await response.json();
        
        if (result.error) {
            answerBox.innerHTML = `<p style="color: #ff6b6b;">Error: ${result.error}</p>`;
            return;
        }

        // Display answer
        answerBox.innerHTML = `<p>${result.answer}</p>`;

        // Handle visualization
        const chartContainer = document.getElementById('dataChart');
        const noChart = document.getElementById('noChart');
        
        if (result.visualization) {
            noChart.style.display = 'none';
            chartContainer.style.display = 'block';
            renderChart(result.visualization);
        } else {
            chartContainer.style.display = 'none';
            noChart.style.display = 'block';
        }

    } catch (error) {
        answerBox.innerHTML = `<p style="color: #ff6b6b;">Error: ${error.message}</p>`;
    }
}

// Render chart
function renderChart(chartData) {
    const ctx = document.getElementById('dataChart').getContext('2d');
    
    // Destroy existing chart
    if (chart) {
        chart.destroy();
    }

    const colors = [
        'rgba(233, 69, 96, 0.8)',
        'rgba(255, 107, 107, 0.8)',
        'rgba(78, 205, 196, 0.8)',
        'rgba(85, 98, 234, 0.8)',
        'rgba(255, 195, 113, 0.8)',
        'rgba(199, 125, 255, 0.8)'
    ];

    const borderColors = colors.map(c => c.replace('0.8', '1'));

    if (chartData.type === 'bar') {
        chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: chartData.title,
                    data: chartData.values,
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
                        labels: { color: '#fff' }
                    },
                    title: {
                        display: true,
                        text: chartData.title,
                        color: '#fff',
                        font: { size: 18 }
                    }
                },
                scales: {
                    y: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    } else if (chartData.type === 'line') {
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: chartData.title,
                    data: chartData.values,
                    borderColor: 'rgba(233, 69, 96, 1)',
                    backgroundColor: 'rgba(233, 69, 96, 0.2)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#fff' }
                    },
                    title: {
                        display: true,
                        text: chartData.title,
                        color: '#fff',
                        font: { size: 18 }
                    }
                },
                scales: {
                    y: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    } else if (chartData.type === 'pie') {
        chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: chartData.title,
                    data: chartData.values,
                    backgroundColor: colors,
                    borderColor: '#fff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#fff' }
                    },
                    title: {
                        display: true,
                        text: chartData.title,
                        color: '#fff',
                        font: { size: 18 }
                    }
                }
            }
        });
    } else if (chartData.type === 'table') {
        // Render as horizontal bar for table-like display
        chart = new Chart(ctx, {
            type: 'bar',
            indexAxis: 'y',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: chartData.title,
                    data: chartData.values,
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
                        labels: { color: '#fff' }
                    },
                    title: {
                        display: true,
                        text: chartData.title,
                        color: '#fff',
                        font: { size: 18 }
                    }
                },
                scales: {
                    y: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    },
                    x: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255,255,255,0.1)' }
                    }
                }
            }
        });
    }
}

// Check API health on load
window.onload = async function() {
    try {
        const response = await fetch('/api/health');
        const result = await response.json();
        console.log('API Status:', result.message);
    } catch (error) {
        console.log('API not ready yet');
    }
};

