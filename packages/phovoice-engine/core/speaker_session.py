"""PhoVoice AI — Speaker Diarization Session State & Cross-Chunk Consistency Manager.
Manages online speaker embedding centroids, recent embedding sliding window,
candidate speaker promotion, and cluster reconciliation across sequential audio chunks.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("phovoice.speaker_session")

# Hysteresis Thresholds (Calibrated for normalized 24-dim filterbank/spectral features)
T_SAME_SPEAKER = 0.60       # High confidence: match existing speaker and update centroid
T_UNCERTAIN_SPEAKER = 0.50  # Uncertain region: reuse closest existing speaker without updating centroid
T_MERGE_CLUSTERS = 0.72     # Threshold for reconciling/merging similar clusters
MIN_EMBEDDING_DURATION = 0.8 # Seconds: Ignore segments shorter than this for new speaker creation
CANDIDATE_PROMOTION_DURATION = 2.0 # Seconds: Accumulated speech required before creating a new speaker

# Enrolled speaker profile matching threshold
PROFILE_MATCH_THRESHOLD = 0.74


@dataclass
class SpeakerProfile:
    """Enrolled speaker profile with voice embedding."""
    profile_id: str
    name: str
    embedding: np.ndarray
    created_at: float = field(default_factory=time.time)


@dataclass
class SpeakerCluster:
    """Speaker cluster tracked across audio chunks within a session."""
    speaker_id: str                          # e.g. "SPEAKER_00", "SPEAKER_01"
    speaker_label: str                       # e.g. "Người 1", "Người 2", "Thầy Minh"
    centroid: np.ndarray                     # Unit normalized L2 vector
    recent_embeddings: List[np.ndarray] = field(default_factory=list)  # Last N reliable embeddings
    sample_count: int = 1                    # Number of segments clustered
    total_duration_s: float = 1.0            # Total accumulated speech duration
    last_seen: float = field(default_factory=time.time)
    enrolled_profile_id: Optional[str] = None


@dataclass
class CandidateSpeaker:
    """Provisional candidate before being promoted to a full speaker identity."""
    temp_id: str
    embeddings: List[np.ndarray] = field(default_factory=list)
    accumulated_duration_s: float = 0.0
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)


class SpeakerSessionState:
    """Maintains consistent speaker identities across multiple chunks for a single session."""

    def __init__(self, session_id: str, similarity_threshold: float = T_SAME_SPEAKER):
        self.session_id = session_id
        self.similarity_threshold = similarity_threshold
        self.clusters: List[SpeakerCluster] = []
        self.candidates: Dict[str, CandidateSpeaker] = {}
        self.aliases: Dict[str, str] = {}  # speaker_id -> custom alias (e.g. "SPEAKER_00" -> "Thầy Minh")
        self.enrolled_profiles: Dict[str, SpeakerProfile] = {}
        self.created_at = time.time()
        self.last_activity = time.time()

    def set_alias(self, speaker_id: str, new_name: str) -> None:
        """Assign custom name alias to a speaker ID."""
        self.aliases[speaker_id] = new_name.strip()
        for c in self.clusters:
            if c.speaker_id == speaker_id:
                c.speaker_label = new_name.strip()

    def register_profile(self, profile_id: str, name: str, embedding: np.ndarray) -> None:
        """Register an enrolled voice profile into this session."""
        norm_emb = embedding / (np.linalg.norm(embedding) + 1e-9)
        self.enrolled_profiles[profile_id] = SpeakerProfile(
            profile_id=profile_id,
            name=name,
            embedding=norm_emb,
        )

    def match_enrolled_profile(self, embedding: np.ndarray) -> Optional[Tuple[str, str]]:
        """Check if an embedding matches any enrolled voice profiles."""
        best_sim = -1.0
        best_profile: Optional[SpeakerProfile] = None

        for p in self.enrolled_profiles.values():
            sim = float(np.dot(embedding, p.embedding))
            if sim > best_sim:
                best_sim = sim
                best_profile = p

        if best_profile and best_sim >= PROFILE_MATCH_THRESHOLD:
            return best_profile.profile_id, best_profile.name
        return None

    def match_or_create_speaker(
        self,
        embedding: np.ndarray,
        duration_s: float = 1.0,
        prev_speaker_id: Optional[str] = None,
        pause_s: float = 0.0,
    ) -> Tuple[str, str]:
        """Multi-factor speaker assignment with Hysteresis, Centroid EMA, and Candidate Promotion.
        Returns (speaker_id, speaker_label).
        """
        self.last_activity = time.time()
        norm_emb = embedding / (np.linalg.norm(embedding) + 1e-9)

        # 1. Check enrolled profiles first
        enrolled_match = self.match_enrolled_profile(norm_emb)

        # 2. If no clusters exist yet, create the first primary speaker
        if not self.clusters:
            spk_id = "SPEAKER_00"
            if enrolled_match:
                prof_id, prof_name = enrolled_match
                spk_label = self.aliases.get(spk_id, prof_name)
                cluster = SpeakerCluster(
                    speaker_id=spk_id,
                    speaker_label=spk_label,
                    centroid=norm_emb.copy(),
                    recent_embeddings=[norm_emb.copy()],
                    sample_count=1,
                    total_duration_s=duration_s,
                    enrolled_profile_id=prof_id,
                )
            else:
                spk_label = self.aliases.get(spk_id, "Người 1")
                cluster = SpeakerCluster(
                    speaker_id=spk_id,
                    speaker_label=spk_label,
                    centroid=norm_emb.copy(),
                    recent_embeddings=[norm_emb.copy()],
                    sample_count=1,
                    total_duration_s=duration_s,
                )
            self.clusters.append(cluster)
            return spk_id, spk_label

        # 3. Multi-factor scoring against all session clusters
        best_score = -1.0
        best_cluster: Optional[SpeakerCluster] = None

        for c in self.clusters:
            # A. Centroid cosine similarity
            s_centroid = float(np.dot(norm_emb, c.centroid))

            # B. Recent embeddings similarity (robust against loudness/pitch variations)
            s_recent = s_centroid
            if c.recent_embeddings:
                r_sims = [float(np.dot(norm_emb, r)) for r in c.recent_embeddings]
                s_recent = max(r_sims)

            base_sim = max(s_centroid, s_recent)

            # C. Temporal continuity boost: prioritize previous speaker if conversational pause is short
            continuity_boost = 0.0
            if prev_speaker_id and c.speaker_id == prev_speaker_id and pause_s < 2.0:
                continuity_boost = 0.08

            total_score = base_sim + continuity_boost

            if total_score > best_score:
                best_score = total_score
                best_cluster = c

        assert best_cluster is not None

        # 4. Hysteresis Decision Logic
        # Region A: Known speaker match (score >= T_SAME_SPEAKER)
        if best_score >= T_SAME_SPEAKER:
            # Update centroid via Exponential Moving Average (EMA: alpha=0.85)
            alpha = 0.85
            new_centroid = alpha * best_cluster.centroid + (1.0 - alpha) * norm_emb
            best_cluster.centroid = new_centroid / (np.linalg.norm(new_centroid) + 1e-9)

            # Update recent embeddings sliding window (keep last 10)
            best_cluster.recent_embeddings.append(norm_emb.copy())
            if len(best_cluster.recent_embeddings) > 10:
                best_cluster.recent_embeddings.pop(0)

            best_cluster.sample_count += 1
            best_cluster.total_duration_s += duration_s
            best_cluster.last_seen = time.time()

            label = self.aliases.get(best_cluster.speaker_id, best_cluster.speaker_label)
            return best_cluster.speaker_id, label

        # Region B: Uncertain region (0.50 <= score < 0.60) OR Short Utterance (< 0.8s)
        # Prevents False New Speaker fragmentation: Reuse best existing speaker without updating centroid
        if best_score >= T_UNCERTAIN_SPEAKER or duration_s < MIN_EMBEDDING_DURATION:
            best_cluster.last_seen = time.time()
            label = self.aliases.get(best_cluster.speaker_id, best_cluster.speaker_label)
            return best_cluster.speaker_id, label

        # Region C: Candidate Stage (score < 0.50 and duration >= 0.8s)
        # Never create a new speaker from a single utterance; accumulate evidence first
        cand_key = f"cand_{len(self.clusters)}"
        if cand_key not in self.candidates:
            self.candidates[cand_key] = CandidateSpeaker(
                temp_id=cand_key,
                embeddings=[norm_emb.copy()],
                accumulated_duration_s=duration_s,
            )
        else:
            cand = self.candidates[cand_key]
            cand.embeddings.append(norm_emb.copy())
            cand.accumulated_duration_s += duration_s
            cand.last_seen = time.time()

        cand = self.candidates[cand_key]

        # Promote candidate to full speaker identity only when evidence is sufficient
        if cand.accumulated_duration_s >= CANDIDATE_PROMOTION_DURATION and len(self.clusters) < 12:
            new_idx = len(self.clusters)
            spk_id = f"SPEAKER_{new_idx:02d}"

            # Compute initial centroid from accumulated candidate embeddings
            mean_emb = np.mean(cand.embeddings, axis=0)
            c_norm = mean_emb / (np.linalg.norm(mean_emb) + 1e-9)

            if enrolled_match:
                prof_id, prof_name = enrolled_match
                spk_label = self.aliases.get(spk_id, prof_name)
                new_cluster = SpeakerCluster(
                    speaker_id=spk_id,
                    speaker_label=spk_label,
                    centroid=c_norm,
                    recent_embeddings=cand.embeddings[-10:],
                    sample_count=len(cand.embeddings),
                    total_duration_s=cand.accumulated_duration_s,
                    enrolled_profile_id=prof_id,
                )
            else:
                spk_label = self.aliases.get(spk_id, f"Người {new_idx + 1}")
                new_cluster = SpeakerCluster(
                    speaker_id=spk_id,
                    speaker_label=spk_label,
                    centroid=c_norm,
                    recent_embeddings=cand.embeddings[-10:],
                    sample_count=len(cand.embeddings),
                    total_duration_s=cand.accumulated_duration_s,
                )

            self.clusters.append(new_cluster)
            del self.candidates[cand_key]
            return spk_id, spk_label

        # Fallback while candidate is still accumulating: assign to closest existing speaker safely
        label = self.aliases.get(best_cluster.speaker_id, best_cluster.speaker_label)
        return best_cluster.speaker_id, label

    def reconcile_and_merge_clusters(self) -> Dict[str, str]:
        """Global reconciliation: Merge clusters that have high centroid similarity (>= T_MERGE_CLUSTERS).
        Returns a dictionary of { source_speaker_id: target_speaker_id }.
        """
        merge_map: Dict[str, str] = {}
        if len(self.clusters) < 2:
            return merge_map

        i = 0
        while i < len(self.clusters):
            j = i + 1
            while j < len(self.clusters):
                c_i = self.clusters[i]
                c_j = self.clusters[j]

                # If either cluster was manually renamed to different aliases, don't auto-merge
                if (c_i.speaker_id in self.aliases and c_j.speaker_id in self.aliases and
                        self.aliases[c_i.speaker_id] != self.aliases[c_j.speaker_id]):
                    j += 1
                    continue

                sim = float(np.dot(c_i.centroid, c_j.centroid))
                if sim >= T_MERGE_CLUSTERS:
                    # Merge cluster j into cluster i
                    logger.info(f"[SpeakerSession] Merging {c_j.speaker_id} into {c_i.speaker_id} (similarity: {sim:.3f})")
                    tot_count = c_i.sample_count + c_j.sample_count
                    merged_centroid = (c_i.centroid * c_i.sample_count + c_j.centroid * c_j.sample_count) / tot_count
                    c_i.centroid = merged_centroid / (np.linalg.norm(merged_centroid) + 1e-9)
                    c_i.sample_count = tot_count
                    c_i.total_duration_s += c_j.total_duration_s
                    c_i.recent_embeddings = (c_i.recent_embeddings + c_j.recent_embeddings)[-10:]

                    merge_map[c_j.speaker_id] = c_i.speaker_id
                    self.clusters.pop(j)
                else:
                    j += 1
            i += 1

        return merge_map

    def merge_speakers(self, source_id: str, target_id: str) -> bool:
        """Manual merge of source_id into target_id."""
        source_cluster: Optional[SpeakerCluster] = None
        target_cluster: Optional[SpeakerCluster] = None

        for c in self.clusters:
            if c.speaker_id == source_id:
                source_cluster = c
            elif c.speaker_id == target_id:
                target_cluster = c

        if not source_cluster or not target_cluster:
            return False

        tot_count = target_cluster.sample_count + source_cluster.sample_count
        merged_centroid = (target_cluster.centroid * target_cluster.sample_count +
                           source_cluster.centroid * source_cluster.sample_count) / tot_count
        target_cluster.centroid = merged_centroid / (np.linalg.norm(merged_centroid) + 1e-9)
        target_cluster.sample_count = tot_count
        target_cluster.total_duration_s += source_cluster.total_duration_s
        target_cluster.recent_embeddings = (target_cluster.recent_embeddings + source_cluster.recent_embeddings)[-10:]

        self.clusters = [c for c in self.clusters if c.speaker_id != source_id]
        return True


class SpeakerSessionManager:
    """Global manager for all active speaker diarization sessions."""

    _instance: Optional[SpeakerSessionManager] = None

    def __init__(self, ttl_seconds: float = 7200.0):
        self._sessions: Dict[str, SpeakerSessionState] = {}
        self.ttl_seconds = ttl_seconds

    @classmethod
    def get_instance(cls) -> SpeakerSessionManager:
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def get_or_create_session(self, session_id: Optional[str]) -> SpeakerSessionState:
        """Get existing session by ID or initialize a new session state."""
        self._cleanup_stale_sessions()
        s_id = session_id.strip() if session_id and session_id.strip() else "default_session"
        if s_id not in self._sessions:
            self._sessions[s_id] = SpeakerSessionState(session_id=s_id)
        return self._sessions[s_id]

    def _cleanup_stale_sessions(self) -> None:
        """Remove sessions that have been inactive past TTL."""
        now = time.time()
        stale = [
            sid for sid, sess in self._sessions.items()
            if now - sess.last_activity > self.ttl_seconds and sid != "default_session"
        ]
        for sid in stale:
            del self._sessions[sid]


def get_speaker_session_manager() -> SpeakerSessionManager:
    return SpeakerSessionManager.get_instance()

