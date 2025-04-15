const audioFilesInput = document.getElementById('audioFiles');
const fileListDiv = document.getElementById('fileList');
const normalizeButton = document.getElementById('normalizeButton'); 
const uploadProgressSection = document.getElementById('upload-progress-section');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');
// Remove processing section references
// const processingSection = document.getElementById('processing-section');
// const processingProgressBar = document.getElementById('processingProgressBar'); 
// const processingProgressText = document.getElementById('processingProgressText'); 
// const processingListDiv = document.getElementById('processingList');
const resultsSection = document.getElementById('results-section');
const resultsListDiv = document.getElementById('resultsList');
const downloadAllButton = document.getElementById('downloadAllButton');

let filesToProcess = [];
let currentJobId = null;
let simulationInterval = null; // To store the interval ID for simulation
let simulatedProgress = 0;

// Define allowed MIME types and extensions
const ALLOWED_MIME_TYPES = ['audio/mpeg', 'audio/mp3'];
const ALLOWED_EXTENSIONS = ['.mp3'];

audioFilesInput.addEventListener('change', handleFileSelect);
normalizeButton.addEventListener('click', startNormalization);

function handleFileSelect(event) {
    console.log("File selection changed.");

    const newFiles = Array.from(event.target.files);
    let filesAdded = 0;
    
    if (newFiles.length === 0) {
        console.log("No files selected in this event.");
        return; 
    }
    
    // Reset state when new files are selected
    filesToProcess = []; 
    uploadProgressSection.style.display = 'none';
    // processingSection.style.display = 'none';
    resultsSection.style.display = 'none';
    // processingListDiv.innerHTML = '';
    resultsListDiv.innerHTML = '';
    downloadAllButton.style.display = 'none';
    currentJobId = null;
    stopProgressSimulation(); // Stop any previous simulation
    console.log("Cleared previous state and file list.");

    newFiles.forEach(file => {
        console.log(`Checking file: ${file.name}, Type: ${file.type || 'N/A'}, Size: ${file.size}`);
        const isAllowedType = file.type && ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
        const isAllowedExtension = ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));
        const isValidAudio = isAllowedType || isAllowedExtension;

        if (isValidAudio) {
            filesToProcess.push(file);
            console.log(`   -> Added file: ${file.name}`);
            filesAdded++;
        } else {
            let skipReason = `Tipo non valido ('${file.type || 'N/A'}') o estensione.`;
            console.warn(`   -> File saltato: ${file.name}. Motivo: ${skipReason}`);
            alert(`File saltato: ${file.name}
Motivo: ${skipReason}`);
        }
    });

    console.log(`Total files in processing list now: ${filesToProcess.length}`);
    
    renderFileList();
    normalizeButton.disabled = filesToProcess.length === 0;
    console.log(`Normalize button disabled state: ${normalizeButton.disabled}`);
}

function renderFileList() {
    fileListDiv.innerHTML = '';
    if (filesToProcess.length === 0) {
        fileListDiv.innerHTML = '<p style="color: #ccc;">Nessun file MP3 valido selezionato. Si prega di scegliere uno o più file .mp3.</p>';
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
    if (isNaN(indexToRemove) || indexToRemove < 0 || indexToRemove >= filesToProcess.length) {
        console.error("Invalid index for file deletion:", indexToRemove);
        return;
    }
    const removedFile = filesToProcess.splice(indexToRemove, 1);
    console.log(`Removed file: ${removedFile[0]?.name || 'N/A'}`);
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

// --- startNormalization (unified progress) --- 
function startNormalization() { 
    if (filesToProcess.length === 0) {
        console.warn("Normalize button clicked but no files to process.");
        return;
    }

    console.log(`Starting upload & processing simulation for ${filesToProcess.length} file(s).`);
    stopProgressSimulation(); // Stop previous one if any
    
    // Show and reset unified progress bar (starts yellow)
    uploadProgressSection.style.display = 'block';
    uploadProgressBar.style.width = '0%';
    uploadProgressBar.classList.remove('simulating-processing'); // Ensure yellow
    uploadProgressText.textContent = '0%';
    uploadProgressSection.querySelector('h2').textContent = 'Upload in corso...'; // Set title

    // Hide results section
    resultsSection.style.display = 'none';
    resultsListDiv.innerHTML = '';
    downloadAllButton.style.display = 'none';
    
    // Disable UI elements
    normalizeButton.disabled = true; 
    audioFilesInput.disabled = true;
    fileListDiv.querySelectorAll('.delete-button').forEach(b => b.disabled = true);

    const formData = new FormData();
    filesToProcess.forEach(file => {
        formData.append('audioFiles', file, file.name);
    });

    const xhr = new XMLHttpRequest();

    // --- Upload Progress Event --- 
    xhr.upload.onprogress = function(event) {
        if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            uploadProgressBar.style.width = percentComplete + '%';
            uploadProgressText.textContent = percentComplete + '%';
        }
    };

    // --- Upload Complete Event --- 
    xhr.onload = function() {
        console.log("Upload complete. Status:", xhr.status);
        
        // --- Start Processing Simulation --- 
        uploadProgressSection.querySelector('h2').textContent = 'Elaborazione in corso...'; // Change title
        uploadProgressBar.classList.add('simulating-processing'); // Change bar to blue
        uploadProgressBar.style.transition = 'none'; // Disable transition for simulation
        simulatedProgress = 0; // Start simulation progress
        uploadProgressBar.style.width = simulatedProgress + '%';
        uploadProgressText.textContent = `Elaborazione stimata... ${simulatedProgress.toFixed(0)}%`;

        // Estimate processing time (e.g., 1.5 seconds per file, adjust as needed)
        const estimatedTimePerFile = 1500; // milliseconds
        const totalEstimatedTime = filesToProcess.length * estimatedTimePerFile;
        const simulationEndTime = Date.now() + totalEstimatedTime;
        const simulationTick = 100; // Update every 100ms
        const totalTicks = totalEstimatedTime / simulationTick;
        const progressIncrement = 95 / totalTicks; // Aim for 95% progress over estimated time
        
        console.log(`Starting simulation: ${totalEstimatedTime}ms estimated, increment ${progressIncrement.toFixed(2)}%`);

        simulationInterval = setInterval(() => {
             if (Date.now() < simulationEndTime && simulatedProgress < 95) {
                simulatedProgress += progressIncrement;
                simulatedProgress = Math.min(simulatedProgress, 95); // Cap at 95%
                uploadProgressBar.style.width = simulatedProgress + '%';
                uploadProgressText.textContent = `Elaborazione stimata... ${simulatedProgress.toFixed(0)}%`;
             } else {
                 // Don't stop interval here, wait for actual server response
                 // Keep bar at 95% until server responds
                 uploadProgressBar.style.width = '95%'; 
                 uploadProgressText.textContent = 'Elaborazione stimata... 95%';
                 // No need to clear interval here, xhr.onload will handle it
             }
        }, simulationTick);
        // --- End Processing Simulation --- 

        // --- Handle actual server response --- 
        if (xhr.status >= 200 && xhr.status < 300) {
            let responseData;
            let responseText = xhr.responseText;
            console.log("Raw response text:", responseText);
            try {
                stopProgressSimulation(); // Stop simulation now that we have a real response
                responseData = JSON.parse(responseText);
                console.log("Parsed JSON data:", responseData);
                if (!responseData || typeof responseData !== 'object' || !Array.isArray(responseData.results) || typeof responseData.job_id === 'undefined') {
                    throw new Error("Risposta non valida dal server (struttura JSON errata).");
                }
                currentJobId = responseData.job_id;
                displayResults(responseData.results);
            } catch (error) {
                stopProgressSimulation();
                console.error('Error parsing JSON or invalid structure:', error);
                displayError(error.message || "Errore nell'analisi della risposta del server.", responseText);
            }
        } else {
            stopProgressSimulation();
            let errorMsg = `Errore Server: ${xhr.status} ${xhr.statusText}`;
            let responseText = xhr.responseText;
            try { const errorData = JSON.parse(responseText); errorMsg = errorData.error || JSON.stringify(errorData); } catch (e) { }
            console.error('Upload failed:', errorMsg);
            displayError(`Caricamento fallito: ${errorMsg}`, responseText);
        }
    };

    // --- Upload Error Event --- 
    xhr.onerror = function() {
        stopProgressSimulation();
        console.error('Network error during upload.');
        displayError("Errore di rete durante il caricamento.");
    };

    // --- Send the Request --- 
    xhr.open('POST', '/upload', true);
    console.log("Sending XHR /upload request...");
    xhr.send(formData);
}

// Removed addFileToProcessingList
// Removed updateProcessingStatus

function displayError(errorMessage, detailedError = null) {
    uploadProgressSection.style.display = 'none'; // Hide progress bar
    resultsSection.style.display = 'block';
    resultsListDiv.innerHTML = `<p style="color: red;">Errore: ${escapeHTML(errorMessage)}</p>`;
    if (detailedError) {
         alert(`Operazione fallita: ${errorMessage}
--- Dettagli ---
${detailedError}`);
    }
     else {
         alert(`Operazione fallita: ${errorMessage}`);
     }
    resetUI(); // Re-enable UI after error
}


// Modified displayResults - simplified, only shows final results
function displayResults(results) {
    // Finalize progress bar 
    uploadProgressBar.style.width = '100%';
    uploadProgressBar.classList.remove('simulating-processing'); // Back to yellow? Or keep blue?
    uploadProgressBar.style.transition = 'width 0.3s ease'; // Restore transition
    uploadProgressSection.querySelector('h2').textContent = 'Completato';
    uploadProgressText.textContent = '100%';

    // Show results after a short delay
    setTimeout(() => {
        uploadProgressSection.style.display = 'none'; 
        resultsSection.style.display = 'block'; 
        resultsListDiv.innerHTML = ''; // Clear previous results
        let hasSuccessfulFiles = false;

        if (!Array.isArray(results)) {
            console.error("displayResults called with non-array:", results);
            resultsListDiv.innerHTML = '<p style="color: red;">Errore: Risposta del server non valida.</p>';
        } else {
             // Populate the results list ONLY with successful files
            results.forEach(result => {
                if (result && result.status === 'success') {
                    hasSuccessfulFiles = true;
                    addResultToList(result);
                } else if (result) {
                     console.warn(`File ${result.original_name || 'sconosciuto'} failed processing. Error: ${result.error || result.details}`);
                     // Optionally display failed files differently in the results
                     // addFailedResultToList(result);
                }
            });
            
             // Show download all button if there were successful files
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
        resetUI(); // Re-enable UI after results are displayed
    }, 500); // Delay before showing results
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
