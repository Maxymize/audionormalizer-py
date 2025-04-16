const audioFilesInput = document.getElementById('audioFiles');
const fileListDiv = document.getElementById('fileList');
const normalizeButton = document.getElementById('normalizeButton'); 
const uploadProgressSection = document.getElementById('upload-progress-section');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');
const resultsSection = document.getElementById('results-section');
const resultsListDiv = document.getElementById('resultsList');
const downloadAllButton = document.getElementById('downloadAllButton');
const totalSizeInfo = document.getElementById('totalSizeInfo'); // Added

let filesToProcess = [];
let currentJobId = null;
let simulationInterval = null; 
let simulatedProgress = 0;
let serverResponseReceived = false; 

// --- Constants --- 
const MAX_UPLOAD_SIZE_BYTES = 31 * 1024 * 1024; // 31 MB limit (slightly less than 32MB)
const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/mp3'];
const ALLOWED_EXTENSIONS = ['.mp3'];

audioFilesInput.addEventListener('change', handleFileSelect);
normalizeButton.addEventListener('click', startNormalization);

function handleFileSelect(event) {
    console.log("File selection changed.");

    const newFiles = Array.from(event.target.files);
    let filesAdded = 0;
    
    if (newFiles.length === 0) return;
    
    // Reset state BUT keep existing filesToProcess for now
    uploadProgressSection.style.display = 'none';
    resultsSection.style.display = 'none';
    resultsListDiv.innerHTML = '';
    downloadAllButton.style.display = 'none';
    currentJobId = null;
    stopProgressSimulation(); 
    serverResponseReceived = false;
    console.log("Cleared results/progress state.");

    // Add newly selected files, checking for duplicates against the current list
    let newlySelectedFiles = [];
    newFiles.forEach(file => {
        console.log(`Checking file: ${file.name}, Type: ${file.type || 'N/A'}, Size: ${file.size}`);
        const isAllowedType = file.type && ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
        const isAllowedExtension = ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));
        const isValidAudio = isAllowedType || isAllowedExtension;
        const isDuplicate = filesToProcess.some(f => f.name === file.name);

        if (isValidAudio && !isDuplicate) {
            filesToProcess.push(file);
            newlySelectedFiles.push(file);
            console.log(`   -> Added file: ${file.name}`);
            filesAdded++;
        } else if (!isValidAudio) {
            let skipReason = `Tipo non valido ('${file.type || 'N/A'}') o estensione.`;
            alert(`File saltato: ${file.name}
Motivo: ${skipReason}`);
        } else if (isDuplicate) {
             console.warn(`File duplicato saltato: ${file.name}`);
        }
    });

    console.log(`Total files in processing list now: ${filesToProcess.length}`);
    renderFileList(); 
    console.log(`Normalize button disabled state: ${normalizeButton.disabled}`);
}

function renderFileList() {
    fileListDiv.innerHTML = '';
    let currentTotalSize = 0;

    if (filesToProcess.length === 0) {
        fileListDiv.innerHTML = '<p style="color: #ccc;">Nessun file MP3 valido selezionato...</p>';
        totalSizeInfo.textContent = '';
        normalizeButton.disabled = true;
    } else {
        filesToProcess.forEach((file, index) => {
            currentTotalSize += file.size;
            const fileItem = document.createElement('div');
            fileItem.classList.add('file-item');
            fileItem.id = `selected-file-${index}`;
            fileItem.innerHTML = `
                <span>${escapeHTML(file.name)} (${formatBytes(file.size)})</span>
                <div class="file-actions">
                    <button class="delete-button" data-index="${index}">Elimina</button>
                </div>
            `;
            fileListDiv.appendChild(fileItem);
        });
        fileListDiv.querySelectorAll('.delete-button').forEach(button => {
            button.addEventListener('click', handleDeleteFile);
        });

        const totalSizeFormatted = formatBytes(currentTotalSize);
        totalSizeInfo.textContent = `Dimensione Totale: ${totalSizeFormatted}`;
        if (currentTotalSize > MAX_UPLOAD_SIZE_BYTES) {
            totalSizeInfo.innerHTML += ` <strong style="color: red;">(Limite ${formatBytes(MAX_UPLOAD_SIZE_BYTES)} superato!)</strong>`;
            normalizeButton.disabled = true;
            normalizeButton.title = "La dimensione totale dei file supera il limite massimo consentito.";
        } else {
            normalizeButton.disabled = false;
            normalizeButton.title = "";
        }
    }
}

function handleDeleteFile(event) {
    const indexToRemove = parseInt(event.target.getAttribute('data-index'), 10);
    if (isNaN(indexToRemove)) return;
    filesToProcess.splice(indexToRemove, 1);
    renderFileList(); 
}

function stopProgressSimulation() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        console.log("Stopped progress simulation.");
    }
}

function startNormalization() { 
    if (filesToProcess.length === 0) return;

    let currentTotalSize = filesToProcess.reduce((sum, file) => sum + file.size, 0);
    if (currentTotalSize > MAX_UPLOAD_SIZE_BYTES) {
        alert(`Errore: La dimensione totale dei file (${formatBytes(currentTotalSize)}) supera il limite di ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}.
Si prega di ridurre il numero di file selezionati.`);
        return;
    }

    console.log(`Starting upload & processing for ${filesToProcess.length} file(s).`);
    stopProgressSimulation(); 
    serverResponseReceived = false;
    
    uploadProgressSection.style.display = 'block';
    uploadProgressBar.style.width = '0%';
    uploadProgressBar.classList.remove('simulating-processing'); 
    uploadProgressBar.style.transition = 'width 0.2s ease-out';
    uploadProgressBar.style.backgroundColor = '#FFFF00'; 
    uploadProgressText.textContent = '0%';
    uploadProgressSection.querySelector('h2').textContent = 'Upload in corso...'; 

    resultsSection.style.display = 'none';
    resultsListDiv.innerHTML = '';
    downloadAllButton.style.display = 'none';
    
    normalizeButton.disabled = true; 
    audioFilesInput.disabled = true;
    fileListDiv.querySelectorAll('.delete-button').forEach(b => b.disabled = true);

    const formData = new FormData();
    filesToProcess.forEach(file => formData.append('audioFiles', file, file.name));

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            uploadProgressBar.style.width = percentComplete + '%';
            uploadProgressText.textContent = percentComplete + '%';
        }
    };

    xhr.upload.onloadend = function(event) {
         console.log("XHR Upload phase finished (onloadend).");
         const currentProgress = parseFloat(uploadProgressBar.style.width) || 0;
         if (currentProgress >= 99 && !serverResponseReceived) { 
             console.log("Upload appears complete, starting processing simulation.");
             uploadProgressSection.querySelector('h2').textContent = 'Elaborazione in corso...';
             uploadProgressBar.classList.add('simulating-processing'); 
             uploadProgressBar.style.transition = 'none'; 
             simulatedProgress = 0; 
             uploadProgressBar.style.width = simulatedProgress + '%';
             uploadProgressText.textContent = `Elaborazione stimata... ${simulatedProgress.toFixed(0)}%`;
             const estimatedTimePerFile = 1500;
             const totalEstimatedTime = filesToProcess.length * estimatedTimePerFile;
             const simulationEndTime = Date.now() + totalEstimatedTime;
             const simulationTick = 100; 
             const totalTicks = Math.max(1, totalEstimatedTime / simulationTick);
             const progressIncrement = 95 / totalTicks; 
             simulationInterval = setInterval(() => {
                 if (serverResponseReceived) {
                      stopProgressSimulation();
                      return;
                 }
                 if (Date.now() < simulationEndTime && simulatedProgress < 95) {
                    simulatedProgress += progressIncrement;
                    simulatedProgress = Math.min(simulatedProgress, 95); 
                    uploadProgressBar.style.width = simulatedProgress + '%';
                    uploadProgressText.textContent = `Elaborazione stimata... ${simulatedProgress.toFixed(0)}%`;
                 } else if (simulatedProgress < 95) { 
                     uploadProgressBar.style.width = '95%'; 
                     uploadProgressText.textContent = 'Elaborazione stimata... 95%';
                 }
             }, simulationTick);
         } else if (!serverResponseReceived) {
              console.warn("Upload did not seem to complete successfully before server response window.");
              uploadProgressSection.querySelector('h2').textContent = 'Attendendo Risposta Server...';
         }
    };

    xhr.onload = function() {
        console.log("Server response received (onload). Status:", xhr.status);
        serverResponseReceived = true;
        stopProgressSimulation();
        
        uploadProgressBar.style.transition = 'width 0.3s ease-out'; 
        uploadProgressBar.style.width = '100%';
        uploadProgressBar.classList.remove('simulating-processing'); 
        
        if (xhr.status >= 200 && xhr.status < 300) {
            uploadProgressBar.style.backgroundColor = 'limegreen';
            uploadProgressSection.querySelector('h2').textContent = 'Completato';
            uploadProgressText.textContent = '100%';
            let responseData;
            let responseText = xhr.responseText;
            try {
                responseData = JSON.parse(responseText);
                if (!responseData || typeof responseData !== 'object' || !Array.isArray(responseData.results) || typeof responseData.job_id === 'undefined') {
                    throw new Error("Risposta non valida dal server.");
                }
                currentJobId = responseData.job_id;
                displayResults(responseData.results);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                displayError(error.message || "Errore analisi risposta.", responseText);
            }
        } else {
            uploadProgressBar.style.backgroundColor = 'red';
            uploadProgressSection.querySelector('h2').textContent = 'Errore';
            uploadProgressText.textContent = 'Fallito';
            let errorMsg = `Errore Server: ${xhr.status} ${xhr.statusText}`;
            let responseText = xhr.responseText;
            try { const errorData = JSON.parse(responseText); errorMsg = errorData.error || JSON.stringify(errorData); } catch (e) { }
            console.error('Request failed:', errorMsg);
            displayError(`Richiesta fallita: ${errorMsg}`, responseText);
        }
    };

    xhr.onerror = function() {
        console.error('Network error during request.');
        serverResponseReceived = true;
        stopProgressSimulation();
        displayError("Errore di rete.");
    };
    
    xhr.upload.onerror = function() {
         console.error("Network error specifically during upload phase.");
         serverResponseReceived = true;
         stopProgressSimulation();
         displayError("Errore di rete durante l'upload.");
    };

    xhr.open('POST', '/upload', true);
    console.log("Sending XHR /upload request...");
    xhr.send(formData);
}

function displayError(errorMessage, detailedError = null) {
    // Error state is already set on the progress bar section by onload/onerror
    resultsSection.style.display = 'block';
    resultsListDiv.innerHTML = `<p style="color: red;">Errore: ${escapeHTML(errorMessage)}</p>`;
    if (detailedError) { alert(`Operazione fallita: ${errorMessage}
--- Dettagli ---
${detailedError}`); }
     else { alert(`Operazione fallita: ${errorMessage}`); }
    resetUI(); 
}

function displayResults(results) {
    setTimeout(() => {
        uploadProgressSection.style.display = 'none'; 
        resultsSection.style.display = 'block'; 
        resultsListDiv.innerHTML = ''; 
        let hasSuccessfulFiles = false;
        if (!Array.isArray(results)) {
            resultsListDiv.innerHTML = '<p style="color: red;">Errore: Risposta server non valida.</p>';
        } else {
            results.forEach(result => {
                if (result && result.status === 'success') {
                    hasSuccessfulFiles = true;
                    addResultToList(result);
                } else if (result) {
                     console.warn(`File ${result.original_name || 'sconosciuto'} failed: ${result.error || result.details}`);
                }
            });
            if (hasSuccessfulFiles && currentJobId) {
                downloadAllButton.style.display = 'block';
                downloadAllButton.onclick = () => {
                    console.log("Download All clicked, job ID:", currentJobId);
                    window.location.href = `/download_zip/${currentJobId}`;
                };
            } else {
                if (resultsListDiv.children.length === 0) {
                     resultsListDiv.innerHTML = '<p style="color: #ccc;">Nessun file elaborato con successo.</p>';
                }
                downloadAllButton.style.display = 'none';
            }
        }
        resetUI(); 
    }, 800); 
}

function addResultToList(result) {
     const fileItem = document.createElement('div');
     fileItem.classList.add('file-item');
     const downloadUrl = `/download/${currentJobId}/${encodeURIComponent(result.processed_name)}`;
     fileItem.innerHTML = `
         <span>${escapeHTML(result.processed_name)}</span>
         <div class="file-actions">
             <a href="${downloadUrl}" download="${escapeHTML(result.processed_name)}" class="download-button">Download</a>
         </div>
     `;
     resultsListDiv.appendChild(fileItem);
}

function resetUI() {
    console.log("Resetting UI elements.");
    audioFilesInput.disabled = false; 
    normalizeButton.disabled = filesToProcess.length === 0; 
    fileListDiv.querySelectorAll('.delete-button').forEach(b => b.disabled = false);
    audioFilesInput.value = null; 
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const escapeHTMLMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
};
const escapeHTMLRegex = /[&<>"'/]/g;

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(escapeHTMLRegex, m => escapeHTMLMap[m]);
}
