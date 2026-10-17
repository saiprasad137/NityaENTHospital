import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import express, { Router, type IRouter } from "express";
import { Readable } from "node:stream";
import { ObjectPermission } from "../lib/objectAcl";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { requireAdmin } from "../middlewares/adminAuth";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
]);
const maxImageBytes = 15 * 1024 * 1024;
const maxVideoBytes = 100 * 1024 * 1024;

router.post(
  "/storage/uploads/request-url",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { name, size, contentType } = parsed.data;
    const isVideo = contentType.startsWith("video/");
    if (
      !allowedTypes.has(contentType) ||
      size > (isVideo ? maxVideoBytes : maxImageBytes)
    ) {
      res.status(400).json({
        error: "Use a supported image or video within the upload size limit.",
      });
      return;
    }

    try {
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating media upload URL");
      res.status(500).json({ error: "Could not prepare the media upload." });
    }
  },
);

router.put(
  "/storage/uploads/direct/:id",
  express.raw({ type: "*/*", limit: "100mb" }),
  async (req, res): Promise<void> => {
    try {
      const id = req.params.id;
      const contentType =
        (req.headers["content-type"] as string) || "application/octet-stream";
      const buffer = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body || "");
      await objectStorage.saveLocalUpload(id, buffer, contentType);
      res.sendStatus(200);
    } catch (error) {
      req.log.error({ err: error }, "Error saving local upload");
      res.status(500).json({ error: "Could not save uploaded media." });
    }
  },
);

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  try {
    const rawPath = req.params.path;
    const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
    const objectFile = await objectStorage.getObjectEntityFile(`/objects/${path}`);
    const canRead = await objectStorage.canAccessObjectEntity({
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canRead) {
      res.status(403).json({ error: "This media file is not public." });
      return;
    }

    const response = await objectStorage.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Media file not found." });
      return;
    }
    req.log.error({ err: error }, "Error serving public media file");
    res.status(500).json({ error: "Could not serve the media file." });
  }
});

export default router;
