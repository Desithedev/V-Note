"""PhoVoice AI — Job Queue and Worker Manager.
Handles concurrent background transcription requests, job status polling,
and thread-safe inference execution using preloaded pipeline models.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import os
import queue
import threading
import time
import uuid
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger("phovoice.queue")

MAX_CONCURRENT_WORKERS = int(os.environ.get("PHOVOICE_MAX_WORKERS", "4"))
MAX_QUEUE_SIZE = int(os.environ.get("PHOVOICE_MAX_QUEUE", "100"))


class JobStatus:
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TranscriptionJob:
    def __init__(self, job_id: str, user_id: str, audio_bytes: bytes, options: Dict[str, Any]):
        self.job_id = job_id
        self.user_id = user_id
        self.audio_bytes = audio_bytes
        self.options = options
        self.status = JobStatus.QUEUED
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.created_at = time.time()
        self.started_at: Optional[float] = None
        self.completed_at: Optional[float] = None


class JobQueueManager:
    """Thread-safe Job Queue and Worker Pool."""

    def __init__(self, max_workers: int = MAX_CONCURRENT_WORKERS):
        self.max_workers = max_workers
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="PhoVoiceWorker")
        self._jobs: Dict[str, TranscriptionJob] = {}
        self._jobs_lock = threading.Lock()
        self._active_workers = 0
        self._active_workers_lock = threading.Lock()

    def submit_job(self, user_id: str, audio_bytes: bytes, options: Dict[str, Any]) -> str:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        job = TranscriptionJob(job_id=job_id, user_id=user_id, audio_bytes=audio_bytes, options=options)

        with self._jobs_lock:
            self._jobs[job_id] = job

        # Submit task to worker pool
        self._executor.submit(self._worker_execute, job)
        logger.info(f"[Queue] Job {job_id} submitted by user {user_id}. Queue size: {self.get_queue_length()}")
        return job_id

    def _worker_execute(self, job: TranscriptionJob):
        with self._active_workers_lock:
            self._active_workers += 1

        job.status = JobStatus.PROCESSING
        job.started_at = time.time()

        try:
            from core.pipeline import get_pipeline
            pipeline = get_pipeline()

            opts = job.options
            res = pipeline.transcribe(
                audio_source=job.audio_bytes,
                model=opts.get("model", "68M"),
                punctuate=opts.get("punctuate", True),
                normalize=opts.get("normalize", True),
                diarize=opts.get("diarize", False),
                timestamps=opts.get("timestamps", True),
            )
            res["id"] = job.job_id
            job.result = res
            job.status = JobStatus.COMPLETED
            logger.info(f"[Worker] Job {job.job_id} completed successfully in {time.time() - job.started_at:.2f}s")
        except Exception as exc:
            job.status = JobStatus.FAILED
            job.error = str(exc)
            logger.error(f"[Worker] Job {job.job_id} failed: {exc}", exc_info=True)
        finally:
            job.completed_at = time.time()
            # Release audio buffer from memory to preserve RAM/privacy
            job.audio_bytes = b""
            with self._active_workers_lock:
                self._active_workers -= 1

    def get_job(self, job_id: str) -> Optional[TranscriptionJob]:
        with self._jobs_lock:
            return self._jobs.get(job_id)

    def get_queue_length(self) -> int:
        with self._jobs_lock:
            return sum(1 for j in self._jobs.values() if j.status == JobStatus.QUEUED)

    def get_active_workers(self) -> int:
        with self._active_workers_lock:
            return self._active_workers

    def cleanup_old_jobs(self, max_age_seconds: float = 3600):
        """Purge jobs older than max_age_seconds."""
        now = time.time()
        with self._jobs_lock:
            expired = [jid for jid, j in self._jobs.items() if (j.completed_at and now - j.completed_at > max_age_seconds)]
            for jid in expired:
                del self._jobs[jid]


_queue_manager_instance: Optional[JobQueueManager] = None


def get_queue_manager() -> JobQueueManager:
    global _queue_manager_instance
    if _queue_manager_instance is None:
        _queue_manager_instance = JobQueueManager()
    return _queue_manager_instance
