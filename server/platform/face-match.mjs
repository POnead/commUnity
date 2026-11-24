// Pure math for face references. Kept dependency-free so it can be unit-tested
// without a database or a browser. Embeddings are never trusted straight from
// the client: shape, magnitude and duplication are all checked here.

export const MAX_FACE_REFERENCES = 5;
export const EMBEDDING_LENGTH = 128;
export const DEFAULT_MATCH_THRESHOLD = 0.033;
export const DUPLICATE_DISTANCE = 0.04;

export function parseEmbedding(value) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
  if (parts.length !== EMBEDDING_LENGTH) return null;
  const embedding = parts.map(Number);
  if (embedding.some((n) => !Number.isFinite(n) || Math.abs(n) > 10)) return null;
  // face-api descriptors are roughly unit length; anything far outside that
  // band is a garbage or tampered vector, not a face.
  const norm = Math.hypot(...embedding);
  if (norm < 0.5 || norm > 2) return null;
  return embedding;
}

// Cosine distance in [0, 2]. 0 = identical direction.
export function cosineDistance(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const similarity = dot / (Math.sqrt(normA * normB) || 1);
  return Math.max(0, Math.min(2, 1 - similarity));
}

// Distance of a descriptor to its nearest stored reference, or null when none exist.
export function nearestDistance(embedding, references) {
  let nearest = null;
  for (const reference of references) {
    const candidate = Array.isArray(reference?.embedding) ? reference.embedding : null;
    if (!candidate || candidate.length !== EMBEDDING_LENGTH) continue;
    const distance = cosineDistance(embedding, candidate);
    if (nearest === null || distance < nearest) nearest = distance;
  }
  return nearest;
}
