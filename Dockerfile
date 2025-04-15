# 1. Usa un'immagine Python ufficiale come base
FROM python:3.11-slim

# 2. Imposta la directory di lavoro nell'immagine
WORKDIR /app

# 3. Installa FFmpeg (essenziale per la tua app)
# Aggiorna l'elenco dei pacchetti e installa ffmpeg e le sue dipendenze
# Pulisce le cache apt per ridurre la dimensione dell'immagine
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 4. Copia il file delle dipendenze Python
COPY requirements.txt .

# 5. Installa le dipendenze Python
# --no-cache-dir riduce la dimensione dell'immagine

RUN pip install --no-cache-dir -r requirements.txt

# 6. Copia tutto il codice sorgente dell'applicazione nella directory di lavoro
COPY . .

# 7. Imposta la variabile d'ambiente PORT richiesta da Cloud Run (o usa un default)
ENV PORT 8080

# 8. Esponi la porta su cui Gunicorn ascolterà
EXPOSE 8080

# 9. Esegui l'applicazione usando Gunicorn (server WSGI di produzione)
#    -w 4: numero di worker (puoi aggiustarlo)
#    --timeout 300: timeout per worker (aumentalo se le richieste sono lunghe, max 3600s = 60min per Cloud Run v2)
#    main:app : dice a Gunicorn di trovare l'oggetto 'app' nel file 'main.py'
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "4", "--timeout", "300", "main:app"]
