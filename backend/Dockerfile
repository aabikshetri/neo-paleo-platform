FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Production uses PostgreSQL, so processed CSV and raw source files are not
# included in the backend image.
COPY backend /app/backend

EXPOSE 8001

CMD ["python", "-m", "backend.server"]
