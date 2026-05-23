// /documents — KB ingest (Phase 2).
//
//   POST   /documents              upload (multipart, kb.manage)
//   GET    /documents              list (kb.view)
//   GET    /documents/:id          single (kb.view)
//   DELETE /documents/:id          delete (kb.manage)
//   POST   /documents/:id/reindex  re-extract + re-embed (kb.manage)
//
// Indexing is inline (no queue) — fine for hackathon demo. Status flows
// through 'uploaded' → 'parsing' → 'indexed' | 'failed'.

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, documentChunks } from '../db/schema.js';
import { requireAuth } from '../auth/requireAuth.js';
import { requirePermission } from '../rbac/requirePermission.js';
import { writeAudit } from '../auth/audit.js';
import { chunkText } from '../rag/chunk.js';
import { extractText, detectMime, SUPPORTED_MIME, MAX_BYTES } from '../rag/extract.js';
import { getEmbedder } from '../providers/index.js';

export const documentsRouter = Router();

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'documents');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
});

documentsRouter.use(requireAuth);

// ---------- list ----------
documentsRouter.get('/', requirePermission('kb.view', 'org'), async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(documents)
      .where(eq(documents.orgId, req.user.orgId))
      .orderBy(desc(documents.createdAt));
    res.json({ documents: rows });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

documentsRouter.get('/:id', requirePermission('kb.view', 'org'), async (req, res) => {
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, req.params.id), eq(documents.orgId, req.user.orgId)))
      .limit(1);
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json({ document: doc });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// ---------- upload ----------
documentsRouter.post(
  '/',
  requirePermission('kb.manage', 'org'),
  upload.single('file'),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'file required' });
      const mime = detectMime(file.originalname, file.mimetype);
      if (!SUPPORTED_MIME.has(mime)) {
        return res.status(415).json({ error: `unsupported mime: ${mime}` });
      }

      // Save to disk
      await fs.mkdir(STORAGE_ROOT, { recursive: true });
      const ext = path.extname(file.originalname) || '';
      const storedName = `${randomUUID()}${ext}`;
      const storagePath = path.join(STORAGE_ROOT, storedName);
      await fs.writeFile(storagePath, file.buffer);

      const [doc] = await db
        .insert(documents)
        .values({
          orgId: req.user.orgId,
          name: file.originalname,
          mime,
          sizeBytes: file.size,
          storagePath,
          status: 'uploaded',
          uploadedBy: req.user.id,
        })
        .returning();

      // Kick off ingest inline. Don't await — return 202 + the row.
      ingest(doc.id).catch((err) => {
        console.error('[documents] ingest failed:', doc.id, err);
      });

      await writeAudit({
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'kb.upload',
        targetType: 'document',
        targetId: doc.id,
        meta: { name: file.originalname, mime, sizeBytes: file.size },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.status(202).json({ document: doc });
    } catch (e) {
      console.error('[documents] upload error', e);
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- delete ----------
documentsRouter.delete(
  '/:id',
  requirePermission('kb.manage', 'org'),
  async (req, res) => {
    try {
      const [doc] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, req.params.id), eq(documents.orgId, req.user.orgId)))
        .limit(1);
      if (!doc) return res.status(404).json({ error: 'not found' });

      // cascade DELETE handles chunks. Best-effort unlink the file.
      await fs.unlink(doc.storagePath).catch(() => {});
      await db.delete(documents).where(eq(documents.id, doc.id));

      await writeAudit({
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'kb.delete',
        targetType: 'document',
        targetId: doc.id,
        meta: { name: doc.name },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- reindex ----------
documentsRouter.post(
  '/:id/reindex',
  requirePermission('kb.manage', 'org'),
  async (req, res) => {
    try {
      const [doc] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, req.params.id), eq(documents.orgId, req.user.orgId)))
        .limit(1);
      if (!doc) return res.status(404).json({ error: 'not found' });

      // Bump version on every reindex (M5 — sessions can pin to a version).
      await db
        .update(documents)
        .set({ status: 'parsing', version: doc.version + 1, error: null, updatedAt: new Date() })
        .where(eq(documents.id, doc.id));
      await db.delete(documentChunks).where(eq(documentChunks.documentId, doc.id));

      ingest(doc.id).catch((err) => {
        console.error('[documents] reindex failed:', doc.id, err);
      });

      await writeAudit({
        orgId: req.user.orgId,
        actorUserId: req.user.id,
        action: 'kb.reindex',
        targetType: 'document',
        targetId: doc.id,
        meta: { name: doc.name, version: doc.version + 1 },
      });

      res.status(202).json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  },
);

// ---------- inline ingest ----------
//
// Extract → chunk → embed (batched) → store.
async function ingest(documentId) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return;
  try {
    await db
      .update(documents)
      .set({ status: 'parsing', updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    const raw = await extractText(doc.storagePath, doc.mime);
    const chunks = chunkText(raw);
    if (chunks.length === 0) {
      await db
        .update(documents)
        .set({ status: 'failed', error: 'no text extracted', updatedAt: new Date() })
        .where(eq(documents.id, documentId));
      return;
    }

    // Embed in batches to keep requests small (Ollama handles ~32 fine).
    const BATCH = 16;
    const embedder = getEmbedder();
    const rows = [];
    for (let i = 0; i < chunks.length; i += BATCH) {
      const slice = chunks.slice(i, i + BATCH);
      const { vectors } = await embedder.embed(slice.map((s) => s.text));
      for (let j = 0; j < slice.length; j++) {
        rows.push({
          documentId,
          orgId: doc.orgId,
          chunkIndex: i + j,
          text: slice[j].text,
          tokens: slice[j].tokens,
          embedding: vectors[j],
        });
      }
    }

    // Bulk-insert in batches (postgres-js does parameter expansion well, but
    // huge inserts can blow VARCHAR token caps — stay under 500 rows per call).
    const INSERT_BATCH = 200;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      await db.insert(documentChunks).values(rows.slice(i, i + INSERT_BATCH));
    }

    await db
      .update(documents)
      .set({
        status: 'indexed',
        plainText: raw.slice(0, 4000), // store a preview only
        chunkCount: rows.length,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    console.log(`[documents] indexed ${doc.name} → ${rows.length} chunks`);
  } catch (err) {
    console.error('[documents] ingest error', err);
    await db
      .update(documents)
      .set({ status: 'failed', error: String(err?.message || err).slice(0, 500), updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  }
}
