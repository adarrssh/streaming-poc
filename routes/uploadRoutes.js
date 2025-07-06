const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { v4: uuidv4 } = require('uuid');
const { s3, BUCKET_NAME, generateUploadUrl, fileExists, getFileMetadata } = require('../config/aws');
const videoProcessor = require('../services/videoProcessor');
const backgroundProcessor = require('../services/backgroundProcessor');
const { authenticate } = require('../middleware/auth');
const Video = require('../models/Video');

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

// Upload video endpoint (requires authentication)
router.post('/video', authenticate, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const videoId = uuidv4(); // Generate unique video ID

    console.log({
      videoId: videoId,
      userId: req.user._id,
      filename: req.file.key,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: req.file.location,
      s3Key: req.file.key,
      metadata: req.file.metadata,
      status: 'uploaded',
      displayName: req.body.displayName || ''
    });

    // Create video record in database
    const video = new Video({
      videoId: videoId,
      userId: req.user._id,
      filename: req.file.key,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: req.file.location,
      s3Key: req.file.key,
      metadata: req.file.metadata,
      status: 'uploaded',
      displayName: req.body.displayName || ''
    });

    // Get additional metadata from S3
    try {
      const s3Metadata = await getFileMetadata(req.file.key);
      if (s3Metadata) {
        video.s3Metadata = s3Metadata;
      }
    } catch (metadataError) {
      console.warn('Could not fetch S3 metadata:', metadataError.message);
    }

    // Save video to database
    await video.save();

    res.status(201).json({
      message: 'Video uploaded successfully',
      video: {
        id: video.videoId,
        filename: video.filename,
        originalName: video.originalName,
        size: video.size,
        mimetype: video.mimetype,
        url: video.url,
        status: video.status,
        uploadedAt: video.createdAt,
        metadata: video.metadata,
        s3Key: video.s3Key
      },
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

// Convert video to HLS endpoint (requires authentication)
router.post('/convert-to-hls/:videoId', authenticate, async (req, res) => {
  try {
    const { videoId } = req.params;
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(400).json({ 
        error: 'S3 key is required' 
      });
    }

    // Check if video exists in database and belongs to user
    const video = await Video.findOne({ videoId: videoId, userId: req.user._id });
    if (!video) {
      return res.status(404).json({ 
        error: 'Video not found or access denied' 
      });
    }

    // Check if video exists in S3
    const exists = await fileExists(s3Key);
    if (!exists) {
      return res.status(404).json({ 
        error: 'Video not found in S3' 
      });
    }

    // Update video status to processing
    video.status = 'processing';
    video.encodingStartedAt = new Date();
    await video.save();

    // Start background encoding job
    const result = await backgroundProcessor.startEncodingJob(videoId, s3Key);

    res.json({
      message: 'Video encoding started successfully',
      videoId: result.videoId,
      status: result.status,
      monitorProgress: `GET /api/upload/status/${videoId}`,
      cloudWatchLogs: `Check CloudWatch logs for video-${videoId} stream`
    });

  } catch (error) {
    console.error('HLS conversion error:', error);
    res.status(500).json({ 
      error: 'Failed to start video encoding',
      message: error.message 
    });
  }
});

// Get encoding status for a video (requires authentication)
router.get('/status/:videoId', authenticate, async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // First check if video belongs to user
    const video = await Video.findOne({ 
      videoId: videoId, 
      userId: req.user._id 
    });

    if (!video) {
      return res.status(404).json({ 
        error: 'Video not found or access denied' 
      });
    }

    // Get status from background processor
    const status = backgroundProcessor.getJobStatus(videoId);
    
    // Combine database and background processor status
    const combinedStatus = {
      videoId: videoId,
      status: video.status,
      progress: video.encodingProgress,
      startTime: video.encodingStartedAt,
      endTime: video.encodingCompletedAt,
      streamingUrls: video.streamingUrls,
      error: video.error,
      // Include background processor status if different
      backgroundStatus: status.status !== 'not_found' ? status : null
    };

    res.json(combinedStatus);

  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ 
      error: 'Failed to get encoding status',
      message: error.message 
    });
  }
});

// Get user's active encoding jobs
router.get('/jobs', authenticate, async (req, res) => {
  try {
    // Get user's videos that are currently processing
    const processingVideos = await Video.find({ 
      userId: req.user._id,
      status: 'processing'
    }).select('videoId originalName encodingProgress encodingStartedAt');

    // Get background processor status for these videos
    const jobs = [];
    for (const video of processingVideos) {
      const status = backgroundProcessor.getJobStatus(video.videoId);
      if (status.status !== 'not_found') {
        jobs.push({
          videoId: video.videoId,
          originalName: video.originalName,
          status: status.status,
          progress: status.progress,
          startTime: status.startTime,
          endTime: status.endTime
        });
      }
    }

    res.json({
      totalJobs: jobs.length,
      jobs: jobs
    });

  } catch (error) {
    console.error('Error getting jobs:', error);
    res.status(500).json({ 
      error: 'Failed to get encoding jobs',
      message: error.message 
    });
  }
});

// Get streaming URLs for a video (requires authentication)
router.get('/streaming/:videoId', authenticate, async (req, res) => {
  try {
    const { videoId } = req.params;
    
    // First check if video belongs to user
    const video = await Video.findOne({ 
      videoId: videoId, 
      userId: req.user._id 
    });

    if (!video) {
      return res.status(404).json({ 
        error: 'Video not found or access denied' 
      });
    }
    
    // Check if encoding is complete
    const status = backgroundProcessor.getJobStatus(videoId);
    
    if (status.status === 'processing') {
      return res.status(202).json({
        message: 'Video is still being encoded',
        videoId,
        status: status.status,
        progress: status.progress,
        checkStatus: `GET /api/upload/status/${videoId}`
      });
    }
    
    if (status.status === 'failed') {
      return res.status(500).json({
        error: 'Video encoding failed',
        videoId,
        error: status.error
      });
    }
    
    if (status.status === 'completed' && status.streamingUrls) {
      return res.json({
        videoId,
        status: 'completed',
        streamingUrls: status.streamingUrls
      });
    }

    // Fallback: check if master playlist exists in S3
    const s3Prefix = `hls/${videoId}`;
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
      status: 'completed',
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
      nextSteps: {
        convertToHls: `POST /api/upload/convert-to-hls/${uniqueId}`,
        body: { s3Key: key }
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

// Get user's videos (requires authentication)
router.get('/videos', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status; // Optional filter by status
    const skip = (page - 1) * limit;

    // Build query
    const query = { userId: req.user._id };
    if (status) {
      query.status = status;
    }

    // Get videos with pagination
    const videos = await Video.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-__v');

    // Get total count for pagination
    const total = await Video.countDocuments(query);

    // Format response
    const formattedVideos = videos.map(video => ({
      id: video.videoId,
      displayName: video.displayName,
      originalName: video.originalName,
      size: video.size,
      mimetype: video.mimetype,
      status: video.status,
      encodingProgress: video.encodingProgress,
      uploadedAt: video.createdAt,
      encodingStartedAt: video.encodingStartedAt,
      encodingCompletedAt: video.encodingCompletedAt,
      error: video.error,
      streamingUrls: video.streamingUrls,
      url: video.url,
      s3Key: video.s3Key
    }));

    res.json({
      videos: formattedVideos,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).json({ 
      error: 'Failed to fetch videos',
      message: error.message 
    });
  }
});

// Get specific video details (requires authentication)
router.get('/videos/:videoId', authenticate, async (req, res) => {
  try {
    const { videoId } = req.params;

    const video = await Video.findOne({ 
      videoId: videoId, 
      userId: req.user._id 
    }).select('-__v');

    if (!video) {
      return res.status(404).json({ 
        error: 'Video not found or access denied' 
      });
    }

    // Format response
    const formattedVideo = {
      id: video.videoId,
      displayName: video.displayName,
      originalName: video.originalName,
      size: video.size,
      mimetype: video.mimetype,
      status: video.status,
      encodingProgress: video.encodingProgress,
      uploadedAt: video.createdAt,
      encodingStartedAt: video.encodingStartedAt,
      encodingCompletedAt: video.encodingCompletedAt,
      error: video.error,
      streamingUrls: video.streamingUrls,
      url: video.url,
      s3Key: video.s3Key,
      metadata: video.metadata,
      s3Metadata: video.s3Metadata
    };

    res.json(formattedVideo);

  } catch (error) {
    console.error('Error fetching video:', error);
    res.status(500).json({ 
      error: 'Failed to fetch video',
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