import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import path from 'path';

const s3 = new S3Client({ forcePathStyle: true });

const BUCKET = process.env.BUCKET_UPLOADS ?? 'uploads';

export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  contentType: string,
  folder = 'profile-photos',
): Promise<string> {
  const ext = path.extname(originalName) || '.jpg';
  const key = `${folder}/${crypto.randomUUID()}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket:      BUCKET,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }),
  );

  const endpoint = process.env.AWS_ENDPOINT_URL_S3;
  return `${endpoint}/${BUCKET}/${key}`;
}
