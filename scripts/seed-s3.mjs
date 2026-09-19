import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadLocalMedia } from "../media-store.mjs";
const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error("S3_BUCKET is required");
const key = process.env.S3_KEY || "media.json";
const records = await loadLocalMedia();
await new S3Client({}).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(records, null, 2) + "\n", ContentType: "application/json", IfNoneMatch: "*" }));
console.log(`Uploaded ${records.length} records to s3://${bucket}/${key}`);
