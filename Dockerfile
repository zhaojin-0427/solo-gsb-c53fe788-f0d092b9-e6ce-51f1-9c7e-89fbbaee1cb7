FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv

COPY backend/requirements.txt /srv/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend /srv/backend
COPY frontend /srv/frontend

RUN mkdir -p /srv/backend/data

EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
