FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download TextBlob corpora for sentiment analysis
RUN python -m textblob.download_corpora 2>/dev/null || true

# Copy application code
COPY . .

# Persistent volume for SQLite DB will be mounted at /data
RUN mkdir -p /data

EXPOSE 8080

CMD ["python", "server.py"]
