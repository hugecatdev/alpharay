import math
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import Request

from app.config import settings
from app.errors import ApiError


class RateLimiter:
    def __init__(self) -> None:
        self.hits: dict[tuple[str, str], deque[float]] = {}
        self.lock = threading.Lock()

    def hit(self, bucket: str, key: str, limit: int, window: float) -> float | None:
        now = time.monotonic()
        with self.lock:
            queue = self.hits.setdefault((bucket, key), deque())
            while queue and queue[0] <= now - window:
                queue.popleft()
            if len(queue) >= limit:
                return queue[0] + window - now
            queue.append(now)
            return None

    def reset(self) -> None:
        with self.lock:
            self.hits.clear()


limiter = RateLimiter()


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window: float = 60) -> Callable[[Request], None]:
    def dependency(request: Request) -> None:
        if not settings.rate_limit_enabled:
            return
        retry = limiter.hit(bucket, client_key(request), limit, window)
        if retry is None:
            return
        seconds = max(1, math.ceil(retry))
        raise ApiError(
            429,
            "RATE_LIMITED",
            f"Слишком много запросов — повторите через {seconds} с",
            headers={"Retry-After": str(seconds)},
        )

    return dependency
