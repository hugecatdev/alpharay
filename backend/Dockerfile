FROM python:3.13-slim@sha256:cf50a4f6ac4f026458b08d5222023d700ac806410dff5e9ca8728fa44f2b850f AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

FROM base AS requirements
RUN pip install poetry==2.5.1 poetry-plugin-export==1.10.1
COPY pyproject.toml poetry.lock ./
RUN poetry export --only main --format requirements.txt --output requirements.txt

FROM base
COPY --from=requirements /app/requirements.txt ./
RUN pip install --require-hashes -r requirements.txt \
    && useradd --system --uid 10001 --home-dir /app alpharay \
    && mkdir -p /data \
    && chown alpharay /data
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
ENV UPLOAD_DIR=/data/uploads
USER alpharay
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
