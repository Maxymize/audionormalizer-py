const audioFilesInput = document.getElementById('audioFiles');
const fileListDiv = document.getElementById('fileList');
const normalizeButton = document.getElementById('normalizeButton'); 
const uploadProgressSection = document.getElementById('upload-progress-section');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');
const processingSection = document.getElementById('processing-section');
// Remove refs to processing progress bar elements as they are now CSS animated
// const processingProgressBar = document.getElementById('processingProgressBar'); 
// const processingProgressText = document.getElementById('processingProgressText'); 
const processingListDiv = document.getElementById('processingList');
const resultsSection = document.getElementById('results-section');
const resultsListDiv = document.getElementById('resultsList');
const downloadAllButton = document.getElementById('downloadAllButton');

let filesToProcess = [];
let currentJobId = null;

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
    processingSection.style.display = 'none';
    resultsSection.style.display = 'none';
    processingListDiv.innerHTML = '';
    resultsListDiv.innerHTML = '';
    downloadAllButton.style.display = 'none';
    currentJobId = null;
    console.log("Cleared previous state and file list.");

    newFiles.forEach(file => {
        console.log(`Checking file: ${file.name}, Type: ${file.type || 'N/A'}, Size: ${file.size}`);

        const isAllowedType = file.type && ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
        const isAllowedExtension = ALLOWED_EXTENSIONS.some(ext => 
            file.name.toLowerCase().endsWith(ext)
        );

        let skipReason = '';
        const isValidAudio = isAllowedType || isAllowedExtension;

        if (isValidAudio) {
            filesToProcess.push(file);
            console.log(`   -> Added file: ${file.name} (Type: ${file.type || 'N/A'}, Extension match: ${isAllowedExtension})`);
            filesAdded++;
        } else {
            skipReason += `Tipo non valido ('${file.type || 'N/A'}') o estensione.`;
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

// --- startNormalization (triggered by button click) --- 
function startNormalization() { 
    if (filesToProcess.length === 0) {
        console.warn("Normalize button clicked but no files to process.");
        return;
    }

    console.log(`Starting normalization process for ${filesToProcess.length} file(s).`);
    
    // Show and reset upload progress bar
    uploadProgressSection.style.display = 'block';
    uploadProgressBar.style.width = '0%';
    uploadProgressText.textContent = '0%';

    // Hide other sections initially
    processingSection.style.display = 'none'; 
    resultsSection.style.display = 'none';
    processingListDiv.innerHTML = '';
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
            console.log(`Upload progress: ${percentComplete}%`);
        }
    };

    // --- Upload Complete Event --- 
    xhr.onload = function() {
        console.log("Upload complete. Status:", xhr.status);
        
        // Hide upload progress bar and show processing section (with animated bar)
        uploadProgressSection.style.display = 'none';
        processingSection.style.display = 'block'; // Make sure processing section is visible NOW
                
        // Add files to the processing list UI
        processingListDiv.innerHTML = ''; 
        filesToProcess.forEach(file => addFileToProcessingList(file)); 

        if (xhr.status >= 200 && xhr.status < 300) {
            // Success
            let responseData;
            let responseText = xhr.responseText;
            console.log("Raw response text:", responseText);
            try {
                responseData = JSON.parse(responseText);
                console.log("Parsed JSON data:", responseData);

                if (!responseData || typeof responseData !== 'object' || !Array.isArray(responseData.results) || typeof responseData.job_id === 'undefined') {
                    console.error("Invalid JSON structure received:", responseData);
                    throw new Error("Risposta non valida dal server (struttura JSON errata).");
                }
                currentJobId = responseData.job_id;
                // Call displayResults AFTER server response
                // displayResults will handle hiding processing and showing results
                displayResults(responseData.results);

            } catch (error) {
                console.error('Error parsing JSON or invalid structure:', error);
                const displayError = error.message || "Errore nell'analisi della risposta del server.";
                const detailedError = responseText ? `${displayError}
--- Raw Server Response ---
${responseText}` : displayError;
                
                // Hide processing section and show error in results section
                processingSection.style.display = 'none';
                resultsSection.style.display = 'block';
                resultsListDiv.innerHTML = `<p style="color: red;">Errore: ${escapeHTML(displayError)}</p>`;
                alert(`Operazione fallita: ${detailedError}`); 
                resetUI(); 
            }
        } else {
            // Server error
            let errorMsg = `Errore Server: ${xhr.status} ${xhr.statusText}`;
            let responseText = xhr.responseText;
            try {
                const errorData = JSON.parse(responseText);
                console.error("Server error response (JSON):", errorData);
                errorMsg = errorData.error || JSON.stringify(errorData);
            } catch (jsonError) {
                console.error("Failed to parse server error response as JSON.");
                errorMsg = responseText || errorMsg;
            }
            console.error('Upload failed:', errorMsg);
            // Hide processing section and show error in results section
            processingSection.style.display = 'none';
            resultsSection.style.display = 'block';
            resultsListDiv.innerHTML = `<p style="color: red;">Errore Caricamento: ${escapeHTML(errorMsg)}</p>`;
            alert(`Caricamento fallito: ${errorMsg}`);
            resetUI(); 
        }
    };

    // --- Upload Error Event --- 
    xhr.onerror = function() {
        console.error('Network error during upload.');
        uploadProgressSection.style.display = 'none'; 
        // Hide processing section and show error in results section
        processingSection.style.display = 'none';
        resultsSection.style.display = 'block'; 
        resultsListDiv.innerHTML = '<p style="color: red;">Errore di rete durante il caricamento.</p>';
        alert("Errore di rete durante il caricamento dei file.");
        resetUI(); 
    };

    // --- Send the Request --- 
    xhr.open('POST', '/upload', true);
    console.log("Sending XHR /upload request...");
    xhr.send(formData);
}


function addFileToProcessingList(file) {
    const fileItem = document.createElement('div');
    fileItem.classList.add('file-item');
    const fileId = `processing-${file.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
    fileItem.id = fileId;
    fileItem.innerHTML = `
        <span>${escapeHTML(file.name)}</span>
        <span class="processing-status">In elaborazione... <div class="loading-animation"></div></span>`; // Show spinner immediately
    processingListDiv.appendChild(fileItem);
}

function updateProcessingStatus(originalName, status, details = '') {
    const fileId = `processing-${originalName.replace(/[^a-zA-Z0-9]/g, '-')}`;
    const item = document.getElementById(fileId);
    if (!item) {
        console.warn("Could not find processing item for:", originalName, "(ID searched:", fileId, ")");
        return;
    }
    const statusSpan = item.querySelector('.processing-status');
    if (!statusSpan) return;

    // Update status display based on result
    if (status === 'success') {
        statusSpan.innerHTML = '<span style="color: limegreen;">✔ Normalizzato</span>'; 
    } else if (status === 'error') {
        statusSpan.innerHTML = ''; 
        const errorSpan = document.createElement('span');
        errorSpan.style.color = 'red';
        const safeFullDetails = escapeHTML(details || ''); 
        errorSpan.title = safeFullDetails; 
        let basicErrorText = '✖ Errore'; 
        if (safeFullDetails) { 
             basicErrorText += `: ${safeFullDetails.substring(0, 30)}...`; 
        }
        errorSpan.textContent = basicErrorText;
        statusSpan.appendChild(errorSpan);
        console.error(`Error processing ${originalName}: ${details}`);
    } else {
        // Default/unknown status
        statusSpan.textContent = escapeHTML(status);
    }
}

// Modified displayResults to only show results when done
async function displayResults(results) {
    // Results list is initially hidden
    resultsSection.style.display = 'none'; 
    resultsListDiv.innerHTML = ''; // Clear previous results
    let hasSuccessfulFiles = false;

    if (!Array.isArray(results)) {
        console.error("displayResults called with non-array:", results);
        // Display error in processing section as results cannot be shown
        processingListDiv.innerHTML = '<p style="color: red;">Errore: Risposta del server non valida.</p>';
        resetUI();
        return;
    }
    
    // Process results one by one with delay - UPDATE STATUS IN PROCESSING LIST
    for (const result of results) {
        if (result && result.original_name) { 
            console.log(`Updating status in processing list for: ${result.original_name} to ${result.status}`);
            // Update the status in the VISIBLE processing list
            updateProcessingStatus(result.original_name, result.status, result.error || result.details || '');
            if (result.status === 'success') {
                hasSuccessfulFiles = true;
                // DON'T add to resultsListDiv yet, just prepare data if needed
            }
        } else {
            console.warn("Result item received without original_name:", result);
        }
        // Wait a short time before processing the next result status update
        await new Promise(resolve => setTimeout(resolve, 500)); // Reduced delay to 150ms
    } 

    // --- AFTER the loop finishes updating statuses --- 
    console.log("Finished updating statuses in processing list.");

    // Now, hide the processing section and show the final results section
    processingSection.style.display = 'none';
    resultsSection.style.display = 'block';

    // Populate the results list ONLY with successful files
    results.forEach(result => {
         if (result && result.status === 'success') {
             addResultToList(result);
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
        // If no successful files, show a message in the results section
        if (resultsListDiv.children.length === 0) {
             resultsListDiv.innerHTML = '<p style="color: #ccc;">Nessun file elaborato con successo.</p>';
        }
        downloadAllButton.style.display = 'none';
    }
    resetUI(); // Re-enable UI after processing is complete
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
