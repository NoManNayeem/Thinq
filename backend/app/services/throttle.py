"""Failed-login throttling.

In-process and per worker. That is enough for a single backend container; a shared
store (Postgres or Redis) is needed before running several replicas.
"""

import time
from collections import defaultdict, deque


class LoginThrottle:
    def __init__(self, max_failures: int, window_s: int) -> None:
        self.max_failures = max_failures
        self.window_s = window_s
        self._failures: defaultdict[str, deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures[key]
        while attempts and now - attempts[0] > self.window_s:
            attempts.popleft()
        return attempts

    def retry_after(self, key: str, *, limit: int | None = None) -> int:
        """Seconds until another attempt is allowed, or 0 if allowed now."""
        now = time.monotonic()
        attempts = self._prune(key, now)
        if len(attempts) < (limit or self.max_failures):
            return 0
        return max(1, int(self.window_s - (now - attempts[0])) + 1)

    def fail(self, key: str) -> None:
        self._failures[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)
