FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Production uses PostgreSQL, so processed CSV and raw source files are not
# included in the backend image.
COPY backend/api.py backend/database.py /app/backend/

EXPOSE 8001

CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8001"]
