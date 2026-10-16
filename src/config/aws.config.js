/**
 * S3 client and bucket settings from the AWS_* environment variables.
 *
 * Exports: awsConfig, s3Client
 * Used by: services/aws/aws.service.js
 */

import { S3Client } from "@aws-sdk/client-s3";
export const awsConfig = {
  bucket: process.env.AWS_S3_BUCKET,
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY,
  secretAccessKey: process.env.AWS_SECRET_KEY,
};
// Export S3 client
export const s3Client = new S3Client({
  region: awsConfig.region,
  credentials: {
    accessKeyId: awsConfig.accessKeyId,
    secretAccessKey: awsConfig.secretAccessKey,
  },
});
