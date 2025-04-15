const audioFilesInput = document.getElementById('audioFiles');
const fileListDiv = document.getElementById('fileList');
const normalizeButton = document.getElementById('normalizeButton'); 
const uploadProgressSection = document.getElementById('upload-progress-section');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');
const resultsSection = document.getElementById('results-section');
const resultsListDiv = document.getElementById('resultsList');
const downloadAllButton = document.getElementById('downloadAllButton');

let filesToProcess = [];
let currentJobId = null;
let simulationInterval = null; 
let simulatedProgress = 0;
let serverResponseReceived = false; // Flag to track if server has responded

// Define allowed MIME types and extensions
const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/mp3'];
const ALLOWED_EXTENSIONS = ['.mp3'];

audioFilesInput.addEventListener('change', handleFileSelect);
normalizeButton.addEventListener('click', startNormalization);

function handleFileSelect(event) {
    console.log("File selection changed.");
    const newFiles = Array.from(event.target.files);
    if (newFiles.length === 0) return; 
    
    filesToProcess = []; 
    uploadProgressSection.style.display = 'none';
    resultsSection.style.display = 'none';
    resultsListDiv.innerHTML = '';
    downloadAllButton.style.display = 'none';
    currentJobId = null;
    stopProgressSimulation(); 
    serverResponseReceived = false; // Reset flag
    console.log("Cleared previous state and file list.");

    newFiles.forEach(file => {
        const isAllowedType = file.type && ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
        const isAllowedExtension = ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));
        const isValidAudio = isAllowedType || isAllowedExtension;
        if (isValidAudio) {
            filesToProcess.push(file);
        } else {
            let skipReason = `Tipo non valido ('${file.type || 'N/A'}') o estensione.`;
            alert(`File saltato: ${file.name}
Motivo: ${skipReason}`);
        }
    });
    renderFileList();
    normalizeButton.disabled = filesToProcess.length === 0;
}

function renderFileList() {
    fileListDiv.innerHTML = '';
    if (filesToProcess.length === 0) {
        fileListDiv.innerHTML = '<p style="color: #ccc;">Nessun file MP3 valido selezionato...</p>';
    } 
    filesToProcess.forEach((file, index) => {
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
}

function handleDeleteFile(event) {
    const indexToRemove = parseInt(event.target.getAttribute('data-index'), 10);
    if (isNaN(indexToRemove)) return;
    filesToProcess.splice(indexToRemove, 1);
    renderFileList(); 
    normalizeButton.disabled = filesToProcess.length === 0;
}

function stopProgressSimulation() {
    if (simulationInterval) {
        clearInterval(simulationInterval);
        simulationInterval = null;
        console.log("Stopped progress simulation.");
    }
}

// --- startNormalization (unified progress with simulation) --- 
function startNormalization() { 
    if (filesToProcess.length === 0) return;

    console.log(`Starting upload & processing for ${filesToProcess.length} file(s).`);
    stopProgressSimulation(); 
    serverResponseReceived = false; // Reset flag
    
    // Show and reset progress bar (starts yellow)
    uploadProgressSection.style.display = 'block';
    uploadProgressBar.style.width = '0%';
    uploadProgressBar.classList.remove('simulating-processing'); 
    uploadProgressBar.style.transition = 'width 0.2s ease-out'; // Restore upload transition
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

    // --- Upload Progress Event --- 
    xhr.upload.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            uploadProgressBar.style.width = percentComplete + '%';
            uploadProgressText.textContent = percentComplete + '%';
        }
    };

    // --- Upload Finished Event (Success or Failure) --- 
    xhr.upload.onloadend = function(event) {
         console.log("XHR Upload phase finished (onloadend).");
         // Check if upload likely completed successfully before starting simulation
         // A simple check is if progress reached near 100%
         const currentProgress = parseFloat(uploadProgressBar.style.width) || 0;
         if (currentProgress >= 99 && !serverResponseReceived) { // Start simulation only if upload finished and server hasn't responded yet
             console.log("Upload appears complete, starting processing simulation.");
             uploadProgressSection.querySelector('h2').textContent = 'Elaborazione in corso...';
             uploadProgressBar.classList.add('simulating-processing'); // Switch to blue/striped
             uploadProgressBar.style.transition = 'none'; // Disable width transition during simulation
             simulatedProgress = 0; 
             uploadProgressBar.style.width = simulatedProgress + '%';
             uploadProgressText.textContent = `Elaborazione stimata... ${simulatedProgress.toFixed(0)}%`;

             const estimatedTimePerFile = 1500;
             const totalEstimatedTime = filesToProcess.length * estimatedTimePerFile;
             const simulationEndTime = Date.now() + totalEstimatedTime;
             const simulationTick = 100; 
             const totalTicks = Math.max(1, totalEstimatedTime / simulationTick); // Avoid division by zero
             const progressIncrement = 95 / totalTicks; 

             simulationInterval = setInterval(() => {
                 if (serverResponseReceived) { // Stop if server responded early
                      stopProgressSimulation();
                      return;
                 }
                 if (Date.now() < simulationEndTime && simulatedProgress < 95) {
                    simulatedProgress += progressIncrement;
                    simulatedProgress = Math.min(simulatedProgress, 95); 
                    uploadProgressBar.style.width = simulatedProgress + '%';
                    uploadProgressText.textContent = `Elaborazione stimata... ${simulatedProgress.toFixed(0)}%`;
                 } else if (simulatedProgress < 95) { 
                     // Time elapsed, but keep at 95% until server response
                     uploadProgressBar.style.width = '95%'; 
                     uploadProgressText.textContent = 'Elaborazione stimata... 95%';
                 }
             }, simulationTick);
         } else if (!serverResponseReceived) {
              // Handle cases where upload might have failed before onload fires
              console.warn("Upload did not seem to complete successfully before server response window.");
              // Maybe switch title? 
              uploadProgressSection.querySelector('h2').textContent = 'Attendendo Risposta Server...';
         }
    };

    // --- Server Response Received Event --- 
    xhr.onload = function() {
        console.log("Server response received (onload). Status:", xhr.status);
        serverResponseReceived = true; // Set flag
        stopProgressSimulation(); // Stop simulation
        
        // Set progress to 100% and change title
        uploadProgressBar.style.transition = 'width 0.3s ease-out'; // Restore smooth transition
        uploadProgressBar.style.width = '100%';
        uploadProgressBar.classList.remove('simulating-processing'); // Back to solid color (e.g., green for success?)
        uploadProgressBar.style.backgroundColor = 'limegreen'; // Indicate success completion
        uploadProgressSection.querySelector('h2').textContent = 'Completato';
        uploadProgressText.textContent = '100%';

        if (xhr.status >= 200 && xhr.status < 300) {
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
            let errorMsg = `Errore Server: ${xhr.status} ${xhr.statusText}`;
            let responseText = xhr.responseText;
            try { const errorData = JSON.parse(responseText); errorMsg = errorData.error || JSON.stringify(errorData); } catch (e) { }
            console.error('Request failed:', errorMsg);
            displayError(`Richiesta fallita: ${errorMsg}`, responseText);
        }
    };

    // --- Request Error Event --- 
    xhr.onerror = function() {
        console.error('Network error during request.');
        serverResponseReceived = true; // Set flag
        stopProgressSimulation();
        displayError("Errore di rete.");
    };
    
     // --- Upload Error Event --- 
    xhr.upload.onerror = function() {
         console.error("Network error specifically during upload phase.");
         serverResponseReceived = true; // Assume request ends
         stopProgressSimulation();
         displayError("Errore di rete durante l'upload.");
    };

    // --- Send the Request --- 
    xhr.open('POST', '/upload', true);
    console.log("Sending XHR /upload request...");
    xhr.send(formData);
}


function displayError(errorMessage, detailedError = null) {
    uploadProgressSection.style.display = 'block'; // Keep progress section visible
    uploadProgressBar.style.width = '100%';
    uploadProgressBar.classList.remove('simulating-processing');
    uploadProgressBar.style.backgroundColor = 'red'; // Red bar for error
    uploadProgressSection.querySelector('h2').textContent = 'Errore';
    uploadProgressText.textContent = 'Fallito';

    resultsSection.style.display = 'block'; // Show results section for details
    resultsListDiv.innerHTML = `<p style="color: red;">Errore: ${escapeHTML(errorMessage)}</p>`;
    if (detailedError) { alert(`Operazione fallita: ${errorMessage}
--- Dettagli ---
${detailedError}`); }
     else { alert(`Operazione fallita: ${errorMessage}`); }
    resetUI(); 
}


// Modified displayResults - only shows results after delay
function displayResults(results) {
    // Finalize progress bar appearance (already set to 100% green in onload)
    
    // Show results after a short delay to let user see the 100%
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
                     // Optionally add failed items to results list
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
    }, 800); // Increased delay before hiding progress and showing results
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
