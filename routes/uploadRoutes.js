const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { v4: uuidv4 } = require('uuid');
const { s3, BUCKET_NAME, generateUploadUrl, fileExists, getFileMetadata } = require('../config/aws');
const videoProcessor = require('../services/videoProcessor');

const router = express.Router();

// Configure multer for S3 upload
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: BUCKET_NAME,
    metadata: function (req, file, cb) {
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname,
        contentType: file.mimetype,
        uploadedAt: new Date().toISOString()
      });
    },
    key: function (req, file, cb) {
      // Generate unique filename with timestamp
      const timestamp = Date.now();
      const uniqueId = uuidv4();
      const extension = file.originalname.split('.').pop();
      const filename = `videos/${timestamp}-${uniqueId}.${extension}`;
      cb(null, filename);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Check if file is a video
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

// Upload video endpoint
router.post('/video', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const videoId = uuidv4(); // Generate unique video ID

    const videoData = {
      id: videoId,
      filename: req.file.key,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: req.file.location,
      uploadedAt: new Date().toISOString(),
      metadata: req.file.metadata,
      s3Key: req.file.key // Store S3 key for later use
    };

    // Get additional metadata from S3
    try {
      const s3Metadata = await getFileMetadata(req.file.key);
      if (s3Metadata) {
        videoData.s3Metadata = s3Metadata;
      }
    } catch (metadataError) {
      console.warn('Could not fetch S3 metadata:', metadataError.message);
    }

    res.status(201).json({
      message: 'Video uploaded successfully',
      video: videoData,
      nextSteps: {
        convertToHls: `POST /api/upload/convert-to-hls/${videoId}`,
        body: { s3Key: req.file.key }
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload video',
      message: error.message 
    });
  }
});

// Convert video to HLS endpoint
router.post('/convert-to-hls/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(400).json({ 
        error: 'S3 key is required' 
      });
    }

    // Check if video exists in S3
    const exists = await fileExists(s3Key);
    if (!exists) {
      return res.status(404).json({ 
        error: 'Video not found in S3' 
      });
    }

    // Start HLS conversion
    console.log(`Starting HLS conversion for video ${videoId}`);
    
    const result = await videoProcessor.convertVideoToHLS(s3Key, videoId);

    res.json({
      message: 'Video converted to HLS successfully',
      videoId: result.videoId,
      masterPlaylist: result.masterPlaylist,
      streamingUrls: result.streamingUrls
    });

  } catch (error) {
    console.error('HLS conversion error:', error);
    res.status(500).json({ 
      error: 'Failed to convert video to HLS',
      message: error.message 
    });
  }
});

// Get streaming URLs for a video
router.get('/streaming/:videoId', async (req, res) => {
  try {
    const { videoId } = req.params;
    const s3Prefix = `hls/${videoId}`;
    
    // Check if master playlist exists
    const masterKey = `${s3Prefix}/master.m3u8`;
    const exists = await fileExists(masterKey);
    
    if (!exists) {
      return res.status(404).json({ 
        error: 'HLS conversion not found. Please convert the video first.' 
      });
    }

    const streamingUrls = {
      master: `https://${BUCKET_NAME}.s3.amazonaws.com/${masterKey}`,
      qualities: {
        '360p': `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/360p/playlist.m3u8`,
        '720p': `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/720p/playlist.m3u8`
      }
    };

    res.json({
      videoId,
      streamingUrls
    });

  } catch (error) {
    console.error('Error getting streaming URLs:', error);
    res.status(500).json({ 
      error: 'Failed to get streaming URLs',
      message: error.message 
    });
  }
});

// Generate pre-signed URL for direct upload
router.post('/presigned-url', async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ 
        error: 'Filename and content type are required' 
      });
    }

    // Validate content type
    if (!contentType.startsWith('video/')) {
      return res.status(400).json({ 
        error: 'Only video content types are allowed' 
      });
    }

    // Generate unique key
    const timestamp = Date.now();
    const uniqueId = uuidv4();
    const extension = filename.split('.').pop();
    const key = `videos/${timestamp}-${uniqueId}.${extension}`;

    // Generate pre-signed URL
    const uploadUrl = await generateUploadUrl(key, contentType, 3600); // 1 hour expiry

    res.json({
      uploadUrl,
      key,
      expiresIn: 3600,
      fields: {
        'Content-Type': contentType
      }
    });

  } catch (error) {
    console.error('Error generating pre-signed URL:', error);
    res.status(500).json({ 
      error: 'Failed to generate upload URL',
      message: error.message 
    });
  }
});

// Check upload status
router.get('/status/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    const exists = await fileExists(key);
    
    if (exists) {
      const metadata = await getFileMetadata(key);
      res.json({
        exists: true,
        metadata
      });
    } else {
      res.json({
        exists: false
      });
    }

  } catch (error) {
    console.error('Error checking upload status:', error);
    res.status(500).json({ 
      error: 'Failed to check upload status',
      message: error.message 
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  console.error('Upload middleware error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 500MB' 
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'Too many files. Only one file allowed' 
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ 
        error: 'Unexpected file field' 
      });
    }
  }
  
  if (error.message === 'Only video files are allowed!') {
    return res.status(400).json({ error: error.message });
  }
  
  // Handle AWS errors
  if (error.name === 'NoSuchBucket') {
    return res.status(500).json({ 
      error: 'S3 bucket not found. Please check your AWS configuration.' 
    });
  }
  
  if (error.name === 'AccessDenied') {
    return res.status(500).json({ 
      error: 'Access denied to S3. Please check your AWS credentials and permissions.' 
    });
  }
  
  res.status(500).json({ 
    error: 'Upload failed',
    message: error.message 
  });
});

module.exports = router; 