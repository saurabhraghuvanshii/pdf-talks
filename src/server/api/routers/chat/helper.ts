import { GoogleGenerativeAI, type Content, TaskType } from "@google/generative-ai";
import { supabase } from "@/lib/supabase";
import { db } from "@/server/db";
import { env } from "@/env";
import ConvertApi from 'convertapi';
import { createHash } from "crypto";

const genAI = new GoogleGenerativeAI(env.GOOGLE_GENERATIVE_AI_API_KEY);
const convertApi = new ConvertApi(env.CONVERT_API_SECRET, { conversionTimeout: 60 });

function generateChunkId(content: string, index: number, fileId: string): string {
  return createHash('sha256').update(String(content) + String(index) + String(fileId)).digest('hex').slice(0, 16);
}

async function embedChunks(chunks: { id: string, content: string }[], title: string) {
  try {
    const batchSize = 10;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      try {
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
        const result = await embeddingModel.batchEmbedContents({
          requests: batch.map((chunk) => ({
            content: { parts: [{ text: chunk.content }], role: "user" } as Content,
            taskType: TaskType.RETRIEVAL_DOCUMENT,
            title: title,
          })),
        });

        const batchEmbeddings = result.embeddings?.map((e: any) => e.values) ?? [];
        allEmbeddings.push(...batchEmbeddings);

      } catch (batchError: any) {
        allEmbeddings.push(...batch.map(() => []));
      }

      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    return allEmbeddings;
  } catch (error) {
    return chunks.map(() => []);
  }
}

const CHUNK_TARGET = 400;
const CHUNK_MIN = 256;
const CHUNK_MAX = 512;
const CHUNK_OVERLAP_RATIO = 0.1;

function splitTextIntoChunks(text: string, target = CHUNK_TARGET, minSize = CHUNK_MIN, maxSize = CHUNK_MAX, overlapRatio = CHUNK_OVERLAP_RATIO) {
  const chunks: { content: string, start: number, end: number }[] = [];
  if (!text || text.trim().length === 0) return chunks;

  const textLen = text.length;
  const overlapChars = Math.max(1, Math.floor(target * overlapRatio));
  let i = 0;

  const findLastSentenceBoundary = (from: number, to: number) => {
    for (let j = to; j >= from; j--) {
      const ch = text[j];
      if (ch === '.' || ch === '!' || ch === '?') {
        const nextChar = text[j + 1];
        if (j + 1 >= textLen || (nextChar && /\s/.test(nextChar))) return j + 1;
      }
    }
    return -1;
  };

  while (i < textLen) {
    let desiredEnd = Math.min(i + target, textLen);
    let end = desiredEnd;

    if (desiredEnd < textLen) {
      const searchStart = Math.max(i + Math.floor(minSize / 2), i);
      const found = findLastSentenceBoundary(searchStart, desiredEnd);
      if (found !== -1 && (found - i) >= Math.floor(minSize * 0.5)) {
        end = found;
      } else {
        end = desiredEnd;
      }
    } else {
      end = textLen;
    }

    if (end <= i) {
      end = Math.min(i + target, textLen);
    }

    let piece = text.slice(i, end).trim();

    if (piece.length > maxSize) {
      let subStart = 0;
      while (subStart < piece.length) {
        let subEnd = Math.min(subStart + maxSize, piece.length);
        if (subEnd < piece.length) {
          const lastSpace = piece.lastIndexOf(' ', subEnd);
          if (lastSpace > subStart + Math.floor(maxSize * 0.5)) {
            subEnd = lastSpace;
          }
        }
        const subText = piece.slice(subStart, subEnd).trim();
        if (subText.length > 0) {
          chunks.push({ content: subText, start: i + subStart, end: i + subEnd });
        }
        if (subEnd === subStart) break;
        subStart = subEnd;
      }
    } else {
      chunks.push({ content: piece, start: i, end: end });
    }
    const nextStart = Math.max(i + 1, end - overlapChars);
    if (nextStart <= i) i = end;
    else i = nextStart;
  }

  return chunks;
}

export async function processAndEmbedFile(file: File, userId: string) {
  const safeFileName = file.name.replace(/[^\w.-]/gi, "_");
  const supabasePath = `${userId}/${Date.now()}-${safeFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("files")
    .upload(supabasePath, file);

  if (uploadError) {
    throw new Error("Failed to upload file to Supabase.");
  }

  try {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `temp-${Date.now()}-${safeFileName}`);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(tempFilePath, buffer);

    const conversionResult = await convertApi.convert('txt', { File: tempFilePath });
    const textFileUrl = (conversionResult as any).files?.[0]?.Url || (conversionResult as any).Files?.[0]?.Url || (conversionResult as any).files?.[0]?.url;

    if (!textFileUrl) {
      throw new Error("ConvertAPI did not return a text file URL.");
    }

    const response = await fetch(textFileUrl);
    const textContent = await response.text();

    try {
      fs.unlinkSync(tempFilePath);
    } catch (e) {
      // Temp file cleanup failed
    }

    const dbFile = await db.file.create({
      data: {
        name: safeFileName,
        fileType: file.type,
        size: file.size,
        userId,
        htmlContent: '',
        supabaseFileId: "N/A",
        supabasePath: supabasePath,
      },
    });
    const originalLines = textContent.split('\n').filter(line => line.trim().length > 0);
    const joinedText = originalLines.join(' ');

    const rawChunks = splitTextIntoChunks(joinedText, CHUNK_TARGET, CHUNK_MIN, CHUNK_MAX, CHUNK_OVERLAP_RATIO);

    const chunkObjs = rawChunks.map((c, idx) => ({
      id: generateChunkId(c.content, idx, dbFile.id),
      content: c.content,
      start: c.start,
      end: c.end,
    }));

    let searchFrom = 0;
    const cleanHtml = originalLines.map((originalLine, li) => {
      if (!originalLine) return '';

      const trimmed = originalLine.trim();
      if (!trimmed) return '';

      // Find this line's position in the joined text, accounting for duplicates by searching from the last position
      let lineStart = joinedText.indexOf(trimmed, searchFrom);
      if (lineStart === -1) {
        // Fallback: search from beginning if not found ahead (content may slightly differ due to spaces)
        lineStart = joinedText.indexOf(trimmed);
      }
      let lineEnd = lineStart !== -1 ? lineStart + trimmed.length : searchFrom;
      if (lineStart !== -1) {
        searchFrom = Math.max(searchFrom, lineEnd);
      }

      let bestChunkId = chunkObjs[0]?.id || generateChunkId(originalLine, li, dbFile.id);

      if (chunkObjs.length > 0 && lineStart !== -1) {
        let bestScore = 0;
        for (const chunk of chunkObjs) {
          if (!chunk) continue;

          const overlapStart = Math.max(lineStart, chunk.start);
          const overlapEnd = Math.min(lineEnd, chunk.end);
          const overlap = Math.max(0, overlapEnd - overlapStart);

          if (overlap > bestScore) {
            bestScore = overlap;
            bestChunkId = chunk.id;
          }
        }
      }

      return `<p data-chunk-id="${bestChunkId}">${originalLine}</p>`;
    }).join('\n');

    await db.file.update({
      where: { id: dbFile.id },
      data: { htmlContent: cleanHtml },
    });

    let embeddings: number[][] = [];
    try {
      embeddings = await embedChunks(chunkObjs.map(c => ({ id: c.id, content: c.content })), dbFile.name);
    } catch (error) {
      embeddings = chunkObjs.map(() => []);
    }

    if (chunkObjs.length > 0) {
      const chunksWithEmbeddings = chunkObjs.map((chunk, i) => ({
        id: chunk.id,
        content: chunk.content,
        fileId: dbFile.id,
        embedding: embeddings[i] && embeddings[i].length > 0 ? `[${embeddings[i].join(',')}]` : null
      }));

      const batchSize = 20;
      for (let i = 0; i < chunksWithEmbeddings.length; i += batchSize) {
        const batch = chunksWithEmbeddings.slice(i, i + batchSize);

        try {
          const values = batch.map(chunk =>
            `('${chunk.id}', '${chunk.content.replace(/'/g, "''")}', '${chunk.fileId}', ${chunk.embedding ? `'${chunk.embedding}'::vector` : 'NULL'})`
          ).join(',');

          await db.$executeRawUnsafe(`
            INSERT INTO "DocumentChunk" (id, content, "fileId", embedding)
            VALUES ${values}
          `);
        } catch (dbError) {
          const values = batch.map(chunk =>
            `('${chunk.id}', '${chunk.content.replace(/'/g, "''")}', '${chunk.fileId}')`
          ).join(',');

          await db.$executeRawUnsafe(`
            INSERT INTO "DocumentChunk" (id, content, "fileId")
            VALUES ${values}
          `);
        }
      }
    }

    return {
      name: dbFile.name, size: file.size, type: file.type, path: supabasePath,
      id: dbFile.id,
      htmlContent: cleanHtml,
    };

  } catch (error) {
    await supabase.storage.from("files").remove([supabasePath]);
    throw new Error("Failed to process file.");
  }
}
