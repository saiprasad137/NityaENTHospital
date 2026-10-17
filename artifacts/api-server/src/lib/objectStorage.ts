import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

// Only instantiate GCS Storage client with Replit credentials if running inside Replit
export const objectStorageClient = new Storage(
  process.env.REPL_ID
    ? {
        credentials: {
          audience: 'replit',
          subject_token_type: 'access_token',
          token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
          type: 'external_account',
          credential_source: {
            url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
            format: {
              type: 'json',
              subject_token_field_name: 'access_token',
            },
          },
          universe_domain: 'googleapis.com',
        },
        projectId: '',
      }
    : {},
);

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface StorageFileLike {
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[Record<string, unknown>]>;
  delete(options?: { ignoreNotFound?: boolean }): Promise<[unknown]>;
  createReadStream(): NodeJS.ReadableStream;
}

export class ObjectStorageService {
  private localUploadsDir: string;

  constructor() {
    this.localUploadsDir = path.resolve(
      process.cwd(),
      process.env.LOCAL_UPLOAD_DIR || 'uploads',
    );
  }

  isLocal(): boolean {
    return !process.env.PRIVATE_OBJECT_DIR;
  }

  getLocalUploadsDir(): string {
    if (!fs.existsSync(this.localUploadsDir)) {
      fs.mkdirSync(this.localUploadsDir, { recursive: true });
    }
    return this.localUploadsDir;
  }

  async saveLocalUpload(
    id: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const dir = this.getLocalUploadsDir();
    const filePath = path.join(dir, id);
    const metaPath = path.join(dir, `${id}.meta.json`);
    await fs.promises.writeFile(filePath, buffer);
    await fs.promises.writeFile(
      metaPath,
      JSON.stringify({ contentType, size: buffer.length }),
      'utf-8',
    );
  }

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    );
    if (paths.length === 0) {
      if (this.isLocal()) return [];
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir && !this.isLocal()) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | StorageFileLike | null> {
    if (this.isLocal()) {
      const localPath = path.join(this.getLocalUploadsDir(), filePath);
      if (fs.existsSync(localPath)) {
        return this.getLocalFileLike(filePath);
      }
      return null;
    }

    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }
    return null;
  }

  async downloadObject(
    file: File | StorageFileLike,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    let isPublic = true;

    if (file instanceof File) {
      const aclPolicy = await getObjectAclPolicy(file);
      isPublic = aclPolicy?.visibility === 'public';
    }

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const objectId = randomUUID();

    if (this.isLocal()) {
      return `/api/storage/uploads/direct/${objectId}`;
    }

    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  private getLocalFileLike(id: string): StorageFileLike {
    const dir = this.getLocalUploadsDir();
    const filePath = path.join(dir, id);
    const metaPath = path.join(dir, `${id}.meta.json`);

    return {
      async exists() {
        return [fs.existsSync(filePath)];
      },
      async getMetadata() {
        if (!fs.existsSync(filePath)) {
          throw new ObjectNotFoundError();
        }
        let contentType = 'application/octet-stream';
        let size = 0;
        try {
          const stat = await fs.promises.stat(filePath);
          size = stat.size;
          if (fs.existsSync(metaPath)) {
            const raw = await fs.promises.readFile(metaPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.contentType) contentType = parsed.contentType;
          }
        } catch {}
        return [{ contentType, size }];
      },
      async delete() {
        try {
          if (fs.existsSync(filePath)) await fs.promises.unlink(filePath);
          if (fs.existsSync(metaPath)) await fs.promises.unlink(metaPath);
        } catch {}
        return [null];
      },
      createReadStream() {
        return fs.createReadStream(filePath);
      },
    };
  }

  async getObjectEntityFile(objectPath: string): Promise<File | StorageFileLike> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    if (this.isLocal()) {
      const fileId = parts.slice(2).join('/') || parts[1];
      const localFile = this.getLocalFileLike(fileId);
      const [exists] = await localFile.exists();
      if (!exists) {
        throw new ObjectNotFoundError();
      }
      return localFile;
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith('/api/storage/uploads/direct/')) {
      const id = rawPath.slice('/api/storage/uploads/direct/'.length);
      return `/objects/uploads/${id}`;
    }

    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    if (objectFile instanceof File) {
      await setObjectAclPolicy(objectFile, aclPolicy);
    }
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File | StorageFileLike;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    if (!(objectFile instanceof File)) {
      return true;
    }
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
