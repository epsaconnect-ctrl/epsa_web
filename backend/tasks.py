from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

try:
    from .config import get_settings
except ImportError:
    from config import get_settings


@lru_cache(maxsize=1)
def _executor():
    settings = get_settings()
    return ThreadPoolExecutor(
        max_workers=settings.biometric_workers,
        thread_name_prefix="epsa-biometric",
    )


def run_biometric_task(func, *args, **kwargs):
    settings = get_settings()
    future = _executor().submit(func, *args, **kwargs)
    return future.result(timeout=settings.biometric_timeout_seconds)
