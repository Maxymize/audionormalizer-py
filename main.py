# (Previous imports and config...)
import os
import subprocess
import uuid
import zipfile
import shutil
import logging
import re
import tempfile
import urllib.parse 
import base64 
import hashlib 
from io import BytesIO
from datetime import datetime, timedelta, timezone
from flask import Flask, request, jsonify, redirect
from werkzeug.utils import secure_filename # Still useful for job_id potentially
from google.cloud import storage
from google.cloud.storage import Blob
import google.auth.transport.requests
import google.oauth2.id_token
import google.auth

# --- Configuration ---
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME', None)
ALLOWED_EXTENSIONS = {'mp3'}
GCS_UPLOAD_PREFIX = 'uploads/'
GCS_PROCESSED_PREFIX = 'processed/'
GCS_TEMP_ZIP_PREFIX = 'temp_zips/'

app = Flask(__name__, static_folder='.', static_url_path='')

logging.basicConfig(level=logging.DEBUG)
app.logger.setLevel(logging.DEBUG)

storage_client = None
credentials = None

if GCS_BUCKET_NAME:
    try:
        credentials, project_id = google.auth.default()
        storage_client = storage.Client(credentials=credentials)
        app.logger.info(f"GCS client initialized for bucket: {GCS_BUCKET_NAME}")
        app.logger.info(f"Using credentials type: {type(credentials)}")
    except Exception as e:
        app.logger.exception(f"Failed to initialize Google Cloud Storage client: {e}. File operations will fail.")
        storage_client = None
else:
    app.logger.error("GCS_BUCKET_NAME environment variable not set. File operations will fail.")

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- Flask Routes ---
@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/style.css')
def styles():
     return app.send_static_file('style.css')

@app.route('/script.js')
def script():
     return app.send_static_file('script.js')

@app.route('/Scritta-Inforadio-Yellow-white_170x90-81b0c138.webp')
def logo():
    return app.send_static_file('Scritta-Inforadio-Yellow-white_170x90-81b0c138.webp')

@app.route('/upload', methods=['POST'])
def upload_files():
    app.logger.debug("Entered /upload endpoint (v2.0 - GCS - Public URLs)")
    if not storage_client or not GCS_BUCKET_NAME:
         app.logger.error("GCS not configured. Aborting upload.")
         return jsonify({'error': 'Server configuration error [GCS]'}), 500
    try:
        app.logger.debug(f"Request headers: {request.headers}")
        if 'audioFiles' not in request.files:
            app.logger.warning("'audioFiles' part missing in request files")
            return jsonify({'error': 'No file part in the request'}), 400
        files = request.files.getlist('audioFiles')
        app.logger.info(f"Received {len(files)} file(s)")
        if not files:
             app.logger.warning("Received file list is empty.")
             return jsonify({'results': [], 'job_id': str(uuid.uuid4())})
        results = []
        job_id = str(uuid.uuid4())
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        for i, file in enumerate(files):
            actual_original_filename = file.filename
            app.logger.debug(f"Processing file {i+1}/{len(files)}: Name='{actual_original_filename}', ContentType='{file.content_type}'")
            if not file or actual_original_filename == '':
                app.logger.warning(f"File {i+1} is invalid or has no filename.")
                continue
            if allowed_file(actual_original_filename):
                # Use original filename (potentially unsafe chars) for GCS upload path too
                # GCS client library handles necessary encoding for the upload itself.
                # Keep secured_filename only if needed for temp file paths, but maybe not.
                # Let's try using original filename directly for consistency.
                gcs_upload_blob_name = f"{GCS_UPLOAD_PREFIX}{job_id}/{actual_original_filename}"
                
                # +++ Generate processed name based on ORIGINAL filename +++
                name_part, extension = os.path.splitext(actual_original_filename)
                processed_filename_with_suffix = f"{name_part}_0db{extension}" # Changed suffix
                gcs_processed_blob_name = f"{GCS_PROCESSED_PREFIX}{job_id}/{processed_filename_with_suffix}"
                # +++ End Generate Name +++
                
                app.logger.debug(f"GCS Upload Path: gs://{GCS_BUCKET_NAME}/{gcs_upload_blob_name}")
                app.logger.debug(f"GCS Processed Path: gs://{GCS_BUCKET_NAME}/{gcs_processed_blob_name}")
                temp_input_path = None
                temp_output_path = None
                try:
                    blob = bucket.blob(gcs_upload_blob_name)
                    app.logger.info(f"Uploading {actual_original_filename} to GCS at {gcs_upload_blob_name}...")
                    file.seek(0)
                    blob.upload_from_file(file, content_type=file.content_type)
                    app.logger.info(f"Successfully uploaded {actual_original_filename} to GCS.")
                    # Use generic suffix for temp files, or include original name parts if needed for debugging
                    with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp_input_file, \
                         tempfile.NamedTemporaryFile(suffix=f"_processed{extension}", delete=False) as temp_output_file:
                        temp_input_path = temp_input_file.name
                        temp_output_path = temp_output_file.name
                        app.logger.debug(f"Downloading {gcs_upload_blob_name} to temporary file {temp_input_path}")
                        input_blob = bucket.blob(gcs_upload_blob_name)
                        input_blob.download_to_filename(temp_input_path)
                        app.logger.debug(f"Downloaded to {temp_input_path}")
                        detect_command = [ 'ffmpeg', '-i', temp_input_path, '-filter:a', 'volumedetect', '-f', 'null', '/dev/null' ]
                        app.logger.info(f"Running volume detection: {' '.join(detect_command)}")
                        detect_process = subprocess.run(detect_command, check=False, capture_output=True, text=True, timeout=120)
                        app.logger.debug("Volumedetect stderr output:")
                        app.logger.debug(detect_process.stderr)
                        max_volume_match = re.search(r"max_volume:\s*([-\d\.]+) dB", detect_process.stderr)
                        if max_volume_match:
                            max_volume_db = float(max_volume_match.group(1))
                            app.logger.info(f"Detected max volume: {max_volume_db} dB")
                            gain_db = 0.0 - max_volume_db
                            app.logger.info(f"Calculated gain: {gain_db:.2f} dB")
                            normalize_command = [
                                'ffmpeg',
                                '-y',
                                '-i', temp_input_path,
                                '-filter:a', f'volume={gain_db:.2f}dB',
                                '-map_metadata', '0',
                                '-acodec', 'libmp3lame',
                                '-b:a', '192k',
                                temp_output_path
                            ]
                            app.logger.info(f"Running normalization command: {' '.join(normalize_command)}")
                            normalize_process = subprocess.run(normalize_command, check=False, capture_output=True, text=True, timeout=300)
                            app.logger.debug(f"Normalization return code: {normalize_process.returncode}")
                            if normalize_process.returncode == 0:
                                app.logger.info(f"Normalization success for {actual_original_filename}. Uploading processed file as {processed_filename_with_suffix}...")
                                output_blob = bucket.blob(gcs_processed_blob_name)
                                output_blob.upload_from_filename(temp_output_path, content_type='audio/mpeg')
                                app.logger.info(f"Uploaded processed file to GCS at {gcs_processed_blob_name}")
                                try:
                                    # Set Content-Disposition using the filename with spaces + suffix
                                    output_blob.content_disposition = f'attachment; filename="{processed_filename_with_suffix}"' 
                                    output_blob.patch() 
                                    app.logger.info(f"Set Content-Disposition for {gcs_processed_blob_name}")
                                except Exception as meta_err:
                                     app.logger.error(f"Failed to set Content-Disposition for {gcs_processed_blob_name}: {meta_err}")
                                # Return the filename with spaces + suffix
                                results.append({
                                    'original_name': actual_original_filename, 
                                    'processed_name': processed_filename_with_suffix, 
                                    'status': 'success', 
                                    'job_id': job_id
                                })
                            else:
                                app.logger.error(f"Normalization Error (Code: {normalize_process.returncode}) for {actual_original_filename}")
                                app.logger.error("FFmpeg STDERR (Normalization):")
                                app.logger.error(normalize_process.stderr)
                                results.append({'original_name': actual_original_filename, 'status': 'error', 'error': f'FFmpeg normalization failed. Code: {normalize_process.returncode}', 'details': normalize_process.stderr[:500]})
                        else:
                            app.logger.error(f"Could not detect max_volume for {actual_original_filename}.")
                            app.logger.error("FFmpeg STDERR (volumedetect):")
                            app.logger.error(detect_process.stderr)
                            results.append({'original_name': actual_original_filename, 'status': 'error', 'error': 'Could not detect audio volume.', 'details': detect_process.stderr[:500] if detect_process.stderr else 'FFmpeg volumedetect failed.'})
                except subprocess.TimeoutExpired as e:
                    command_name = "Normalization" if 'normalize_command' in locals() else "Volume Detection"
                    app.logger.error(f"FFmpeg {command_name} timed out for {actual_original_filename}")
                    results.append({'original_name': actual_original_filename, 'status': 'error', 'error': f'FFmpeg {command_name} timed out'})
                except Exception as e:
                    app.logger.exception(f"Exception during GCS upload or FFmpeg processing for {actual_original_filename}: {e}")
                    results.append({'original_name': actual_original_filename, 'status': 'error', 'error': 'Server error during processing'})
                finally:
                     if temp_input_path and os.path.exists(temp_input_path):
                         try: os.remove(temp_input_path); app.logger.debug(f"Removed temp input file: {temp_input_path}")
                         except OSError as rm_err: app.logger.error(f"Error removing temp input file {temp_input_path}: {rm_err}")
                     if temp_output_path and os.path.exists(temp_output_path):
                         try: os.remove(temp_output_path); app.logger.debug(f"Removed temp output file: {temp_output_path}")
                         except OSError as rm_err: app.logger.error(f"Error removing temp output file {temp_output_path}: {rm_err}")
            else:
                app.logger.warning(f"File type not allowed: {actual_original_filename}")
                results.append({'original_name': actual_original_filename, 'status': 'error', 'error': 'File type not allowed'})
        app.logger.debug("Finished processing all files in the request.")
        app.logger.info(f"Sending results for job {job_id}: {results}")
        return jsonify({'results': results, 'job_id': job_id})
    except Exception as e:
        app.logger.exception(f"Unexpected error in /upload handler: {e}")
        return jsonify({'error': 'An unexpected server error occurred'}), 500

@app.route('/download/<job_id>/<filename>')
def download_file(job_id, filename):
    app.logger.info(f"Public download request for job {job_id}, file {filename}")
    if not storage_client or not GCS_BUCKET_NAME:
         app.logger.error("GCS not configured. Cannot process download.")
         return "Server configuration error [GCS]", 500
    # Secure job_id, but use filename directly as it comes from our result (with spaces and _0db)
    safe_job_id = secure_filename(job_id)
    requested_filename = filename 
    blob_name = f"{GCS_PROCESSED_PREFIX}{safe_job_id}/{requested_filename}"
    # URL encode the blob name for the public URL
    encoded_blob_name = urllib.parse.quote(blob_name)
    public_url = f"https://storage.googleapis.com/{GCS_BUCKET_NAME}/{encoded_blob_name}"
    app.logger.debug(f"Constructed public URL: {public_url}")
    try:
        bucket = storage_client.bucket(GCS_BUCKET_NAME)
        blob = bucket.blob(blob_name) # Use the unencoded name to check existence
        if blob.exists():
            app.logger.info(f"Redirecting to public URL: {public_url}")
            return redirect(public_url, code=302)
        else:
            app.logger.warning(f"Blob not found for public download: {blob_name}. Returning 404.")
            return "File not found.", 404
    except Exception as e:
        app.logger.exception(f"Error checking blob existence for {blob_name}: {e}")
        return "Server error checking file.", 500

@app.route('/download_zip/<job_id>')
def download_zip(job_id):
    # (Code remains the same)
    app.logger.info(f"Public Zip download request for job {job_id}")
    if not storage_client or not GCS_BUCKET_NAME:
         app.logger.error("GCS not configured. Cannot process zip download.")
         return "Server configuration error [GCS]", 500
    safe_job_id = secure_filename(job_id)
    with tempfile.TemporaryDirectory(prefix=f"zip_{safe_job_id}_") as temp_dir:
        app.logger.debug(f"Created temporary directory for zip: {temp_dir}")
        zip_filename = f"normalized_files_{safe_job_id}.zip"
        zip_path = os.path.join(temp_dir, zip_filename)
        files_added_to_zip = 0
        try:
            bucket = storage_client.bucket(GCS_BUCKET_NAME)
            processed_prefix = f"{GCS_PROCESSED_PREFIX}{safe_job_id}/"
            blobs = bucket.list_blobs(prefix=processed_prefix)
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for blob in blobs:
                    if blob.name == processed_prefix: continue
                    file_basename = os.path.basename(blob.name)
                    local_tmp_path = os.path.join(temp_dir, file_basename)
                    app.logger.debug(f"Downloading {blob.name} to {local_tmp_path} for zipping...")
                    blob.download_to_filename(local_tmp_path)
                    app.logger.debug(f"Adding {file_basename} to zip.")
                    zf.write(local_tmp_path, arcname=file_basename)
                    files_added_to_zip += 1
                    try: os.remove(local_tmp_path)
                    except OSError as rm_err: app.logger.warning(f"Could not remove temp file {local_tmp_path} after zipping: {rm_err}")
            if files_added_to_zip == 0:
                 app.logger.warning(f"No files found in GCS prefix {processed_prefix} to zip for job {safe_job_id}")
                 return "No processed files found for this job ID.", 404
            app.logger.info(f"Zip file created successfully at {zip_path} with {files_added_to_zip} files.")
            zip_blob_name = f"{GCS_TEMP_ZIP_PREFIX}{zip_filename}"
            app.logger.info(f"Uploading zip file to GCS: {zip_blob_name}")
            zip_blob = bucket.blob(zip_blob_name)
            zip_blob.upload_from_filename(zip_path, content_type='application/zip')
            try:
                zip_blob.content_disposition = f'attachment; filename="{zip_filename}"'
                zip_blob.patch()
                app.logger.info(f"Set Content-Disposition for {zip_blob_name}")
            except Exception as meta_err:
                app.logger.error(f"Failed to set Content-Disposition for {zip_blob_name}: {meta_err}")
            # Construct public URL for the zip file, ensuring encoding
            encoded_zip_blob_name = urllib.parse.quote(zip_blob_name)    
            public_zip_url = f"https://storage.googleapis.com/{GCS_BUCKET_NAME}/{encoded_zip_blob_name}"
            app.logger.info(f"Redirecting to public URL for zip download: {public_zip_url}")
            return redirect(public_zip_url, code=302)
        except Exception as e:
            app.logger.exception(f"Error creating or sending zip file for job {safe_job_id}: {e}")
            return "Error creating zip file", 500

if __name__ == '__main__':
    # (Startup logging...)
    app.logger.info("--- Starting Flask Server (v2.0 - GCS - Public URLs) ---")
    if not GCS_BUCKET_NAME:
         app.logger.critical("CRITICAL: GCS_BUCKET_NAME environment variable is not set. Application will not function correctly.")
    app.logger.info(f"Using GCS Bucket: {GCS_BUCKET_NAME}")
    app.logger.info(f"Python executable: {shutil.which('python')}")
    app.logger.info(f"Flask version: {Flask.__version__}")
    app.logger.info(f"Werkzeug version: {__import__('werkzeug').__version__}")
    app.logger.info(f"Google Cloud Storage Lib version: {storage.__version__}")
    app.logger.info(f"Google Auth Lib version: {google.auth.__version__}")
    app.logger.warning("Debug mode is ON. Disable for production.")
    # (FFmpeg check...)
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
    port = int(os.environ.get("PORT", 8080))
    app.logger.info(f"Attempting to run on host 0.0.0.0, port {port}")
    app.run(host='0.0.0.0', port=port, debug=True)
