import os
import subprocess
import uuid
import zipfile
import shutil
import logging
import re # Import re for regex parsing
from flask import Flask, request, jsonify, send_from_directory, send_file
from werkzeug.utils import secure_filename

# Configuration
UPLOAD_FOLDER = 'uploads'
PROCESSED_FOLDER = 'processed'
ALLOWED_EXTENSIONS = {'mp3'}

app = Flask(__name__, static_folder='.', static_url_path='')

# Set up logging
logging.basicConfig(level=logging.DEBUG)
app.logger.setLevel(logging.DEBUG)

# Create upload and processed directories if they don't exist
try:
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(PROCESSED_FOLDER, exist_ok=True)
    app.logger.info(f"Created/Ensured directories: {UPLOAD_FOLDER}, {PROCESSED_FOLDER}")
except OSError as e:
    app.logger.error(f"Error creating directories: {e}")

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    app.logger.debug(f"Serving index.html from: {os.path.abspath('.')}")
    return send_from_directory('.', 'index.html')

@app.route('/upload', methods=['POST'])
def upload_files():
    app.logger.debug("Entered /upload endpoint.")
    try:
        app.logger.debug(f"Request headers: {request.headers}")
        
        if 'audioFiles' not in request.files:
            app.logger.warning("'audioFiles' part missing in request files")
            return jsonify({'error': 'No file part in the request'}), 400

        files = request.files.getlist('audioFiles')
        app.logger.info(f"Received {len(files)} file(s)")
        if not files:
             app.logger.warning("Received file list is empty.")

        results = []
        job_id = str(uuid.uuid4())
        job_upload_dir = os.path.join(UPLOAD_FOLDER, job_id)
        job_processed_dir = os.path.join(PROCESSED_FOLDER, job_id)

        try:
            os.makedirs(job_upload_dir, exist_ok=True)
            os.makedirs(job_processed_dir, exist_ok=True)
            app.logger.info(f"Created job directories: {job_upload_dir}, {job_processed_dir}")
        except OSError as e:
            app.logger.error(f"Error creating job directories for job {job_id}: {e}")
            return jsonify({'error': 'Server error creating directories'}), 500

        for i, file in enumerate(files):
            app.logger.debug(f"Processing file {i+1}/{len(files)}: Name='{file.filename}', ContentType='{file.content_type}'")
            
            if not file or file.filename == '':
                app.logger.warning(f"File {i+1} is invalid or has no filename.")
                continue

            if allowed_file(file.filename):
                actual_original_filename = file.filename
                secured_filename = secure_filename(file.filename)
                upload_path = os.path.join(job_upload_dir, secured_filename)
                processed_path = os.path.join(job_processed_dir, secured_filename)
                app.logger.debug(f"Original Filename: {actual_original_filename}")
                app.logger.debug(f"Secured Filename: {secured_filename}")
                app.logger.debug(f"Upload path: {upload_path}")
                app.logger.debug(f"Processed path: {processed_path}")

                try:
                    app.logger.debug(f"Attempting to save {secured_filename} ({file.content_length} bytes) to {upload_path}")
                    file.save(upload_path)
                    app.logger.info(f"Saved {secured_filename} successfully.")

                    # --- Step 1: Detect Max Volume --- 
                    detect_command = [
                        'ffmpeg',
                        '-i', upload_path,
                        '-filter:a', 'volumedetect',
                        '-f', 'null',
                        '/dev/null' # Use /dev/null for Unix-like, NUL for Windows if needed
                    ]
                    app.logger.info(f"Running volume detection: {' '.join(detect_command)}")
                    detect_process = subprocess.run(detect_command, check=False, capture_output=True, text=True, timeout=120)
                    
                    # Log stderr from volumedetect for debugging (split into two lines)
                    app.logger.debug("Volumedetect stderr:") 
                    app.logger.debug(detect_process.stderr) # Log the stderr content directly

                    max_volume_match = re.search(r"max_volume:\s*([-\d\.]+) dB", detect_process.stderr)
                    
                    if max_volume_match:
                        max_volume_db = float(max_volume_match.group(1))
                        app.logger.info(f"Detected max volume: {max_volume_db} dB for {secured_filename}")
                        
                        # Calculate gain needed to reach 0dB peak
                        gain_db = 0.0 - max_volume_db 
                        # Avoid applying positive gain if already clipping (optional, safety)
                        # if max_volume_db > 0: gain_db = 0.0 
                        app.logger.info(f"Calculated gain: {gain_db:.2f} dB")

                        # --- Step 2: Apply Volume Gain --- 
                        normalize_command = [
                            'ffmpeg',
                            '-i', upload_path,
                            '-filter:a', f'volume={gain_db:.2f}dB', # Apply calculated gain
                            '-map_metadata', '0', # Preserve metadata
                            processed_path
                        ]
                        app.logger.info(f"Running normalization command: {' '.join(normalize_command)}")
                        normalize_process = subprocess.run(normalize_command, check=False, capture_output=True, text=True, timeout=300)
                        app.logger.debug(f"Normalization return code: {normalize_process.returncode}")
                        
                        if normalize_process.returncode == 0:
                            app.logger.info(f"Normalization success for {secured_filename} (Original: {actual_original_filename})")
                            results.append({
                                'original_name': actual_original_filename,
                                'processed_name': secured_filename,
                                'status': 'success',
                                'job_id': job_id
                            })
                        else:
                            app.logger.error(f"Normalization Error for {secured_filename} (Original: {actual_original_filename}) (Code: {normalize_process.returncode}):")
                            app.logger.error(normalize_process.stderr)
                            results.append({
                                'original_name': actual_original_filename,
                                'status': 'error',
                                'error': f'FFmpeg normalization failed. Code: {normalize_process.returncode}',
                                'details': normalize_process.stderr[:500]
                            })
                            # --- Corrected try...except block --- 
                            if os.path.exists(processed_path):
                                try: 
                                    os.remove(processed_path) 
                                except OSError as rm_err: 
                                    app.logger.error(f"Error removing failed normalized file {processed_path}: {rm_err}")
                    else:
                        # Error if max_volume not found
                        app.logger.error(f"Could not detect max_volume for {secured_filename}. FFmpeg stderr:")
                        app.logger.error(detect_process.stderr) # Log the stderr that failed parsing
                        results.append({
                            'original_name': actual_original_filename,
                            'status': 'error',
                            'error': 'Could not detect audio volume.',
                            'details': detect_process.stderr[:500] if detect_process.stderr else 'FFmpeg volumedetect failed to run or produced no output.'
                        })
                        # No processed file to remove here

                except subprocess.TimeoutExpired as e:
                    # Determine which command timed out based on context (less precise here)
                    command_name = "Normalization" if 'normalize_command' in locals() else "Volume Detection"
                    app.logger.error(f"FFmpeg {command_name} timed out for {secured_filename} (Original: {actual_original_filename})")
                    results.append({
                        'original_name': actual_original_filename,
                        'status': 'error',
                        'error': f'FFmpeg {command_name} timed out'
                    })
                    if os.path.exists(processed_path): 
                        try: os.remove(processed_path) 
                        except OSError as rm_err: app.logger.error(f"Error removing timed-out processed file {processed_path}: {rm_err}")
                except Exception as e:
                    app.logger.exception(f"Exception during save or FFmpeg processing for {secured_filename} (Original: {actual_original_filename}): {e}")
                    results.append({
                        'original_name': actual_original_filename,
                        'status': 'error',
                        'error': f'Server error during processing'
                    })
                    if os.path.exists(processed_path): 
                        try: os.remove(processed_path) 
                        except OSError as rm_err: app.logger.error(f"Error removing error-processed file {processed_path}: {rm_err}")
            else: # File type not allowed
                app.logger.warning(f"File type not allowed or file missing for: {file.filename}")
                results.append({
                    'original_name': file.filename,
                    'status': 'error',
                    'error': 'File type not allowed'
                })
        
        app.logger.debug("Finished processing all files in the request.")
        app.logger.info(f"Sending results for job {job_id}: {results}")
        return jsonify({'results': results, 'job_id': job_id})

    except Exception as e:
        app.logger.exception(f"Unexpected error in /upload handler: {e}")
        return jsonify({'error': 'An unexpected server error occurred'}), 500

# ... (download_file and download_zip remain the same) ...

@app.route('/download/<job_id>/<filename>')
def download_file(job_id, filename):
    app.logger.info(f"Download request for job {job_id}, file {filename}")
    safe_job_id = secure_filename(job_id)
    safe_filename = secure_filename(filename)
    directory = os.path.join(PROCESSED_FOLDER, safe_job_id)

    if not os.path.isdir(directory) or not os.path.exists(os.path.join(directory, safe_filename)):
         app.logger.warning(f"Download failed: File not found or invalid job ID. Path checked: {os.path.join(directory, safe_filename)}")
         return "File not found or invalid job ID.", 404

    try:
        app.logger.debug(f"Sending file: {safe_filename} from {directory}")
        return send_from_directory(directory, safe_filename, as_attachment=True)
    except FileNotFoundError:
        app.logger.error(f"Download failed: FileNotFoundError despite earlier check for {os.path.join(directory, safe_filename)}")
        return "File not found.", 404
    except Exception as e:
        app.logger.exception(f"Error sending file {safe_filename} for job {safe_job_id}: {e}")
        return "Server error during download.", 500

@app.route('/download_zip/<job_id>')
def download_zip(job_id):
    app.logger.info(f"Zip download request for job {job_id}")
    safe_job_id = secure_filename(job_id)
    directory = os.path.join(PROCESSED_FOLDER, safe_job_id)
    temp_zip_dir = os.path.join(PROCESSED_FOLDER, f"temp_zip_{safe_job_id}")
    zip_filename = f"normalized_files_{safe_job_id}.zip"
    zip_path = os.path.join(temp_zip_dir, zip_filename)

    if not os.path.isdir(directory):
         app.logger.warning(f"Zip download failed: Job ID directory not found: {directory}")
         return "Job ID not found.", 404

    try:
        app.logger.debug(f"Creating zip file at: {zip_path}")
        os.makedirs(temp_zip_dir, exist_ok=True)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for filename in os.listdir(directory):
                file_path = os.path.join(directory, filename)
                if os.path.isfile(file_path):
                    app.logger.debug(f"Adding to zip: {filename}")
                    zf.write(file_path, arcname=filename)
                else:
                    app.logger.warning(f"Skipping non-file item in zip: {filename}")

        app.logger.info(f"Zip file created successfully: {zip_path}")
        return send_file(zip_path, as_attachment=True, download_name=zip_filename)

    except FileNotFoundError:
         app.logger.error(f"Error creating zip file for job {safe_job_id}: Source files not found in {directory}")
         return "Error creating zip file: Source files not found.", 404
    except Exception as e:
        app.logger.exception(f"Error creating or sending zip file for job {safe_job_id}: {e}") 
        return f"Error creating zip file", 500
    finally:
        if os.path.exists(temp_zip_dir):
            try:
                app.logger.debug(f"Cleaning up zip temp directory: {temp_zip_dir}")
                shutil.rmtree(temp_zip_dir)
                app.logger.info(f"Successfully cleaned up temp zip directory: {temp_zip_dir}")
            except Exception as error:
                app.logger.error(f"Error removing temporary zip directory {temp_zip_dir}: {error}")

if __name__ == '__main__':
    app.logger.info("--- Starting Flask Server ---")
    app.logger.info(f"Python executable: {shutil.which('python')}")
    app.logger.info(f"Flask version: {Flask.__version__}") 
    app.logger.info(f"Werkzeug version: {__import__('werkzeug').__version__}")
    app.logger.info(f"Uploads folder: {os.path.abspath(UPLOAD_FOLDER)}")
    app.logger.info(f"Processed folder: {os.path.abspath(PROCESSED_FOLDER)}")
    app.logger.warning("Debug mode is ON. Disable for production.")
    app.logger.warning("File cleanup for uploads/processed folders is currently manual.")

    try:
        ffmpeg_path = shutil.which('ffmpeg')
        if ffmpeg_path:
            app.logger.info(f"FFmpeg found at: {ffmpeg_path}")
            result = subprocess.run([ffmpeg_path, '-version'], capture_output=True, text=True, check=True, timeout=5)
            app.logger.info("FFmpeg version check successful.")
        else:
            app.logger.error("FFmpeg command not found in PATH.")
    except Exception as e:
        app.logger.exception(f"An unexpected error occurred during FFmpeg check: {e}")

    port = int(os.environ.get("PORT", 5000))
    app.logger.info(f"Attempting to run on host 0.0.0.0, port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
