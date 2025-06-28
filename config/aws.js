const { S3Client, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

// Create S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// S3 bucket name
const BUCKET_NAME = process.env.AWS_S3_BUCKET;

// Helper function to generate signed URL for video streaming
const generateSignedUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  return await getSignedUrl(s3Client, command, { expiresIn });
};

// Helper function to generate signed URL for upload
const generateUploadUrl = async (key, contentType, expiresIn = 3600) => {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  
  return await getSignedUrl(s3Client, command, { expiresIn });
};

// Helper function to check if file exists in S3
const fileExists = async (key) => {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
};

// Helper function to delete file from S3
const deleteFile = async (key) => {
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    }));
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
};

// Helper function to get file metadata
const getFileMetadata = async (key) => {
  try {
    const result = await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    }));
    
    return {
      size: result.ContentLength,
      contentType: result.ContentType,
      lastModified: result.LastModified,
      etag: result.ETag
    };
  } catch (error) {
    console.error('Error getting file metadata:', error);
    return null;
  }
};

module.exports = {
  s3Client,
  s3: s3Client, // For backward compatibility with multer-s3
  BUCKET_NAME,
  generateSignedUrl,
  generateUploadUrl,
  fileExists,
  deleteFile,
  getFileMetadata
}; 